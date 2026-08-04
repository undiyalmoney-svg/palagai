#!/usr/bin/env python3
"""
Daily-profit upgrade hunt — Trap (Nifty+Bank) + Crude Selective peers.

Uses Kite cache (never commit tokens). Ranks books by:
  avg ₹/day · green% · worst day · PF · trades/day
after simple charge model.

  python3 scripts/daily-profit-upgrade-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

OOS = "2025-01-01"  # recent live regime
EXIT_IDX = 15 * 60 + 15
EXIT_CRUDE = 23 * 60 + 10
CHARGE_IDX = 40.0  # approx MIS roundtrip proxy per index fill
CHARGE_CRUDE = 50.0


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path, rs: float) -> dict:
    rows = json.loads(path.read_text())
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"]).replace("T", " ")[11:16]) for r in rows])
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


def sim_trap(
    mk: dict,
    *,
    rr: float = 3.5,
    max_trades: int = 0,
    day_stop: float = 80,
    pierce: float = 3,
    min_risk: float = 4,
    max_risk: float = 28,
    entry_s: int = 9 * 60 + 45,
    entry_e: int = 14 * 60 + 45,
    protect_arm_r: float | None = 1.0,
    peak_arm: float = 600,
    peak_lock: float = 300,
    peak_gb: float = 300,
    soft_frac: float = 0.55,
    soft_max_mfe_r: float = 0.75,
    soft_rs: float = 700,
    mode: str = "both",
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, rs = mk["days"], mk["mins"], mk["ema"], mk["rs"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    day_fills = 0
    day_stopped = False
    cur_day = None

    for i in range(50, n):
        day = str(days[i])
        mm = int(mins[i])
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_fills = 0
            day_stopped = False
            pending = None
            open_t = None

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            risk = open_t["risk"]
            peak_r = open_t["peak_r"]
            peak_rs = open_t["peak_rs"]
            if d == 1:
                mfe_pts = max(0.0, float(h[i]) - entry)
                mae_pts = max(0.0, entry - float(l[i]))
            else:
                mfe_pts = max(0.0, entry - float(l[i]))
                mae_pts = max(0.0, float(h[i]) - entry)
            mfe_r = mfe_pts / risk if risk > 0 else 0
            peak_r = max(peak_r, mfe_r)
            peak_rs = max(peak_rs, mfe_pts * rs)
            # 1R → BE
            if protect_arm_r is not None and peak_r >= protect_arm_r:
                if d == 1:
                    stop = max(stop, entry)
                else:
                    stop = min(stop, entry)
            # peak trail
            if peak_arm > 0 and peak_rs >= peak_arm:
                floor_rs = max(peak_lock, peak_rs - peak_gb)
                floor_pts = floor_rs / rs
                if d == 1:
                    stop = max(stop, entry + floor_pts)
                else:
                    stop = min(stop, entry - floor_pts)
            # soft confirm cutoff for briefly-green
            soft_hit = False
            exit_px = None
            if soft_frac > 0 and peak_r < soft_max_mfe_r:
                if mae_pts >= soft_frac * risk or mae_pts * rs >= soft_rs:
                    soft_hit = True
                    if d == 1:
                        exit_px = entry - soft_frac * risk
                    else:
                        exit_px = entry + soft_frac * risk
            if d == 1:
                hit_sl = float(l[i]) <= stop
                hit_tp = float(h[i]) >= target
            else:
                hit_sl = float(h[i]) >= stop
                hit_tp = float(l[i]) <= target
            if soft_hit or hit_sl or hit_tp or mm >= EXIT_IDX:
                if soft_hit and exit_px is not None:
                    reason = "SOFT"
                elif hit_sl:
                    exit_px, reason = stop, "SL"
                elif hit_tp:
                    exit_px, reason = target, "TP"
                else:
                    exit_px, reason = float(c[i]), "EOD"
                pts = (exit_px - entry) if d == 1 else (entry - exit_px)
                rs_pnl = pts * rs - CHARGE_IDX
                trades.append(dict(day=day, rs=rs_pnl, pts=pts, reason=reason))
                day_net += pts
                day_fills += 1
                if day_net <= -day_stop:
                    day_stopped = True
                open_t = None
            else:
                open_t.update(stop=stop, peak_r=peak_r, peak_rs=peak_rs)
            continue

        if day_stopped:
            continue
        if max_trades > 0 and day_fills >= max_trades:
            continue

        # confirm pending
        if pending is not None:
            p = pending
            pending = None
            if mm < entry_s or mm > entry_e:
                continue
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if not (bull or bear):
                continue
            fill = float(o[i])
            stop = p["stop"]
            if p["dir"] == 1:
                stop = min(stop, fill - 1)
            else:
                stop = max(stop, fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                continue
            target = fill + risk * rr if p["dir"] == 1 else fill - risk * rr
            open_t = dict(
                dir=p["dir"], entry=fill, stop=stop, target=target, risk=risk, peak_r=0.0, peak_rs=0.0
            )
            continue

        if mm < entry_s or mm > entry_e:
            continue
        if np.isnan(ema[i]):
            continue
        sh, sl = swing_hl(h, l, i, 5)
        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        trap_buy = ll < sl - pierce and cc > sl and cc > oo
        trap_sell = hh > sh + pierce and cc < sh and cc < oo
        rng = max(hh - ll, 1e-9)
        bounce_buy = ll <= sl + pierce and ll >= sl - pierce * 2 and cc > oo and cc >= sl and (hh - cc) / rng < 0.35
        bounce_sell = hh >= sh - pierce and hh <= sh + pierce * 2 and cc < oo and cc <= sh and (cc - ll) / rng < 0.35
        direction = 0
        stop = 0.0
        if trap_buy or (mode == "both" and bounce_buy):
            if cc > float(ema[i]):
                direction = 1
                stop = ll - 2
        elif trap_sell or (mode == "both" and bounce_sell):
            if cc < float(ema[i]):
                direction = -1
                stop = hh + 2
        if not direction:
            continue
        risk = abs(cc - stop)
        if risk < min_risk or risk > max_risk:
            continue
        pending = dict(dir=direction, stop=stop, sig=cc)

    return trades


def orb_hl(days, mins, h, l, i, orb_end=9 * 60 + 30):
    day = days[i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and days[j] == day:
        mm = int(mins[j])
        if 9 * 60 <= mm <= orb_end:
            hi = max(hi, float(h[j]))
            lo = min(lo, float(l[j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def sim_crude(
    mk: dict,
    *,
    sl: float,
    tp: float,
    max_or: float,
    entry_s: int,
    entry_e: int,
    max_day: int,
    day_loss: float,
    confirm: bool = True,
    first_win: bool = True,
    rs: float = 10.0,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    day_fills = 0
    won = False
    cur_day = None
    or_cache = {}

    for i in range(50, n):
        day = str(days[i])
        mm = int(mins[i])
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_fills = 0
            won = False
            pending = None
            open_t = None

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            if d == 1:
                hit_sl = float(l[i]) <= stop
                hit_tp = float(h[i]) >= target
            else:
                hit_sl = float(h[i]) >= stop
                hit_tp = float(l[i]) <= target
            if hit_sl or hit_tp or mm >= EXIT_CRUDE:
                if hit_sl:
                    exit_px, reason = stop, "SL"
                elif hit_tp:
                    exit_px, reason = target, "TP"
                else:
                    exit_px, reason = float(c[i]), "EOD"
                pts = (exit_px - entry) if d == 1 else (entry - exit_px)
                trades.append(dict(day=day, rs=pts * rs - CHARGE_CRUDE, pts=pts, reason=reason))
                day_net += pts
                day_fills += 1
                won = won or pts > 0
                open_t = None
            continue

        if first_win and won:
            continue
        if max_day > 0 and day_fills >= max_day:
            continue
        if day_net <= -day_loss:
            continue

        if day not in or_cache:
            oh = orb_hl(days, mins, h, l, i)
            or_cache[day] = oh
        oh = or_cache[day]
        if oh is None:
            continue
        or_hi, or_lo = oh
        if or_hi - or_lo > max_or:
            continue

        if pending is not None:
            p = pending
            pending = None
            if mm < entry_s or mm > entry_e:
                continue
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if confirm and not (bull or bear):
                continue
            if not confirm:
                # same-bar already decided; enter next open anyway if direction matches close
                if p["dir"] == 1 and not (c[i] > o[i]):
                    continue
                if p["dir"] == -1 and not (c[i] < o[i]):
                    continue
            fill = float(o[i])
            stop = fill - sl if p["dir"] == 1 else fill + sl
            target = fill + tp if p["dir"] == 1 else fill - tp
            open_t = dict(dir=p["dir"], entry=fill, stop=stop, target=target)
            continue

        if mm < entry_s or mm > entry_e:
            continue
        if np.isnan(ema[i]):
            continue
        cc = float(c[i])
        # session OR break
        if cc > or_hi and cc > float(ema[i]):
            pending = dict(dir=1, sig=cc)
        elif cc < or_lo and cc < float(ema[i]):
            pending = dict(dir=-1, sig=cc)

    return trades


def summarize(trades: list[dict], label: str) -> dict:
    if not trades:
        return dict(label=label, days=0, trades=0, net=0, avg=0, green=0, pf=0, worst=0, tpd=0)
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    days = sorted(by)
    nets = [by[d] for d in days]
    green = sum(1 for x in nets if x > 0) / len(nets) * 100
    wins = sum(t["rs"] for t in trades if t["rs"] > 0)
    losses = -sum(t["rs"] for t in trades if t["rs"] < 0)
    pf = wins / losses if losses > 0 else 99
    return dict(
        label=label,
        days=len(days),
        trades=len(trades),
        net=round(sum(nets), 1),
        avg=round(sum(nets) / len(nets), 1),
        green=round(green, 1),
        pf=round(pf, 2),
        worst=round(min(nets), 1),
        tpd=round(len(trades) / len(nets), 2),
    )


def filter_oos(trades: list[dict], start: str) -> list[dict]:
    return [t for t in trades if t["day"] >= start]


def main() -> None:
    nifty = load(CACHE / "nifty-5m-2020-2026.json", 65)
    bank = load(CACHE / "banknifty-5m-2020-2026.json", 30)
    crude_path = CACHE / "crudeoilm-5m-merged.json"
    crude = load(crude_path, 10) if crude_path.exists() else None

    rows = []

    # --- Trap variants (Nifty + Bank combined desk day) ---
    trap_cfgs = [
        ("trap_current_app", dict()),  # 3.5R + protect + peak600/300 + soft
        ("trap_rr2_protect", dict(rr=2.0)),
        ("trap_rr3_protect", dict(rr=3.0)),
        ("trap_rr4_protect", dict(rr=4.0)),
        ("trap_peak_arm400", dict(peak_arm=400, peak_lock=200, peak_gb=200)),
        ("trap_peak_arm800", dict(peak_arm=800, peak_lock=400, peak_gb=400)),
        ("trap_soft_tighter", dict(soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("trap_max3", dict(max_trades=3)),
        ("trap_daystop50", dict(day_stop=50)),
        ("trap_daystop100", dict(day_stop=100)),
        ("trap_no_soft", dict(soft_frac=0, soft_max_mfe_r=0, soft_rs=0)),
        ("trap_no_peak", dict(peak_arm=0, peak_lock=0, peak_gb=0)),
        ("trap_trap_only", dict(mode="trap")),
        ("trap_entry_1015_1415", dict(entry_s=10 * 60 + 15, entry_e=14 * 60 + 15)),
    ]

    for label, kw in trap_cfgs:
        tn = filter_oos(sim_trap(nifty, min_risk=4, max_risk=28, **kw), OOS)
        tb = filter_oos(sim_trap(bank, min_risk=8, max_risk=50, **kw), OOS)
        # combine by calendar day
        by = defaultdict(float)
        ntr = 0
        for t in tn + tb:
            by[t["day"]] += t["rs"]
            ntr += 1
        days = sorted(by)
        nets = [by[d] for d in days]
        if not nets:
            continue
        wins = sum(x for x in nets if x > 0)
        losses = -sum(x for x in nets if x < 0)
        rows.append(
            dict(
                book="index_trap",
                label=label,
                days=len(days),
                trades=ntr,
                net=round(sum(nets), 1),
                avg=round(sum(nets) / len(nets), 1),
                green=round(sum(1 for x in nets if x > 0) / len(nets) * 100, 1),
                pf=round(wins / losses, 2) if losses > 0 else 99,
                worst=round(min(nets), 1),
                tpd=round(ntr / len(nets), 2),
            )
        )

    # --- Crude variants ---
    if crude is not None:
        crude_cfgs = [
            ("selective_current", dict(sl=40, tp=80, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
            ("selective_or80", dict(sl=40, tp=80, max_or=80, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
            ("selective_or100", dict(sl=40, tp=80, max_or=100, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
            ("selective_sl30_tp60", dict(sl=30, tp=60, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
            ("selective_sl50_tp100", dict(sl=50, tp=100, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=50)),
            ("selective_2day", dict(sl=40, tp=80, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
            ("selective_full_session", dict(sl=40, tp=80, max_or=60, entry_s=10 * 60, entry_e=22 * 60, max_day=1, day_loss=40)),
            ("daily_profit_style", dict(sl=20, tp=40, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
            ("all_green_like", dict(sl=15, tp=30, max_or=999, entry_s=10 * 60, entry_e=23 * 60, max_day=0, day_loss=150, first_win=False, confirm=True)),
        ]
        for label, kw in crude_cfgs:
            tr = filter_oos(sim_crude(crude, **kw), "2026-03-23")
            rows.append(dict(book="crude", **summarize(tr, label)))

    # Score: prefer high avg, high green, not-terrible worst
    def score(r):
        return r["avg"] * 0.5 + r["green"] * 2 + min(0, r["worst"]) * 0.05 + r["pf"] * 20

    index_rows = sorted([r for r in rows if r["book"] == "index_trap"], key=score, reverse=True)
    crude_rows = sorted([r for r in rows if r["book"] == "crude"], key=score, reverse=True)

    summary = {
        "oos_from": OOS,
        "charges": {"index_rt": CHARGE_IDX, "crude_rt": CHARGE_CRUDE},
        "index_top": index_rows[:8],
        "index_current": next((r for r in index_rows if r["label"] == "trap_current_app"), None),
        "crude_top": crude_rows[:8],
        "crude_current": next((r for r in crude_rows if r["label"] == "selective_current"), None),
        "all": rows,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))

    print("=== INDEX TRAP (Nifty+Bank desk days, OOS≥2025, after ₹40/fill) ===")
    print(f"{'label':28} {'avg':>8} {'green%':>7} {'worst':>8} {'pf':>6} {'tpd':>5} {'net':>10}")
    for r in index_rows[:10]:
        print(
            f"{r['label']:28} {r['avg']:8.1f} {r['green']:7.1f} {r['worst']:8.1f} {r['pf']:6.2f} {r['tpd']:5.2f} {r['net']:10.1f}"
        )
    print("\n=== CRUDE (MCX sample, after ₹50/fill) ===")
    print(f"{'label':28} {'avg':>8} {'green%':>7} {'worst':>8} {'pf':>6} {'tpd':>5} {'net':>10}")
    for r in crude_rows:
        print(
            f"{r['label']:28} {r['avg']:8.1f} {r['green']:7.1f} {r['worst']:8.1f} {r['pf']:6.2f} {r['tpd']:5.2f} {r['net']:10.1f}"
        )
    print(f"\nWrote {OUT / 'summary.json'}")


if __name__ == "__main__":
    main()
