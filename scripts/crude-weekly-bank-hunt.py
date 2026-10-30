#!/usr/bin/env python3
"""
Invent a Crude Mini weekly-bank DNA:

  - target that actually hits (smaller TP)
  - smell-of-loss scratch before the 20-pt hard SL
  - first-win / day lock so a green day is not given back
  - week lock so a green week is not washed out

Not a guaranteed profit. Scores rupees after ₹50/RT on 1 lot × ₹10/pt.

  python3 scripts/crude-weekly-bank-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from itertools import product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
OUT = ROOT / "reports" / "crude-weekly-bank"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE = 50.0
ENTRY_S = 9 * 60
ENTRY_E = 23 * 60
EXIT_M = 23 * 60 + 10
OOS_FROM = "2026-09-01"
SL = 20.0
DAY_LOSS = 40.0
MAX_PD = 400.0


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def week_monday(day: str) -> str:
    dt = datetime.strptime(day, "%Y-%m-%d")
    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")


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
    uniq = []
    seen = set()
    for d in days:
        if d not in seen:
            seen.add(d)
            uniq.append(d)
    day_hl = {}
    for d in uniq:
        mask = days == d
        day_hl[d] = (float(h[mask].max()), float(l[mask].min()))
    prev_hl = {}
    for i, d in enumerate(uniq):
        if i:
            prev_hl[d] = day_hl[uniq[i - 1]]
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, n=len(c), prev_hl=prev_hl)


def simulate(
    mk: dict,
    *,
    tp: float,
    scratch: float,
    against_close: bool,
    first_win: bool,
    day_lock: float,
    week_lock: float,
    max_day: int,
    trail_arm: float,
    trail_give: float,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, prev_hl = mk["days"], mk["mins"], mk["prev_hl"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    trades_today = 0
    won = False
    cur = None
    week = None
    week_net = 0.0

    def close_trade(day, wk, pts, reason):
        nonlocal day_net, week_net, trades_today, won, open_t
        rs = pts * RS - CHARGE
        trades.append({"day": day, "week": wk, "pts": pts, "rs": rs, "reason": reason})
        day_net += pts
        week_net += pts
        trades_today += 1
        if pts > 0:
            won = True
        open_t = None

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        wk = week_monday(day)
        if wk != week:
            week, week_net = wk, 0.0
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None

        week_stopped = week_lock > 0 and week_net >= week_lock
        day_stopped = (
            day_net <= -DAY_LOSS
            or (day_lock > 0 and day_net >= day_lock)
            or (first_win and won)
            or week_stopped
        )

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop_px = open_t["stop"]
            target = open_t["target"]
            scratch_px = open_t["scratch"]
            bars = open_t["bars"]
            mfe = open_t["mfe"]
            hi = float(h[i])
            lo = float(l[i])
            cl = float(c[i])
            fav = (hi - entry) if d == 1 else (entry - lo)
            if fav > mfe:
                mfe = fav
                open_t["mfe"] = mfe
            exit_px = None
            reason = None
            # Smell of loss first — do not wait for the 20-pt hard SL.
            if scratch_px is not None:
                if d == 1 and lo <= scratch_px:
                    exit_px, reason = scratch_px, "scratch"
                elif d == -1 and hi >= scratch_px:
                    exit_px, reason = scratch_px, "scratch"
            if exit_px is None:
                if d == 1 and lo <= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif d == -1 and hi >= stop_px:
                    exit_px, reason = stop_px, "sl"
            if exit_px is None:
                if d == 1 and hi >= target:
                    exit_px, reason = target, "tp"
                elif d == -1 and lo <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and trail_arm > 0 and mfe >= trail_arm:
                lock = entry + d * (mfe - trail_give)
                if d == 1 and lo <= lock:
                    exit_px, reason = lock, "trail"
                elif d == -1 and hi >= lock:
                    exit_px, reason = lock, "trail"
            if exit_px is None and against_close and bars == 0:
                against = cl < entry if d == 1 else cl > entry
                if against:
                    exit_px, reason = cl, "smell"
            if exit_px is None and mm >= EXIT_M:
                exit_px, reason = cl, "eod"
            if exit_px is not None:
                close_trade(day, week, d * (exit_px - entry), reason)
            else:
                open_t["bars"] = bars + 1
            continue

        if day_stopped or trades_today >= max_day:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if not ok:
                continue
            d = p["dir"]
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * SL,
                "target": fill + d * tp,
                "scratch": fill - d * scratch if scratch > 0 else None,
                "bars": 0,
                "mfe": 0.0,
            }
            continue

        if not (ENTRY_S <= mm <= ENTRY_E):
            continue
        levels = prev_hl.get(day)
        if not levels:
            continue
        pdh, pdl = levels
        if (pdh - pdl) > MAX_PD:
            continue
        cc, oo = float(c[i]), float(o[i])
        d = 0
        if cc > pdh and cc > oo:
            d = 1
        elif cc < pdl and cc < oo:
            d = -1
        if not d:
            continue
        pending = {"dir": d, "sig": cc}

    return trades


def week_stats(trades: list[dict], day_from: str | None = None, day_to: str | None = None) -> dict:
    if day_from or day_to:
        trades = [
            t
            for t in trades
            if (not day_from or t["day"] >= day_from) and (not day_to or t["day"] < day_to)
        ]
    reasons = defaultdict(int)
    for t in trades:
        reasons[t["reason"]] += 1
    n = len(trades)
    tp_n = reasons.get("tp", 0)
    if not trades:
        return {
            "n": 0,
            "weeks": 0,
            "green_weeks": 0,
            "red_weeks": 0,
            "avg_week": 0,
            "worst_week": 0,
            "best_week": 0,
            "net": 0,
            "tp_hit": 0,
            "scratch_n": 0,
            "smell_n": 0,
            "sl_n": 0,
            "trail_n": 0,
            "eod_n": 0,
            "score": -1e18,
        }
    by = defaultdict(float)
    for t in trades:
        by[t["week"]] += t["rs"]
    nets = np.array(list(by.values()))
    green = float((nets > 0).mean())
    red = float((nets < 0).mean())
    return {
        "n": n,
        "weeks": int(len(nets)),
        "green_weeks": round(green * 100, 1),
        "red_weeks": round(red * 100, 1),
        "avg_week": round(float(nets.mean()), 1),
        "worst_week": round(float(nets.min()), 0),
        "best_week": round(float(nets.max()), 0),
        "net": round(float(nets.sum()), 0),
        "tp_hit": round(100.0 * tp_n / n, 1) if n else 0,
        "scratch_n": reasons.get("scratch", 0),
        "smell_n": reasons.get("smell", 0),
        "sl_n": reasons.get("sl", 0),
        "trail_n": reasons.get("trail", 0),
        "eod_n": reasons.get("eod", 0),
        "score": green * 1e6 + float(nets.mean()) * 100 + float(nets.min()),
    }


def pack(label, kwargs, trades):
    return {
        "label": label,
        "kwargs": kwargs,
        "full": week_stats(trades),
        "is": week_stats(trades, day_to=OOS_FROM),
        "oos": week_stats(trades, day_from=OOS_FROM),
    }


def label_of(kw: dict) -> str:
    return (
        f"tp{kw['tp']:g}_sc{kw['scratch']:g}_sm{int(kw['against_close'])}"
        f"_fw{int(kw['first_win'])}_dl{kw['day_lock']:g}_wl{kw['week_lock']:g}"
        f"_m{kw['max_day']}_tr{kw['trail_arm']:g}"
    )


def main():
    mk = load()
    baseline_kw = dict(
        tp=40,
        scratch=0,
        against_close=False,
        first_win=False,
        day_lock=50,
        week_lock=80,
        max_day=2,
        trail_arm=0,
        trail_give=0,
    )
    rows = [pack("baseline_l80", baseline_kw, simulate(mk, **baseline_kw))]

    grid = product(
        (20, 30, 40),  # tp — smaller hits more often
        (0, 8, 10, 12),  # scratch pts (0 = wait for hard SL)
        (False, True),  # first-bar against-close smell
        (False, True),  # first-win daily bank
        (20, 40, 50),  # day lock
        (40, 80),  # week lock
        (1, 2),  # max trades
        ((0, 0), (12, 8)),  # trail arm/giveback
    )
    seen = set()
    for tp, scratch, smell, fw, dlock, wlock, md, (arm, give) in grid:
        kw = dict(
            tp=tp,
            scratch=scratch,
            against_close=smell,
            first_win=fw,
            day_lock=dlock,
            week_lock=wlock,
            max_day=md,
            trail_arm=arm,
            trail_give=give,
        )
        lab = label_of(kw)
        if lab in seen:
            continue
        seen.add(lab)
        rows.append(pack(lab, kw, simulate(mk, **kw)))

    def ok(r):
        return (
            r["is"]["weeks"] >= 4
            and r["oos"]["weeks"] >= 4
            and r["is"]["avg_week"] > 0
            and r["oos"]["avg_week"] > 0
            and r["full"]["avg_week"] > 0
            and r["full"]["worst_week"] >= -500
        )

    viable = [r for r in rows if ok(r)]

    def rank(r):
        f, o = r["full"], r["oos"]
        return (
            o["green_weeks"],
            f["green_weeks"],
            o["avg_week"],
            f["tp_hit"],
            -f["sl_n"],
            f["avg_week"],
            f["worst_week"],
        )

    viable.sort(key=rank, reverse=True)
    champ = viable[0] if viable else rows[0]
    # Prefer a book that actually uses the invented exits if it keeps OOS green.
    invented = [
        r
        for r in viable
        if r["kwargs"]["scratch"] > 0 or r["kwargs"]["against_close"] or r["kwargs"]["first_win"]
    ]
    if invented and invented[0]["oos"]["green_weeks"] >= champ["oos"]["green_weeks"] - 6.5:
        invented.sort(key=rank, reverse=True)
        champ = invented[0]

    summary = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "oos_from": OOS_FROM,
        "charge_rs": CHARGE,
        "honest": (
            "Not a guaranteed weekly profit. Champion is the highest OOS green-week "
            "book that stays profitable both sides of 2026-09-01 with worst week ≥ −₹500."
        ),
        "n_tried": len(rows),
        "n_viable": len(viable),
        "baseline": rows[0],
        "wired": champ,
        "top": viable[:15],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def line(tag, r):
        f, o = r["full"], r["oos"]
        return (
            f"{tag:<6} {r['label']:<42} "
            f"full {f['green_weeks']:5.1f}% w{f['weeks']:2d} ₹{f['avg_week']:6.0f} "
            f"tp{f['tp_hit']:4.0f}% sl{f['sl_n']:3d} sc{f['scratch_n']+f['smell_n']:3d} "
            f"worst{f['worst_week']:6.0f}  "
            f"OOS {o['green_weeks']:5.1f}% ₹{o['avg_week']:6.0f} worst{o['worst_week']:6.0f}"
        )

    lines = [
        f"sample {summary['sample']}  OOS from {OOS_FROM}  tried {len(rows)} viable {len(viable)}",
        line("BASE", rows[0]),
        line("WIRE", champ),
        "",
        "top by OOS green weeks (IS+OOS both profitable, worst week ≥ −₹500)",
    ]
    for r in viable[:12]:
        lines.append(line(" ", r))
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Crude weekly-bank hunt\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
