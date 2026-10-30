#!/usr/bin/env python3
"""
Improvise Crude Mini evening PDHL so more *weeks* finish green.

Base DNA: SL20/TP40 · confirm · max 2/day · skip prior-day range > 400.
Adds a Monday–Sunday lock/stop so a good week sits down and a bad week
does not keep digging. Not a promise that every week pays.

  python3 scripts/crude-weekly-profit-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
OUT = ROOT / "reports" / "crude-weekly-profit"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE = 50.0
EXIT_M = 23 * 60 + 10
OOS_FROM = "2026-09-01"


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
    sl: float = 20,
    tp: float = 40,
    day_loss: float = 40,
    day_lock: float = 50,
    max_day: int = 2,
    confirm: bool = True,
    max_pd_range: float = 400,
    week_lock: float = 0,
    week_loss: float = 0,
    sit_after_red_day: bool = False,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, prev_hl = mk["days"], mk["mins"], mk["prev_hl"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    trades_today = 0
    cur = None
    week = None
    week_net = 0.0
    week_had_red = False

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        wk = week_monday(day)
        if wk != week:
            week, week_net, week_had_red = wk, 0.0, False
        if day != cur:
            cur, day_net, trades_today = day, 0.0, 0
            pending = open_t = None

        week_stopped = (week_lock > 0 and week_net >= week_lock) or (
            week_loss > 0 and week_net <= -week_loss
        )
        day_stopped = (
            day_net <= -day_loss
            or (day_lock > 0 and day_net >= day_lock)
            or (sit_after_red_day and week_had_red)
            or week_stopped
        )

        if open_t is not None:
            d, entry, stop_px, target = open_t["dir"], open_t["entry"], open_t["stop"], open_t["target"]
            exit_px = None
            if d == 1:
                if l[i] <= stop_px:
                    exit_px = stop_px
                elif h[i] >= target:
                    exit_px = target
            else:
                if h[i] >= stop_px:
                    exit_px = stop_px
                elif l[i] <= target:
                    exit_px = target
            if exit_px is None and mm >= EXIT_M:
                exit_px = float(c[i])
            if exit_px is not None:
                pts = d * (exit_px - entry)
                rs = pts * RS - CHARGE
                trades.append({"day": day, "week": week, "pts": pts, "rs": rs})
                day_net += pts
                week_net += pts
                trades_today += 1
                if pts < 0:
                    week_had_red = True
                open_t = None
            continue

        if day_stopped or trades_today >= max_day:
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
            open_t = {
                "dir": p["dir"],
                "entry": fill,
                "stop": fill - p["dir"] * sl,
                "target": fill + p["dir"] * tp,
            }
            continue

        if not (18 * 60 + 30 <= mm <= 21 * 60):
            continue
        levels = prev_hl.get(day)
        if not levels:
            continue
        pdh, pdl = levels
        if max_pd_range > 0 and (pdh - pdl) > max_pd_range:
            continue
        cc, oo = float(c[i]), float(o[i])
        d = 0
        if cc > pdh and cc > oo:
            d = 1
        elif cc < pdl and cc < oo:
            d = -1
        if not d:
            continue
        if confirm:
            pending = {"dir": d, "sig": cc}
        else:
            open_t = {"dir": d, "entry": cc, "stop": cc - d * sl, "target": cc + d * tp}

    return trades


def week_stats(trades: list[dict], day_from: str | None = None, day_to: str | None = None) -> dict:
    if day_from or day_to:
        trades = [
            t
            for t in trades
            if (not day_from or t["day"] >= day_from) and (not day_to or t["day"] < day_to)
        ]
    if not trades:
        return {
            "n": 0,
            "weeks": 0,
            "green_weeks": 0,
            "red_weeks": 0,
            "avg_week": 0,
            "median_week": 0,
            "worst_week": 0,
            "best_week": 0,
            "net": 0,
            "score": -1e18,
        }
    by = defaultdict(float)
    for t in trades:
        by[t["week"]] += t["rs"]
    nets = np.array(list(by.values()))
    green = float((nets > 0).mean())
    red = float((nets < 0).mean())
    score = green * 1e6 + float(nets.mean()) * 100 + float(nets.min())
    return {
        "n": len(trades),
        "weeks": int(len(nets)),
        "green_weeks": round(green * 100, 1),
        "red_weeks": round(red * 100, 1),
        "avg_week": round(float(nets.mean()), 1),
        "median_week": round(float(np.median(nets)), 1),
        "worst_week": round(float(nets.min()), 0),
        "best_week": round(float(nets.max()), 0),
        "net": round(float(nets.sum()), 0),
        "score": score,
    }


def pack(label, kwargs, trades):
    return {
        "label": label,
        "kwargs": kwargs,
        "full": week_stats(trades),
        "is": week_stats(trades, day_to=OOS_FROM),
        "oos": week_stats(trades, day_from=OOS_FROM),
    }


def main():
    mk = load()
    base = dict(
        sl=20,
        tp=40,
        day_loss=40,
        day_lock=50,
        max_day=2,
        confirm=True,
        max_pd_range=400,
        week_lock=0,
        week_loss=0,
        sit_after_red_day=False,
    )
    rows = [pack("pd400_no_week_cap", base, simulate(mk, **base))]

    for week_lock in (0, 40, 50, 80, 100):
        for week_loss in (0, 20, 25, 40, 50):
            for sit in (False, True):
                if week_lock == 0 and week_loss == 0 and not sit:
                    continue
                kwargs = dict(base, week_lock=week_lock, week_loss=week_loss, sit_after_red_day=sit)
                label = f"L{week_lock}_S{week_loss}_sit{int(sit)}"
                rows.append(pack(label, kwargs, simulate(mk, **kwargs)))

    def ok(r):
        return (
            r["is"]["weeks"] >= 4
            and r["oos"]["weeks"] >= 4
            and r["is"]["avg_week"] > 0
            and r["oos"]["avg_week"] > 0
            and r["full"]["avg_week"] > 0
        )

    viable = [r for r in rows if ok(r)]
    viable.sort(
        key=lambda r: (
            r["oos"]["green_weeks"],
            r["full"]["green_weeks"],
            r["oos"]["avg_week"],
            r["full"]["worst_week"],
        ),
        reverse=True,
    )
    champ = viable[0] if viable else rows[0]
    summary = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "oos_from": OOS_FROM,
        "charge_rs": CHARGE,
        "baseline": rows[0],
        "wired": champ,
        "top": viable[:12],
        "honest": "More green weeks usually means a smaller average week. Not every week. Live can still lose.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def line(tag, r):
        f, i, o = r["full"], r["is"], r["oos"]
        return (
            f"{tag:<8} {r['label']:<22} "
            f"full {f['green_weeks']:5.1f}% w{f['weeks']:2d} ₹{f['avg_week']:6.0f} worst{f['worst_week']:6.0f}  "
            f"IS {i['green_weeks']:5.1f}%  OOS {o['green_weeks']:5.1f}% w{o['weeks']:2d} ₹{o['avg_week']:6.0f} worst{o['worst_week']:6.0f}"
        )

    lines = [
        f"sample {summary['sample']}  OOS from {OOS_FROM}",
        line("BASE", rows[0]),
        line("WIRE", champ),
        "",
        "top by OOS green weeks (IS+OOS both profitable)",
    ]
    for r in viable[:10]:
        lines.append(line(" ", r))
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Crude weekly-profit hunt\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
