#!/usr/bin/env python3
"""
Crude ALL-GREEN aim · 15:15–23:00 — fast focused hunt.
Goal: every traded day green (flat OK if no setup). Not a live guarantee.

  python3 scripts/crude-all-green-1515-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
OUT = ROOT / "reports" / "crude-all-green-1515"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
ENTRY_S = 15 * 60 + 15
ENTRY_E = 23 * 60
EXIT_M = 23 * 60 + 10


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load():
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
    # Precompute prev-day HL per day
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
        if i == 0:
            continue
        prev_hl[d] = day_hl[uniq[i - 1]]
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c), prev_hl=prev_hl)


def swing_hl(h, l, i, lb=5):
    start = max(0, i - lb)
    return float(h[start:i].max()), float(l[start:i].min())


def session_or(days, mins, h, l, i, or_s, or_e):
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


def simulate(mk, *, mode, sl, tp, day_loss, day_lock, max_day, first_win, confirm, ema_filter=False, or_e=16 * 60, max_or_w=120):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, prev_hl = mk["days"], mk["mins"], mk["ema"], mk["prev_hl"]
    n = mk["n"]
    trades, pending, open_t = [], None, None
    day_net, trades_today, won, cur = 0.0, 0, False, None

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None

        stopped = day_net <= -day_loss or (day_lock > 0 and day_net >= day_lock) or (first_win and won)

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
                trades.append({"day": day, "pts": pts, "rs": pts * RS})
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
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if confirm and not ok:
                continue
            if ema_filter and ema[i] == ema[i]:
                if (p["dir"] == 1 and fill < ema[i]) or (p["dir"] == -1 and fill > ema[i]):
                    continue
            open_t = {"dir": p["dir"], "entry": fill, "stop": fill - p["dir"] * sl, "target": fill + p["dir"] * tp}
            continue

        if not (ENTRY_S <= mm <= ENTRY_E):
            continue

        d = 0
        cc, oo = float(c[i]), float(o[i])
        if mode == "trap":
            if ema[i] != ema[i]:
                continue
            j0 = i
            while j0 > 0 and days[j0 - 1] == day:
                j0 -= 1
            if i - j0 < 5:
                continue
            sh, slv = swing_hl(h, l, i)
            hh, ll = float(h[i]), float(l[i])
            if ll < slv - 8 and cc > slv and cc > oo and cc > ema[i]:
                d = 1
            elif hh > sh + 8 and cc < sh and cc < oo and cc < ema[i]:
                d = -1
        elif mode == "pdhl":
            levels = prev_hl.get(day)
            if not levels:
                continue
            if cc > levels[0] and cc > oo:
                d = 1
            elif cc < levels[1] and cc < oo:
                d = -1
        elif mode == "sor":
            if mm < or_e + 5:
                continue
            orb = session_or(days, mins, h, l, i, ENTRY_S, or_e)
            if not orb:
                continue
            w = orb[0] - orb[1]
            if w < 10 or w > max_or_w:
                continue
            if cc > orb[0] and cc > oo:
                d = 1
            elif cc < orb[1] and cc < oo:
                d = -1
        elif mode == "mom":
            if i < 3:
                continue
            if c[i - 1] > o[i - 1] and c[i - 2] > o[i - 2] and cc > oo and cc > c[i - 1]:
                d = 1
            elif c[i - 1] < o[i - 1] and c[i - 2] < o[i - 2] and cc < oo and cc < c[i - 1]:
                d = -1

        if d and ema_filter and ema[i] == ema[i]:
            if (d == 1 and cc < ema[i]) or (d == -1 and cc > ema[i]):
                d = 0
        if not d:
            continue
        if confirm:
            pending = {"dir": d, "sig": cc}
        else:
            open_t = {"dir": d, "entry": cc, "stop": cc - d * sl, "target": cc + d * tp}

    return trades


def summarize(trades, label):
    if not trades:
        return {"label": label, "n": 0, "days": 0, "net": 0, "avg_day": 0, "green": 0, "pf": 0, "worst_day": 0, "all_green": False, "score": -1e18}
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
    red_n = int((traded < 0).sum()) if len(traded) else 0
    all_green = len(traded) >= 8 and red_n == 0
    score = (1e9 if all_green else 0) + green * 1e6 + float(nets.mean()) * 100 + pf * 10 + len(traded)
    return {
        "label": label,
        "n": len(trades),
        "days": int(len(traded)),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "pf": round(pf, 2),
        "worst_day": round(float(nets.min()), 0),
        "all_green": all_green,
        "score": score,
    }


def main():
    print("loading…", flush=True)
    mk = load()
    rows = []
    # Focused: first-win + confirm + tight TP (path to all-green)
    cfgs = []
    for mode in ("pdhl", "trap", "sor", "mom"):
        for sl, tp in ((10, 30), (15, 30), (15, 45), (20, 40), (20, 60), (25, 50)):
            for day_lock in (20, 30, 40, 50):
                for day_loss in (sl, max(sl, 25), 40):
                    for ema_filter in (True, False):
                        for max_day in (1, 2):
                            base = dict(
                                mode=mode,
                                sl=sl,
                                tp=tp,
                                day_loss=day_loss,
                                day_lock=day_lock,
                                max_day=max_day,
                                first_win=True,
                                confirm=True,
                                ema_filter=ema_filter,
                            )
                            if mode == "sor":
                                cfgs.append((base | {"or_e": 16 * 60, "max_or_w": 120}, f"{mode}_e{int(ema_filter)}_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_m{max_day}_or960"))
                                cfgs.append((base | {"or_e": 17 * 60, "max_or_w": 150}, f"{mode}_e{int(ema_filter)}_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_m{max_day}_or1020"))
                            else:
                                cfgs.append((base, f"{mode}_e{int(ema_filter)}_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_m{max_day}"))

    # Also: no first-win but day lock = TP (bank one winner)
    for mode in ("pdhl", "trap"):
        for sl, tp in ((15, 30), (20, 40), (20, 60)):
            for ema_filter in (True, False):
                base = dict(mode=mode, sl=sl, tp=tp, day_loss=sl, day_lock=tp, max_day=1, first_win=False, confirm=True, ema_filter=ema_filter)
                cfgs.append((base, f"{mode}_bank1_e{int(ema_filter)}_sl{sl}_tp{tp}"))

    print(f"configs={len(cfgs)}", flush=True)
    for i, (kwargs, label) in enumerate(cfgs):
        rows.append(summarize(simulate(mk, **kwargs), label))
        if (i + 1) % 100 == 0:
            print(f"  …{i+1}/{len(cfgs)}", flush=True)

    all_green = sorted(
        [r for r in rows if r["all_green"] and r["avg_day"] > 0],
        key=lambda r: (r["days"], r["avg_day"], r["pf"]),
        reverse=True,
    )
    top = sorted(
        [r for r in rows if r["n"] >= 8 and r["avg_day"] > 0],
        key=lambda r: (r["green"], r["days"], r["avg_day"]),
        reverse=True,
    )[:25]
    champ = all_green[0] if all_green else top[0]

    summary = {
        "window": "15:15–23:00 entry · exit 23:10",
        "configs": len(cfgs),
        "all_green_count": len(all_green),
        "all_green": all_green[:20],
        "top_green": top,
        "wired": champ,
        "honest": "100% green of traded days ≠ every calendar day. Flat days (no setup) are not profits. Live can still lose.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    lines = [
        f"all-green books={len(all_green)} configs={len(cfgs)}",
        f"{'book':<70} {'n':>4} {'d':>3} {'net':>8} {'₹/d':>6} {'g%':>5} {'pf':>5} {'worst':>7}",
    ]
    shown = set()
    for r in all_green[:12] + top:
        if r["label"] in shown:
            continue
        shown.add(r["label"])
        tag = " ★ALLG" if r["all_green"] else ""
        lines.append(
            f"{r['label']:<70} {r['n']:4d} {r['days']:3d} {r['net']:8.0f} {r['avg_day']:6.0f} {r['green']:4.1f}% {r['pf']:5.2f} {r['worst_day']:7.0f}{tag}"
        )
    report = "# Crude all-green · 15:15–23:00\n\n```\n" + "\n".join(lines) + f"\n```\n\nWire: **{champ['label']}**\n"
    (OUT / "README.md").write_text(report)
    print(report, flush=True)


if __name__ == "__main__":
    main()
