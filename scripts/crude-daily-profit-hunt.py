#!/usr/bin/env python3
"""
Crude Daily Profit hunt — Trap-style (high green%, day lock, tight ₹ TP/SL).

Goal: closest to Nifty Trap/Kutty "daily income" feel on CRUDEOILM (₹10/pt).

Uses reports/analyst-cache/crudeoilm-5m-merged.json

  python3 scripts/crude-daily-profit-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
OUT = ROOT / "reports" / "crude-daily-profit"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
EXIT_M = 23 * 60 + 10


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load() -> dict:
    rows = json.loads(CACHE.read_text())
    for r in rows:
        r["date"] = str(r["date"]).replace("T", " ").split("+")[0]
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
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c))


def swing_hl(h, l, i, lb=5):
    start = max(0, i - lb)
    return float(h[start:i].max()), float(l[start:i].min())


def prev_day_hl(days, h, l, i):
    day = days[i]
    prev = None
    j = i - 1
    while j >= 0:
        if days[j] < day:
            prev = days[j]
            break
        j -= 1
    if prev is None:
        return None
    pdh, pdl = -1e18, 1e18
    k = i - 1
    while k >= 0 and days[k] >= prev:
        if days[k] == prev:
            pdh = max(pdh, float(h[k]))
            pdl = min(pdl, float(l[k]))
        k -= 1
    return None if pdh < -1e17 else (pdh, pdl)


def orb_hl(days, mins, h, l, i):
    day = days[i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and days[j] == day:
        mm = int(mins[j])
        if 9 * 60 <= mm <= 10 * 60:
            hi = max(hi, float(h[j]))
            lo = min(lo, float(l[j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def simulate(
    mk: dict,
    *,
    mode: str,
    sl: float,
    tp: float,
    day_loss: float,
    day_lock: float,
    max_day: int,
    first_win: bool,
    entry_s: int,
    entry_e: int,
    confirm: bool,
    pierce: float = 8.0,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    trades_today = 0
    won = False
    cur = None

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None

        stopped = (
            day_net <= -day_loss
            or (day_lock > 0 and day_net >= day_lock)
            or (first_win and won)
        )

        if open_t is not None:
            d, entry, stop_px, target = open_t["dir"], open_t["entry"], open_t["stop"], open_t["target"]
            exit_px = reason = None
            if d == 1:
                if l[i] <= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif h[i] >= target:
                    exit_px, reason = target, "tp"
            else:
                if h[i] >= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif l[i] <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and mm >= EXIT_M:
                exit_px, reason = float(c[i]), "eod"
            if exit_px is not None:
                pts = d * (exit_px - entry)
                trades.append({"day": day, "pts": pts, "rs": pts * RS, "reason": reason})
                day_net += pts
                trades_today += 1
                if pts > 0:
                    won = True
                open_t = None
            continue

        if stopped or trades_today >= max_day:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            if p["dir"] == 1:
                ok = c[i] > o[i] and c[i] > p["sig"]
            else:
                ok = c[i] < o[i] and c[i] < p["sig"]
            if confirm and not ok:
                continue
            stop_px = fill - p["dir"] * sl
            target = fill + p["dir"] * tp
            open_t = {"dir": p["dir"], "entry": fill, "stop": stop_px, "target": target}
            continue

        if not (entry_s <= mm <= entry_e):
            continue

        d = 0
        if mode == "trap":
            if ema[i] != ema[i]:
                continue
            j0 = i
            while j0 > 0 and days[j0 - 1] == day:
                j0 -= 1
            if i - j0 < 5:
                continue
            sh, slv = swing_hl(h, l, i)
            cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
            trap_buy = ll < slv - pierce and cc > slv and cc > oo
            trap_sell = hh > sh + pierce and cc < sh and cc < oo
            if trap_buy and cc > ema[i]:
                d = 1
            elif trap_sell and cc < ema[i]:
                d = -1
        elif mode == "morning":
            orb = orb_hl(days, mins, h, l, i)
            if not orb or orb[0] - orb[1] > 120:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > orb[0] and cc > oo:
                d = 1
            elif cc < orb[1] and cc < oo:
                d = -1
        else:  # evening pdhl
            levels = prev_day_hl(days, h, l, i)
            if not levels:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > levels[0] and cc > oo:
                d = 1
            elif cc < levels[1] and cc < oo:
                d = -1

        if not d:
            continue
        if confirm:
            pending = {"dir": d, "sig": float(c[i])}
        else:
            fill = float(c[i])
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * sl,
                "target": fill + d * tp,
            }

    return trades


def summarize(trades: list[dict], label: str) -> dict:
    if not trades:
        return {"label": label, "n": 0, "net": 0, "avg_day": 0, "green": 0, "red": 0, "pf": 0, "score": -1e18}
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    nets = np.array(list(by.values()))
    rs = np.array([t["rs"] for t in trades])
    wins = float(rs[rs > 0].sum())
    loss = float(-rs[rs < 0].sum())
    pf = wins / loss if loss > 0 else 99.0
    traded = nets[np.abs(nets) > 1e-9]
    green = float((traded > 0).mean()) if len(traded) else 0.0
    red = float((traded < 0).mean()) if len(traded) else 0.0
    # Prefer green%, then avg/day, then PF (daily-profit feel)
    score = green * 1e6 + float(nets.mean()) * 100 + pf * 10
    return {
        "label": label,
        "n": len(trades),
        "days": len(by),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "red": round(red * 100, 1),
        "pf": round(pf, 2),
        "worst_day": round(float(nets.min()), 0),
        "score": score,
    }


def main():
    mk = load()
    rows = []

    # Baseline champion
    m = simulate(mk, mode="morning", sl=80, tp=250, day_loss=240, day_lock=0, max_day=1, first_win=False, entry_s=10*60, entry_e=12*60, confirm=False)
    e = simulate(mk, mode="evening", sl=80, tp=150, day_loss=240, day_lock=0, max_day=1, first_win=False, entry_s=18*60+30, entry_e=20*60+30, confirm=False)
    rows.append(summarize(m + e, "champion_bare"))

    # Old daily-income
    m = simulate(mk, mode="morning", sl=40, tp=80, day_loss=50, day_lock=100, max_day=1, first_win=False, entry_s=10*60, entry_e=12*60, confirm=False)
    e = simulate(mk, mode="evening", sl=40, tp=50, day_loss=50, day_lock=100, max_day=1, first_win=False, entry_s=18*60+30, entry_e=20*60+30, confirm=False)
    rows.append(summarize(m + e, "daily_income_v1"))

    # Grid: Trap Kutty-style ₹ TP/SL on crude (pts = ₹/10)
    # Kutty was ₹600/₹200 → 60/20 pts
    for sl, tp in [(20, 60), (25, 50), (30, 60), (30, 90), (40, 80), (20, 40), (25, 75)]:
        for day_lock in (50, 80, 100, 150):
            for day_loss in (40, 50, 60, 80):
                for first_win in (True, False):
                    for window in ("both", "evening", "morning", "trap"):
                        if window == "trap":
                            tr = simulate(
                                mk,
                                mode="trap",
                                sl=sl,
                                tp=tp,
                                day_loss=day_loss,
                                day_lock=day_lock,
                                max_day=2,
                                first_win=first_win,
                                entry_s=10 * 60,
                                entry_e=22 * 60,
                                confirm=True,
                            )
                            label = f"trap_c_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_fw{int(first_win)}"
                        elif window == "both":
                            m = simulate(mk, mode="morning", sl=sl, tp=tp, day_loss=day_loss, day_lock=day_lock, max_day=1, first_win=first_win, entry_s=10*60, entry_e=12*60, confirm=True)
                            e = simulate(mk, mode="evening", sl=sl, tp=tp, day_loss=day_loss, day_lock=day_lock, max_day=1, first_win=first_win, entry_s=18*60+30, entry_e=20*60+30, confirm=True)
                            tr = m + e
                            label = f"orbpdhl_c_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_fw{int(first_win)}"
                        elif window == "evening":
                            tr = simulate(mk, mode="evening", sl=sl, tp=tp, day_loss=day_loss, day_lock=day_lock, max_day=2, first_win=first_win, entry_s=18*60+30, entry_e=21*60, confirm=True)
                            label = f"eve_c_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_fw{int(first_win)}"
                        else:
                            tr = simulate(mk, mode="morning", sl=sl, tp=tp, day_loss=day_loss, day_lock=day_lock, max_day=2, first_win=first_win, entry_s=10*60, entry_e=12*60, confirm=True)
                            label = f"morn_c_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_fw{int(first_win)}"
                        rows.append(summarize(tr, label))

    # Keep positive expectancy + green >= 55%
    viable = [r for r in rows if r["n"] >= 20 and r["avg_day"] > 0 and r["green"] >= 55]
    if not viable:
        viable = [r for r in rows if r["n"] >= 15 and r["avg_day"] > 0]
    viable.sort(key=lambda r: r["score"], reverse=True)
    top = viable[:15]
    champ = top[0] if top else max(rows, key=lambda r: r["score"])

    summary = {
        "sample": "MCX CRUDEOILM Mar–Jul 2026",
        "bars": int(mk["n"]),
        "champion_baseline": next(r for r in rows if r["label"] == "champion_bare"),
        "daily_income_v1": next(r for r in rows if r["label"] == "daily_income_v1"),
        "top": top,
        "wired_candidate": champ,
        "note": "Daily-profit = maximize green% then ₹/day. Not 100% green.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    lines = [f"{'book':<48} {'net':>8} {'₹/day':>7} {'g%':>5} {'pf':>5} {'worst':>7}"]
    for r in [summary["champion_baseline"], summary["daily_income_v1"], *top[:10]]:
        lines.append(
            f"{r['label']:<48} {r['net']:8.0f} {r['avg_day']:7.0f} {r['green']:4.1f}% {r['pf']:5.2f} {r.get('worst_day',0):7.0f}"
        )
    report = "# Crude daily-profit hunt\n\n```\n" + "\n".join(lines) + f"\n```\n\nWire: **{champ['label']}**\n"
    (OUT / "README.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
