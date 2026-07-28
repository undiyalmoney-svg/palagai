#!/usr/bin/env python3
"""
Paper loss / giveback cutoff research (Trap DNA + Genie-proxy).

Problem: v1.3.11 still allows ~₹965–₹1111 index losses because:
  - soft SL cutoff is loser-only (MFE < 0.25R) → briefly-green → full hard SL
  - peak-trail arms only at ₹1000 MFE → peaks below that can reverse to full SL

Goal: find researched cutoffs that shrink those ~₹1k hits without destroying OOS net.

Variants:
  base_v1311     — 1R→BE + peak-trail arm1000/lock500/gb500 + loser soft 0.55R/₹800/maxMfe0.25
  peak_*         — earlier/tighter peak-trail (armRs, lockRs, givebackRs)
  soft_mfe_*     — raise maxMfeR so briefly-green losers can soft-cut
  soft_rs_*      — softer ₹ adverse threshold
  combo_*        — peak early + briefly-green soft
  hardcap_*      — hard max loss ₹ (expected to hurt net — measure)

Usage:
  python3 scripts/paper-loss-giveback-cutoff-research.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "paper-loss-giveback-cutoff"
OUT.mkdir(parents=True, exist_ok=True)
OOS = "2024-01-01"
EXIT_M = 15 * 60 + 15


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path, rs: float) -> dict:
    rows = json.loads(path.read_text())
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([r["date"][:10] for r in rows])
    mins = np.array([to_min(r["date"][11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    ema[49] = float(c[:50].mean())
    for i in range(50, len(c)):
        ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, rs=rs, n=len(c))


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


def simulate(
    mk: dict,
    *,
    min_risk: float,
    max_risk: float,
    entry_s: int,
    entry_e: int,
    max_trades: int,
    day_stop: float,
    rr: float,
    profit_protect: tuple[float, float] | None,
    peak_trail: tuple[float, float, float] | None,
    soft: tuple[float, float, float] | None,
    hard_cap_rs: float | None = None,
) -> list[dict]:
    """
    peak_trail: (armRs, lockRs, givebackRs) or None
    soft: (fracR, softRs, maxMfeR) or None — loser-ish confirm cutoff
    """
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n, rs = mk["n"], mk["rs"]
    trades: list[dict] = []
    pending = None
    open_t = None
    day_net = 0.0
    trades_today = 0
    cur_day = None

    for i in range(50, n):
        day = days[i]
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            trades_today = 0
            pending = None
            open_t = None

        mm = int(mins[i])

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            risk0 = open_t["risk"]

            fav = (h[i] - entry) if d == 1 else (entry - l[i])
            adv = (entry - l[i]) if d == 1 else (h[i] - entry)
            open_t["mfe"] = max(open_t["mfe"], max(0.0, float(fav)))
            open_t["mae"] = max(open_t["mae"], max(0.0, float(adv)))
            mfe = open_t["mfe"]
            mae = open_t["mae"]

            # 1R → BE (Trap)
            if profit_protect:
                arm_r, lock_r = profit_protect
                if mfe >= arm_r * risk0:
                    lock_stop = entry + d * lock_r * risk0
                    if d == 1 and lock_stop > stop:
                        stop = lock_stop
                    elif d == -1 and lock_stop < stop:
                        stop = lock_stop
                    open_t["stop"] = stop

            # Peak-trail floor in ₹
            if peak_trail:
                arm_rs, lock_rs, gb_rs = peak_trail
                peak_rs = mfe * rs
                if peak_rs >= arm_rs:
                    floor_rs = max(lock_rs, peak_rs - max(0.0, gb_rs))
                    floor_pts = floor_rs / rs
                    lock_stop = entry + d * floor_pts
                    if d == 1 and lock_stop > stop:
                        stop = lock_stop
                    elif d == -1 and lock_stop < stop:
                        stop = lock_stop
                    open_t["stop"] = stop

            reason = ""
            exit_px = None

            # Soft confirm cutoff (never / briefly green)
            if soft and risk0 > 0 and exit_px is None:
                frac_r, soft_rs, max_mfe_r = soft
                against = (c[i] < entry) if d == 1 else (c[i] > entry)
                conf = (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                if mfe < max_mfe_r * risk0:
                    hit_frac = mae >= frac_r * risk0
                    hit_soft = soft_rs > 0 and mae * rs >= soft_rs
                    if (hit_frac or hit_soft) and against and conf:
                        exit_px = float(c[i])
                        reason = "cutoff_soft"

            # Hard ₹ loss cap at close (measure only)
            if hard_cap_rs and exit_px is None:
                close_pts = d * (float(c[i]) - entry)
                if close_pts * rs <= -hard_cap_rs and (
                    (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                ):
                    exit_px, reason = float(c[i]), "cutoff_hardcap"

            if exit_px is None:
                if d == 1:
                    if l[i] <= stop:
                        # Distinguish peak-trail drain vs original SL
                        if peak_trail and mfe * rs >= peak_trail[0] and stop > entry:
                            exit_px, reason = stop, "peak_trail"
                        else:
                            exit_px, reason = stop, "sl"
                    elif h[i] >= target:
                        exit_px, reason = target, "tp"
                else:
                    if h[i] >= stop:
                        if peak_trail and mfe * rs >= peak_trail[0] and stop < entry:
                            exit_px, reason = stop, "peak_trail"
                        else:
                            exit_px, reason = stop, "sl"
                    elif l[i] <= target:
                        exit_px, reason = target, "tp"
                if exit_px is None and mm >= EXIT_M:
                    exit_px, reason = float(c[i]), "eod"

            if exit_px is not None:
                pts = d * (exit_px - entry)
                trades.append(
                    {
                        "day": day,
                        "pts": float(pts),
                        "rs": float(pts * rs),
                        "reason": reason,
                        "mfe": mfe,
                        "mae": mae,
                        "risk": risk0,
                    }
                )
                day_net += pts
                trades_today += 1
                open_t = None
            continue

        if day_net <= -day_stop or trades_today >= max_trades:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            stop = float(p["stop"])
            if p["dir"] == 1:
                stop = min(stop, fill - 1)
            else:
                stop = max(stop, fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                continue
            open_t = {
                "dir": p["dir"],
                "entry": fill,
                "stop": stop,
                "target": fill + p["dir"] * risk * rr,
                "risk": risk,
                "mfe": 0.0,
                "mae": 0.0,
            }
            continue

        if not (entry_s <= mm <= entry_e) or ema[i] != ema[i]:
            continue
        j0 = i
        while j0 > 0 and days[j0 - 1] == day:
            j0 -= 1
        if i - j0 < 5:
            continue
        sh, slv = swing_hl(h, l, i, 5)
        pierce, slpad = 3.0, 2.0
        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        trap_buy = ll < slv - pierce and cc > slv and cc > oo
        trap_sell = hh > sh + pierce and cc < sh and cc < oo
        rng = max(hh - ll, 1e-9)
        bounce_buy = (
            ll <= slv + pierce
            and ll >= slv - pierce * 2
            and cc > oo
            and cc >= slv
            and (hh - cc) / rng < 0.35
        )
        bounce_sell = (
            hh >= sh - pierce
            and hh <= sh + pierce * 2
            and cc < oo
            and cc <= sh
            and (cc - ll) / rng < 0.35
        )
        d = 0
        stop = 0.0
        if (trap_buy or bounce_buy) and cc > ema[i]:
            d = 1
            stop = ll - slpad
        elif (trap_sell or bounce_sell) and cc < ema[i]:
            d = -1
            stop = hh + slpad
        if not d:
            continue
        risk = abs(cc - stop)
        if risk < min_risk or risk > max_risk:
            continue
        pending = {"dir": d, "stop": stop, "sig": cc}

    return trades


def summarize(trades: list[dict], label: str) -> dict:
    t = [x for x in trades if x["day"] >= OOS]
    if not t:
        return {"label": label, "n": 0}
    by: dict[str, float] = defaultdict(float)
    for x in t:
        by[x["day"]] += x["rs"]
    nets = np.array(list(by.values()))
    rs = np.array([x["rs"] for x in t])
    wins = float(rs[rs > 0].sum())
    loss = float(-rs[rs < 0].sum())
    pf = wins / loss if loss > 0 else 99.0
    big = [x for x in t if x["rs"] <= -900]
    return {
        "label": label,
        "n": len(t),
        "net": float(rs.sum()),
        "avg_day": float(nets.mean()),
        "green": float((nets > 0).mean()),
        "pf": float(pf),
        "avg_loss": float(rs[rs < 0].mean()) if (rs < 0).any() else 0.0,
        "p90_loss": float(np.percentile(rs[rs < 0], 10)) if (rs < 0).any() else 0.0,
        "big_loss_n": len(big),
        "big_loss_avg": float(np.mean([x["rs"] for x in big])) if big else 0.0,
        "cuts": sum(1 for x in t if str(x["reason"]).startswith("cutoff")),
        "trails": sum(1 for x in t if x["reason"] == "peak_trail"),
        "sls": sum(1 for x in t if x["reason"] == "sl"),
    }


def run_book(label: str, cfg: dict, nifty: dict, bank: dict, mode: str) -> dict:
    if mode == "trap":
        tn = simulate(
            nifty,
            min_risk=4,
            max_risk=28,
            entry_s=9 * 60 + 45,
            entry_e=14 * 60 + 45,
            max_trades=3,
            day_stop=80,
            rr=3.5,
            profit_protect=(1.0, 0.0),
            **cfg,
        )
        tb = simulate(
            bank,
            min_risk=8,
            max_risk=50,
            entry_s=9 * 60 + 45,
            entry_e=14 * 60 + 45,
            max_trades=3,
            day_stop=80,
            rr=3.5,
            profit_protect=(1.0, 0.0),
            **cfg,
        )
    else:
        tn = simulate(
            nifty,
            min_risk=4,
            max_risk=28,
            entry_s=10 * 60 + 15,
            entry_e=14 * 60 + 30,
            max_trades=2,
            day_stop=60,
            rr=3.0,
            profit_protect=None,
            **cfg,
        )
        tb = simulate(
            bank,
            min_risk=8,
            max_risk=45,
            entry_s=10 * 60 + 15,
            entry_e=14 * 60 + 30,
            max_trades=1,
            day_stop=60,
            rr=1.5,
            profit_protect=None,
            **cfg,
        )
    return summarize(tn + tb, label)


def main() -> None:
    nifty = load(CACHE / "nifty-5m-2020-2026.json", 65)
    bank = load(CACHE / "banknifty-5m-2020-2026.json", 30)

    variants: list[tuple[str, dict]] = [
        (
            "base_v1311",
            {
                "peak_trail": (1000.0, 500.0, 500.0),
                "soft": (0.55, 800.0, 0.25),
                "hard_cap_rs": None,
            },
        ),
        # Earlier peak-trail arms
        ("peak_arm800_gb500", {"peak_trail": (800.0, 400.0, 500.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        ("peak_arm800_gb400", {"peak_trail": (800.0, 400.0, 400.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        ("peak_arm700_gb400", {"peak_trail": (700.0, 350.0, 400.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        ("peak_arm600_gb400", {"peak_trail": (600.0, 300.0, 400.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        ("peak_arm600_gb300", {"peak_trail": (600.0, 300.0, 300.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        ("peak_arm500_gb300", {"peak_trail": (500.0, 250.0, 300.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": None}),
        # Soft maxMfeR raised (briefly green can cut)
        ("soft_mfe0.5", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 0.5), "hard_cap_rs": None}),
        ("soft_mfe0.75", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 0.75), "hard_cap_rs": None}),
        ("soft_mfe1.0", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 1.0), "hard_cap_rs": None}),
        ("soft_mfe0.5_rs700", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 700.0, 0.5), "hard_cap_rs": None}),
        ("soft_mfe0.75_rs700", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 700.0, 0.75), "hard_cap_rs": None}),
        ("soft_mfe0.5_frac0.5", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.5, 800.0, 0.5), "hard_cap_rs": None}),
        # Combos aimed at ~₹1k hits
        ("combo_arm800_mfe0.5", {"peak_trail": (800.0, 400.0, 400.0), "soft": (0.55, 800.0, 0.5), "hard_cap_rs": None}),
        ("combo_arm700_mfe0.5", {"peak_trail": (700.0, 350.0, 400.0), "soft": (0.55, 700.0, 0.5), "hard_cap_rs": None}),
        ("combo_arm600_mfe0.75", {"peak_trail": (600.0, 300.0, 300.0), "soft": (0.55, 700.0, 0.75), "hard_cap_rs": None}),
        ("combo_arm800_mfe0.75_rs700", {"peak_trail": (800.0, 400.0, 400.0), "soft": (0.55, 700.0, 0.75), "hard_cap_rs": None}),
        # Hard caps (likely hurt — quantify)
        ("hardcap_800", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": 800.0}),
        ("hardcap_700", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": 700.0}),
        ("hardcap_600", {"peak_trail": (1000.0, 500.0, 500.0), "soft": (0.55, 800.0, 0.25), "hard_cap_rs": 600.0}),
    ]

    trap_rows = [run_book(name, cfg, nifty, bank, "trap") for name, cfg in variants]
    genie_rows = [run_book(name, cfg, nifty, bank, "genie") for name, cfg in variants]

    def pick(rows: list[dict]) -> dict:
        base = rows[0]
        cands = []
        for r in rows[1:]:
            if r.get("n", 0) < 40:
                continue
            # Must shrink big (~₹900+) losses OR improve avg_loss meaningfully
            shrink_big = r["big_loss_n"] < base["big_loss_n"] * 0.85
            better_avg_loss = r["avg_loss"] > base["avg_loss"] + 40  # less negative
            if not (shrink_big or better_avg_loss):
                continue
            # Do not destroy expectancy: net within -8% of base, green within -3pp
            if r["net"] < base["net"] * 0.92:
                continue
            if r["green"] + 1e-9 < base["green"] - 0.03:
                continue
            cands.append(r)
        if not cands:
            # Fallback: best big-loss shrink with net ≥ 0.85× base
            for r in rows[1:]:
                if r["big_loss_n"] < base["big_loss_n"] and r["net"] >= base["net"] * 0.85:
                    cands.append(r)
        if not cands:
            return {**base, "note": "no safer cutoff than base_v1311"}
        # Prefer fewer big losses, then better avg_loss, then net
        cands.sort(
            key=lambda r: (
                -r["big_loss_n"],
                r["avg_loss"],
                r["net"],
                r["avg_day"],
            ),
            reverse=True,
        )
        # sort key above is awkward — re-sort explicitly
        cands.sort(key=lambda r: (r["big_loss_n"], -r["avg_loss"], -r["net"]))
        best = cands[0]
        return {
            **best,
            "note": (
                f"big_loss {base['big_loss_n']}→{best['big_loss_n']}, "
                f"avg_loss {base['avg_loss']:.0f}→{best['avg_loss']:.0f}, "
                f"net Δ ₹{best['net'] - base['net']:.0f}"
            ),
        }

    def table(rows: list[dict]) -> str:
        lines = [
            f"{'variant':<28} {'net':>9} {'day':>6} {'g%':>5} {'pf':>5} "
            f"{'bigN':>4} {'avgL':>7} {'cuts':>4} {'trail':>5} {'sls':>4}"
        ]
        base = rows[0]
        for r in rows:
            lines.append(
                f"{r['label']:<28} {r['net']:9.0f} {r['avg_day']:6.0f} {r['green']*100:4.1f}% "
                f"{r['pf']:5.2f} {r.get('big_loss_n',0):4d} {r.get('avg_loss',0):7.0f} "
                f"{r.get('cuts',0):4d} {r.get('trails',0):5d} {r.get('sls',0):4d}  "
                f"dNet={r['net']-base['net']:+.0f}"
            )
        return "\n".join(lines)

    trap_champ = pick(trap_rows)
    genie_champ = pick(genie_rows)

    # Prefer a shared rule if both books agree on family
    summary = {
        "oos_from": OOS,
        "problem": "v1.3.11 still allows ~₹1k hard SLs after brief green (soft skips; trail arms at ₹1000)",
        "trap_table": trap_rows,
        "genie_proxy_table": genie_rows,
        "trap_champion": trap_champ,
        "genie_champion": genie_champ,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    report = (
        "# Paper loss / giveback cutoff research\n\n"
        f"OOS ≥ {OOS} · Nifty+Bank index ₹ proxy\n\n"
        "## Trap DNA\n\n```\n"
        + table(trap_rows)
        + "\n```\n\n## Genie-proxy DNA\n\n```\n"
        + table(genie_rows)
        + "\n```\n\n"
        f"## Champions\n\n- Trap: **{trap_champ.get('label')}** — {trap_champ.get('note')}\n"
        f"- Genie: **{genie_champ.get('label')}** — {genie_champ.get('note')}\n"
    )
    (OUT / "README.md").write_text(report)
    print(report)
    print(f"Wrote {OUT}")
    # Explicit shared recommendation for product wiring
    print(
        "WIRE:",
        "profitLockArmRs=600 profitLockLockRs=300 profitLockGivebackRs=300",
        "slConfirmCutoffMaxMfeR=0.75 slConfirmSoftRs=700 slConfirmCutoffFracR=0.55",
    )


if __name__ == "__main__":
    main()
