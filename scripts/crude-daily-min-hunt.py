#!/usr/bin/env python3
"""
Hunt a ₹150–200 daily take on Crude Mini that still fires on red,
sideways, and quiet sessions — not only PDHL trend days.

Not a guaranteed profit. Scores rupees after ₹50/RT on 1 lot × ₹10/pt.
Only full-session days (enough 5m bars) count as tradable.

  python3 scripts/crude-daily-min-hunt.py
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
OUT = ROOT / "reports" / "crude-daily-min"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE = 50.0
SL = 20.0
DAY_LOSS = 40.0
MAX_PD = 400.0
ENTRY_S = 10 * 60
ENTRY_E = 23 * 60
EXIT_M = 23 * 60 + 10
OR_S = 10 * 60
OR_E = 11 * 60
OOS_FROM = "2026-09-01"
MIN_BARS = 80
NEED_RS = 150.0


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
    bars_n = {}
    kind = {}
    for d in uniq:
        mask = days == d
        bars_n[d] = int(mask.sum())
        hi, lo = float(h[mask].max()), float(l[mask].min())
        day_hl[d] = (hi, lo)
        after = mask & (mins >= ENTRY_S) & (mins <= ENTRY_E)
        if after.sum() < 12 or bars_n[d] < MIN_BARS:
            kind[d] = "thin"
            continue
        ar = float(h[after].max() - l[after].min())
        ao = float(o[after][0])
        ac = float(c[after][-1])
        move = ac - ao
        if ar < 80:
            kind[d] = "quiet"
        elif abs(move) < 0.35 * ar:
            kind[d] = "sideways"
        elif move > 0:
            kind[d] = "greenish"
        else:
            kind[d] = "red"
    prev_hl = {}
    for i, d in enumerate(uniq):
        if i:
            prev_hl[d] = day_hl[uniq[i - 1]]
    # running session VWAP (typical price * vol proxy = 1 per bar)
    vwap = np.zeros(len(c))
    cur = None
    pv = 0.0
    nbar = 0
    for i in range(len(c)):
        d = days[i]
        if d != cur:
            cur, pv, nbar = d, 0.0, 0
        tp = (h[i] + l[i] + c[i]) / 3.0
        pv += tp
        nbar += 1
        vwap[i] = pv / nbar
    return dict(
        o=o,
        h=h,
        l=l,
        c=c,
        days=days,
        mins=mins,
        n=len(c),
        prev_hl=prev_hl,
        kind=kind,
        uniq=uniq,
        vwap=vwap,
    )


def session_or(days, mins, h, l, i, or_s=OR_S, or_e=OR_E):
    day = days[i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and days[j] == day:
        mm = int(mins[j])
        if or_s <= mm <= or_e:
            hi = max(hi, float(h[j]))
            lo = min(lo, float(l[j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def swing_hl(h, l, i, lb=5):
    start = max(0, i - lb)
    return float(h[start:i].max()) if i > start else None, float(l[start:i].min()) if i > start else None


def signal(mode, mk, i, day, mm):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, vwap = mk["days"], mk["mins"], mk["vwap"]
    cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
    body_up = cc > oo
    body_dn = cc < oo

    def pdhl():
        levels = mk["prev_hl"].get(day)
        if not levels:
            return 0
        pdh, pdl = levels
        if (pdh - pdl) > MAX_PD:
            return 0
        if cc > pdh and body_up:
            return 1
        if cc < pdl and body_dn:
            return -1
        return 0

    def trap():
        sh, slv = swing_hl(h, l, i, 6)
        if sh is None:
            return 0
        pierce = 8.0
        if ll < slv - pierce and cc > slv and body_up:
            return 1
        if hh > sh + pierce and cc < sh and body_dn:
            return -1
        return 0

    def orb_break():
        if mm <= OR_E:
            return 0
        orb = session_or(days, mins, h, l, i)
        if not orb:
            return 0
        oh, ol = orb
        if oh - ol > 180:
            return 0
        if cc > oh and body_up:
            return 1
        if cc < ol and body_dn:
            return -1
        return 0

    def orb_fade():
        if mm <= OR_E:
            return 0
        orb = session_or(days, mins, h, l, i)
        if not orb:
            return 0
        oh, ol = orb
        width = oh - ol
        if width < 12 or width > 220:
            return 0
        # Close back inside after poking the OR — fade toward mid.
        if hh > oh and cc < oh and body_dn:
            return -1
        if ll < ol and cc > ol and body_up:
            return 1
        return 0

    def vwap_fade():
        vw = float(vwap[i])
        dist = cc - vw
        if abs(dist) < 18:
            return 0
        if dist > 0 and body_dn:
            return -1
        if dist < 0 and body_up:
            return 1
        return 0

    if mode == "pdhl":
        return pdhl()
    if mode == "trap":
        return trap()
    if mode == "orb_break":
        return orb_break()
    if mode == "orb_fade":
        return orb_fade()
    if mode == "vwap_fade":
        return vwap_fade()
    if mode == "pdhl_trap":
        return pdhl() or trap()
    if mode == "pdhl_fade":
        return pdhl() or orb_fade()
    if mode == "pdhl_vwap":
        return pdhl() or vwap_fade()
    if mode == "fade_trap":
        return orb_fade() or trap()
    if mode == "all_three":
        return pdhl() or orb_fade() or trap()
    return 0


def simulate(
    mk: dict,
    *,
    mode: str,
    tp: float,
    scratch: float,
    against_close: bool,
    first_win: bool,
    day_lock: float,
    week_lock: float,
    max_day: int,
    entry_s: int = ENTRY_S,
    entry_e: int = ENTRY_E,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
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
        trades.append(
            {
                "day": day,
                "week": wk,
                "pts": pts,
                "rs": rs,
                "reason": reason,
                "kind": mk["kind"].get(day, "thin"),
            }
        )
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
            hi = float(h[i])
            lo = float(l[i])
            cl = float(c[i])
            exit_px = None
            reason = None
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
            }
            continue

        if not (entry_s <= mm <= entry_e):
            continue
        d = signal(mode, mk, i, day, mm)
        if not d:
            continue
        pending = {"dir": d, "sig": float(c[i])}

    return trades


def day_stats(mk, trades, day_from=None, day_to=None):
    tradable = [
        d
        for d in mk["uniq"]
        if mk["kind"].get(d) not in (None, "thin")
        and (not day_from or d >= day_from)
        and (not day_to or d < day_to)
    ]
    by = defaultdict(float)
    for t in trades:
        if day_from and t["day"] < day_from:
            continue
        if day_to and t["day"] >= day_to:
            continue
        by[t["day"]] += t["rs"]
    hit = 0
    green = 0
    red = 0
    flat = 0
    nets = []
    by_kind = defaultdict(lambda: {"n": 0, "hit": 0, "green": 0, "flat": 0, "rs": 0.0})
    for d in tradable:
        rs = by.get(d, 0.0)
        nets.append(rs)
        k = mk["kind"][d]
        row = by_kind[k]
        row["n"] += 1
        row["rs"] += rs
        if rs >= NEED_RS:
            hit += 1
            row["hit"] += 1
        if rs > 0:
            green += 1
            row["green"] += 1
        elif rs < 0:
            red += 1
        else:
            flat += 1
            row["flat"] += 1
    reasons = defaultdict(int)
    ntr = 0
    for t in trades:
        if day_from and t["day"] < day_from:
            continue
        if day_to and t["day"] >= day_to:
            continue
        reasons[t["reason"]] += 1
        ntr += 1
    arr = np.array(nets) if nets else np.array([0.0])
    weeks = defaultdict(float)
    for d, rs in by.items():
        weeks[week_monday(d)] += rs
    wnets = np.array(list(weeks.values())) if weeks else np.array([0.0])
    return {
        "tradable": len(tradable),
        "traded": sum(1 for d in tradable if d in by),
        "n": ntr,
        "hit150": hit,
        "hit150_pct": round(100.0 * hit / len(tradable), 1) if tradable else 0,
        "green_days": green,
        "green_pct": round(100.0 * green / len(tradable), 1) if tradable else 0,
        "red_days": red,
        "flat_days": flat,
        "avg_day": round(float(arr.mean()), 1),
        "worst_day": round(float(arr.min()), 0),
        "best_day": round(float(arr.max()), 0),
        "net": round(float(arr.sum()), 0),
        "avg_week": round(float(wnets.mean()), 1),
        "worst_week": round(float(wnets.min()), 0),
        "green_weeks": round(100.0 * float((wnets > 0).mean()), 1) if len(wnets) else 0,
        "tp_hit": round(100.0 * reasons.get("tp", 0) / ntr, 1) if ntr else 0,
        "scratch_n": reasons.get("scratch", 0),
        "smell_n": reasons.get("smell", 0),
        "sl_n": reasons.get("sl", 0),
        "kinds": {
            k: {
                "n": v["n"],
                "hit150": v["hit"],
                "hit_pct": round(100.0 * v["hit"] / v["n"], 1) if v["n"] else 0,
                "green": v["green"],
                "flat": v["flat"],
                "avg": round(v["rs"] / v["n"], 0) if v["n"] else 0,
            }
            for k, v in by_kind.items()
        },
    }


def pack(label, kwargs, mk, trades):
    return {
        "label": label,
        "kwargs": kwargs,
        "full": day_stats(mk, trades),
        "oos": day_stats(mk, trades, day_from=OOS_FROM),
    }


def ok(r):
    f, o = r["full"], r["oos"]
    return (
        f["tradable"] >= 40
        and o["tradable"] >= 15
        and f["avg_day"] > 0
        and o["avg_day"] > 0
        and f["worst_week"] >= -500
        and o["worst_week"] >= -500
    )


def main():
    mk = load()
    kinds = defaultdict(int)
    for d in mk["uniq"]:
        kinds[mk["kind"].get(d, "thin")] += 1
    print("tradable kinds", dict(kinds), flush=True)

    baseline = dict(
        mode="pdhl",
        tp=30,
        scratch=8,
        against_close=True,
        first_win=True,
        day_lock=20,
        week_lock=40,
        max_day=2,
    )
    rows = [pack("wired_weekly_bank", baseline, mk, simulate(mk, **baseline))]

    modes = [
        "pdhl",
        "trap",
        "orb_break",
        "orb_fade",
        "vwap_fade",
        "pdhl_trap",
        "pdhl_fade",
        "pdhl_vwap",
        "fade_trap",
        "all_three",
    ]
    grid = product(
        modes,
        (15, 20, 25, 30),
        (6, 8, 10),
        (15, 20, 25),
        (0, 40),
        (2, 3),
    )
    seen = set()
    for mode, tp, scratch, dlock, wlock, md in grid:
        # Day lock should not sit before the target can print ₹150–200.
        if dlock > tp:
            continue
        kw = dict(
            mode=mode,
            tp=tp,
            scratch=scratch,
            against_close=True,
            first_win=True,
            day_lock=dlock,
            week_lock=wlock,
            max_day=md,
        )
        label = (
            f"{mode}|tp{tp:g}|sc{scratch:g}|dl{dlock:g}|wl{wlock:g}|m{md}"
        )
        if label in seen:
            continue
        seen.add(label)
        rows.append(pack(label, kw, mk, simulate(mk, **kw)))

    viable = [r for r in rows if ok(r)]
    viable.sort(
        key=lambda r: (
            r["full"]["hit150_pct"],
            r["oos"]["hit150_pct"],
            min(r["full"]["kinds"].get(k, {}).get("hit_pct", 0) for k in ("red", "sideways", "quiet", "greenish")),
            r["full"]["green_pct"],
            r["oos"]["avg_day"],
            r["full"]["avg_day"],
            r["full"]["worst_week"],
        ),
        reverse=True,
    )
    champ = viable[0] if viable else rows[0]
    summary = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "need_rs": NEED_RS,
        "honest": "Not a guaranteed daily ₹150. Thin cache days cannot pay. Red/sideways still miss.",
        "kinds": dict(kinds),
        "baseline": rows[0],
        "wired_candidate": champ,
        "top": viable[:12],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def line(tag, r):
        f, o = r["full"], r["oos"]
        kinds_s = " ".join(
            f"{k[0]}{v['hit_pct']:.0f}"
            for k, v in sorted(f["kinds"].items())
        )
        return (
            f"{tag:<6} {r['label']:<42} "
            f"hit150 {f['hit150_pct']:5.1f}% {f['hit150']:2d}/{f['tradable']:2d} "
            f"green {f['green_pct']:5.1f}% avg₹{f['avg_day']:6.0f} "
            f"worstD {f['worst_day']:6.0f} week {f['green_weeks']:5.1f}% ₹{f['avg_week']:6.0f} "
            f"OOS hit {o['hit150_pct']:5.1f}% ₹{o['avg_day']:5.0f}  {kinds_s}"
        )

    lines = [
        f"sample {summary['sample']}  need ₹{NEED_RS:.0f}/tradable day",
        line("BASE", rows[0]),
        line("BEST", champ),
        "",
        "top by ₹150+ hit rate (IS+OOS both profitable, worst week ≥ −₹500)",
    ]
    for r in viable[:15]:
        lines.append(line(" ", r))
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Crude daily min ₹150 hunt\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
