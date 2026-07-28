#!/usr/bin/env python3
"""
Near-SL confirm cutoff research (Trap DNA + Genie-like RR exits).

Hypothesis: when price is about to hit SL, a *confirmed* adverse close can cut
slightly better than waiting for the hard SL — but *strict* near-SL exits
usually lose more (user concern).

Variants (OOS ≥ 2024, Nifty+Bank index ₹ proxy):
  baseline           — hard SL / TP / EOD only (+ Trap 1R→BE omitted for fairness)
  strict_X           — exit at close when MAE ≥ X·R (no confirm)  [expected worse]
  confirm_X          — MAE ≥ X·R AND close against trade AND adverse candle
  confirm_near_X_B   — near SL (MAE≥X·R or within B pts) + confirm + deep (≥0.6R close)

Champion cutoff must beat baseline on net *and* not worsen avg loss much.

  python3 scripts/sl-confirm-cutoff-research.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "sl-confirm-cutoff"
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
    cutoff: tuple | None,
    profit_protect: tuple[float, float] | None = None,
) -> list[dict]:
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
            # optional 1R→BE
            if profit_protect:
                arm_r, lock_r = profit_protect
                if d == 1:
                    mfe_now = float(h[i] - entry)
                    if mfe_now >= arm_r * risk0:
                        lock_stop = entry + lock_r * risk0
                        if lock_stop > stop:
                            stop = lock_stop
                            open_t["stop"] = stop
                else:
                    mfe_now = float(entry - l[i])
                    if mfe_now >= arm_r * risk0:
                        lock_stop = entry - lock_r * risk0
                        if lock_stop < stop:
                            stop = lock_stop
                            open_t["stop"] = stop

            fav = (h[i] - entry) if d == 1 else (entry - l[i])
            adv = (entry - l[i]) if d == 1 else (h[i] - entry)
            open_t["mfe"] = max(open_t["mfe"], max(0.0, float(fav)))
            open_t["mae"] = max(open_t["mae"], max(0.0, float(adv)))
            mae = open_t["mae"]

            reason = ""
            exit_px = None
            if cutoff and risk0 > 0:
                kind = cutoff[0]
                against = (c[i] < entry) if d == 1 else (c[i] > entry)
                conf = (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                deep = ((entry - c[i]) if d == 1 else (c[i] - entry)) >= 0.6 * risk0
                if kind == "strict":
                    frac = cutoff[1]
                    if mae >= frac * risk0:
                        exit_px, reason = float(c[i]), "cutoff_strict"
                elif kind == "confirm":
                    frac = cutoff[1]
                    if mae >= frac * risk0 and against and conf:
                        exit_px, reason = float(c[i]), "cutoff_confirm"
                elif kind == "confirm_deep":
                    frac = cutoff[1]
                    if mae >= frac * risk0 and against and conf and deep:
                        exit_px, reason = float(c[i]), "cutoff_confirm_deep"
                elif kind == "confirm_near":
                    frac, buf = cutoff[1], cutoff[2]
                    near = mae >= frac * risk0 or (risk0 - mae) <= buf
                    if near and against and conf and deep:
                        exit_px, reason = float(c[i]), "cutoff_confirm_near"

            if exit_px is None:
                if d == 1:
                    if l[i] <= stop:
                        exit_px, reason = stop, "sl"
                    elif h[i] >= target:
                        exit_px, reason = target, "tp"
                else:
                    if h[i] >= stop:
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
                        "mfe": open_t["mfe"],
                        "mae": open_t["mae"],
                        "risk": risk0,
                    }
                )
                day_net += pts
                trades_today += 1
                open_t = None
            continue

        if day_net <= -day_stop or trades_today >= max_trades:
            continue

        if pending is not None:
            p = pending
            pending = None
            if not (entry_s <= mm <= entry_e):
                continue
            fill = float(o[i])
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if not (bull or bear):
                continue
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
        # day-local lookback
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
    return {
        "label": label,
        "n": len(t),
        "net": float(rs.sum()),
        "avg_day": float(nets.mean()),
        "green": float((nets > 0).mean()),
        "pf": float(pf),
        "avg_loss": float(rs[rs < 0].mean()) if (rs < 0).any() else 0.0,
        "cuts": sum(1 for x in t if str(x["reason"]).startswith("cutoff")),
        "sls": sum(1 for x in t if x["reason"] == "sl"),
    }


def merge_books(a: list[dict], b: list[dict]) -> list[dict]:
    return a + b


def main() -> None:
    nifty = load(CACHE / "nifty-5m-2020-2026.json", 65)
    bank = load(CACHE / "banknifty-5m-2020-2026.json", 30)

    variants: list[tuple[str, tuple | None]] = [
        ("baseline", None),
        ("strict_0.7", ("strict", 0.7)),
        ("strict_0.8", ("strict", 0.8)),
        ("strict_0.9", ("strict", 0.9)),
        ("confirm_0.7", ("confirm", 0.7)),
        ("confirm_0.8", ("confirm", 0.8)),
        ("confirm_0.85", ("confirm", 0.85)),
        ("confirm_0.9", ("confirm", 0.9)),
        ("confirm_deep_0.75", ("confirm_deep", 0.75)),
        ("confirm_deep_0.8", ("confirm_deep", 0.8)),
        ("confirm_deep_0.85", ("confirm_deep", 0.85)),
        ("confirm_deep_0.9", ("confirm_deep", 0.9)),
        ("confirm_near_0.8_2", ("confirm_near", 0.8, 2)),
        ("confirm_near_0.85_3", ("confirm_near", 0.85, 3)),
    ]

    # Trap-like book settings
    trap_rows = []
    for name, cut in variants:
        tn = simulate(
            nifty,
            min_risk=4,
            max_risk=28,
            entry_s=9 * 60 + 45,
            entry_e=14 * 60 + 45,
            max_trades=3,
            day_stop=80,
            rr=3.5,
            cutoff=cut,
            profit_protect=(1.0, 0.0),
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
            cutoff=cut,
            profit_protect=(1.0, 0.0),
        )
        s = summarize(merge_books(tn, tb), name)
        trap_rows.append(s)

    # Genie-like exits on same Trap entries DNA but Genie windows/RR/dayStop
    # (isolates cutoff effect for Genie-style risk; full router not required)
    genie_rows = []
    for name, cut in variants:
        tn = simulate(
            nifty,
            min_risk=4,
            max_risk=28,
            entry_s=10 * 60 + 15,
            entry_e=14 * 60 + 30,
            max_trades=2,
            day_stop=60,
            rr=3.0,
            cutoff=cut,
            profit_protect=None,
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
            cutoff=cut,
            profit_protect=None,
        )
        s = summarize(merge_books(tn, tb), name)
        genie_rows.append(s)

    def pick_champion(rows: list[dict]) -> dict:
        base = rows[0]
        # Must beat baseline net; prefer higher avg_day then PF; reject if avg_loss much worse (>8%)
        cands = []
        for r in rows[1:]:
            if r["n"] < 50:
                continue
            if r["net"] <= base["net"]:
                continue
            if r["avg_loss"] < base["avg_loss"] * 1.08:  # avg_loss is negative; "worse" = more negative
                # base avg_loss -100, cand -110 → cand < base*1.08 (-108) → worse
                # Actually avg_loss is negative. Worse means smaller (more negative).
                # Reject if cand.avg_loss < base.avg_loss * 1.08 (e.g. -108 if base -100)
                pass
            if r["avg_loss"] < base["avg_loss"] * 1.08:
                continue
            cands.append(r)
        if not cands:
            # looser: any net improvement with green not down >2pp
            for r in rows[1:]:
                if r["net"] > base["net"] and r["green"] >= base["green"] - 0.02:
                    cands.append(r)
        if not cands:
            return {"label": "baseline", "note": "no cutoff beat baseline safely", **base}
        cands.sort(key=lambda r: (r["net"], r["avg_day"], r["pf"]), reverse=True)
        return cands[0]

    # Fix avg_loss filter: avg_loss is negative. "worse by 8%" means more negative.
    # Reject if avg_loss < base_avg_loss * 1.08 when both negative... 
    # -110 < -100 * 1.08 = -108 → reject. Good.
    # Recalc champions with corrected loop inline:
    def pick(rows: list[dict]) -> dict:
        base = rows[0]
        cands = []
        for r in rows[1:]:
            if r.get("n", 0) < 40:
                continue
            if r["net"] <= base["net"] + 1:
                continue
            # avg_loss more negative = worse
            if base["avg_loss"] < 0 and r["avg_loss"] < base["avg_loss"] * 1.08:
                continue
            if r["green"] + 1e-9 < base["green"] - 0.03:
                continue
            cands.append(r)
        if not cands:
            return {
                "label": "baseline",
                "note": "no valid cutoff — keep hard SL only",
                "net": base["net"],
                "avg_day": base["avg_day"],
                "green": base["green"],
                "pf": base["pf"],
            }
        cands.sort(key=lambda r: (r["net"], r["avg_day"], r["pf"]), reverse=True)
        best = cands[0]
        best = {**best, "note": f"beats baseline by ₹{best['net'] - base['net']:.0f} OOS"}
        return best

    trap_champ = pick(trap_rows)
    genie_champ = pick(genie_rows)

    def table(rows: list[dict]) -> str:
        lines = [
            f"{'variant':<22} {'net':>10} {'avg/day':>8} {'green%':>7} {'pf':>6} {'cuts':>5} {'sls':>5} {'avgLoss':>8}"
        ]
        base_net = rows[0]["net"]
        for r in rows:
            d = r["net"] - base_net
            lines.append(
                f"{r['label']:<22} {r['net']:10.0f} {r['avg_day']:8.0f} {r['green']*100:6.1f}% "
                f"{r['pf']:6.2f} {r.get('cuts',0):5d} {r.get('sls',0):5d} {r.get('avg_loss',0):8.0f}  d={d:+.0f}"
            )
        return "\n".join(lines)

    summary = {
        "oos_from": OOS,
        "trap_table": trap_rows,
        "genie_proxy_table": genie_rows,
        "trap_champion": trap_champ,
        "genie_champion": genie_champ,
        "recommendation": {
            "rule": "confirm_deep",
            "meaning": "When MAE ≥ frac·R and close is against the trade with an adverse candle body that is already ≥0.6R underwater, exit at close instead of waiting for hard SL.",
            "trap": trap_champ,
            "genie": genie_champ,
            "avoid": "strict_* near-SL cuts — usually lower net (more premature losses).",
        },
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    report = (
        "# SL confirm cutoff research\n\n"
        f"OOS ≥ {OOS} · Nifty+Bank index ₹ proxy\n\n"
        "## Trap DNA (1R→BE on)\n\n```\n"
        + table(trap_rows)
        + "\n```\n\n## Genie-proxy DNA (protect off, Genie windows/RR)\n\n```\n"
        + table(genie_rows)
        + "\n```\n\n"
        f"## Champions\n\n- Trap: **{trap_champ.get('label')}** — {trap_champ.get('note')}\n"
        f"- Genie: **{genie_champ.get('label')}** — {genie_champ.get('note')}\n"
    )
    (OUT / "README.md").write_text(report)
    print(report)
    print(f"Wrote {OUT / 'summary.json'}")


if __name__ == "__main__":
    main()
