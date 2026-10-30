#!/usr/bin/env python3
"""
Raise Crude Mini green-day rate vs Daily Profit (eve PDHL SL20/TP40).

Does not claim every calendar day is green. Flat (no setup) is not a win.
Uses reports/analyst-cache/crudeoilm-5m-merged.json

  python3 scripts/crude-more-green-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
OUT = ROOT / "reports" / "crude-more-green"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE = 50.0
EXIT_M = 23 * 60 + 10
OOS_FROM = "2026-09-01"


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
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c), prev_hl=prev_hl)


def simulate(
    mk: dict,
    *,
    sl: float,
    tp: float,
    day_loss: float,
    day_lock: float,
    max_day: int,
    first_win: bool,
    entry_s: int,
    entry_e: int,
    confirm: bool,
    ema_filter: bool,
    min_body: float,
    max_pd_range: float,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, prev_hl = mk["days"], mk["mins"], mk["ema"], mk["prev_hl"]
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
                trades.append({"day": day, "pts": pts, "rs": pts * RS - CHARGE})
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
            open_t = {
                "dir": p["dir"],
                "entry": fill,
                "stop": fill - p["dir"] * sl,
                "target": fill + p["dir"] * tp,
            }
            continue

        if not (entry_s <= mm <= entry_e):
            continue
        levels = prev_hl.get(day)
        if not levels:
            continue
        pdh, pdl = levels
        if max_pd_range > 0 and (pdh - pdl) > max_pd_range:
            continue
        cc, oo = float(c[i]), float(o[i])
        if min_body > 0 and abs(cc - oo) < min_body:
            continue
        d = 0
        if cc > pdh and cc > oo:
            d = 1
        elif cc < pdl and cc < oo:
            d = -1
        if not d:
            continue
        if ema_filter and ema[i] == ema[i]:
            if (d == 1 and cc < ema[i]) or (d == -1 and cc > ema[i]):
                continue
        if confirm:
            pending = {"dir": d, "sig": cc}
        else:
            open_t = {"dir": d, "entry": cc, "stop": cc - d * sl, "target": cc + d * tp}

    return trades


def summarize(trades: list[dict], label: str, day_from: str | None = None, day_to: str | None = None) -> dict:
    if day_from or day_to:
        trades = [
            t
            for t in trades
            if (not day_from or t["day"] >= day_from) and (not day_to or t["day"] < day_to)
        ]
    if not trades:
        return {
            "label": label,
            "n": 0,
            "days": 0,
            "net": 0,
            "avg_day": 0,
            "green": 0,
            "red": 0,
            "pf": 0,
            "worst_day": 0,
            "score": -1e18,
        }
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
    score = green * 1e6 + float(nets.mean()) * 100 + pf * 10 + len(traded)
    return {
        "label": label,
        "n": len(trades),
        "days": int(len(traded)),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "red": round(red * 100, 1),
        "pf": round(pf, 2),
        "worst_day": round(float(nets.min()), 0),
        "score": score,
    }


def pack(label, kwargs, trades):
    full = summarize(trades, label)
    is_ = summarize(trades, label, day_to=OOS_FROM)
    oos = summarize(trades, label, day_from=OOS_FROM)
    return {"label": label, "kwargs": kwargs, "full": full, "is": is_, "oos": oos}


def main():
    mk = load()
    rows = []

    baseline_kw = dict(
        sl=20,
        tp=40,
        day_loss=40,
        day_lock=50,
        max_day=2,
        first_win=False,
        entry_s=18 * 60 + 30,
        entry_e=21 * 60,
        confirm=True,
        ema_filter=False,
        min_body=0,
        max_pd_range=0,
    )
    baseline = pack("baseline_eve_sl20_tp40", baseline_kw, simulate(mk, **baseline_kw))
    rows.append(baseline)
    # Locked DNA: same evening PDHL, skip yesterday range > 400 pts.
    pd400_kw = dict(baseline_kw, max_pd_range=400)
    pd400 = pack("wired_eve_sl20_tp40_pd400", pd400_kw, simulate(mk, **pd400_kw))
    rows.append(pd400)

    cfgs = []
    for sl, tp in ((15, 45), (20, 40), (20, 60), (25, 50), (15, 30), (10, 30)):
        for first_win in (True, False):
            for max_day in (1, 2):
                for ema_filter in (True, False):
                    for min_body in (0, 8, 15):
                        for max_pd_range in (0, 80, 120, 300, 400):
                            for entry_s, entry_e, wname in (
                                (18 * 60 + 30, 21 * 60, "eve1830"),
                                (19 * 60, 21 * 60, "eve1900"),
                                (15 * 60 + 15, 21 * 60, "aft1515"),
                            ):
                                day_lock = tp
                                day_loss = sl
                                kwargs = dict(
                                    sl=sl,
                                    tp=tp,
                                    day_loss=day_loss,
                                    day_lock=day_lock,
                                    max_day=max_day,
                                    first_win=first_win,
                                    entry_s=entry_s,
                                    entry_e=entry_e,
                                    confirm=True,
                                    ema_filter=ema_filter,
                                    min_body=min_body,
                                    max_pd_range=max_pd_range,
                                )
                                label = (
                                    f"{wname}_sl{sl}_tp{tp}_m{max_day}_fw{int(first_win)}"
                                    f"_ema{int(ema_filter)}_b{int(min_body)}_pd{int(max_pd_range)}"
                                )
                                cfgs.append((label, kwargs))

    print(f"bars={mk['n']} configs={len(cfgs)}", flush=True)
    for i, (label, kwargs) in enumerate(cfgs):
        rows.append(pack(label, kwargs, simulate(mk, **kwargs)))
        if (i + 1) % 200 == 0:
            print(f"  …{i + 1}/{len(cfgs)}", flush=True)

    def ok(r):
        return (
            r["is"]["days"] >= 12
            and r["oos"]["days"] >= 6
            and r["is"]["avg_day"] > 0
            and r["oos"]["avg_day"] > 0
            and r["oos"]["green"] >= r["full"]["green"] - 15
        )

    viable = [r for r in rows if ok(r)]
    viable.sort(
        key=lambda r: (r["oos"]["green"], r["is"]["green"], r["oos"]["avg_day"], r["oos"]["worst_day"]),
        reverse=True,
    )
    if not viable:
        viable = sorted(
            [r for r in rows if r["full"]["days"] >= 10 and r["full"]["avg_day"] > 0],
            key=lambda r: (r["full"]["green"], r["full"]["avg_day"]),
            reverse=True,
        )

    # First-win / tight filters cut green% on this sample. The stable lift is pd400.
    champ = pd400
    summary = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "bars": int(mk["n"]),
        "charge_rs": CHARGE,
        "oos_from": OOS_FROM,
        "baseline": baseline,
        "wired": champ,
        "top": viable[:12],
        "honest": "Higher green% usually means fewer days traded. First-win lock made more red days. Not every calendar day. Live can still lose.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def line(tag, r):
        f, i, o = r["full"], r["is"], r["oos"]
        return (
            f"{tag:<8} {r['label']:<58} "
            f"full {f['green']:5.1f}% d{f['days']:3d} ₹{f['avg_day']:6.0f} w{f['worst_day']:6.0f}  "
            f"IS {i['green']:5.1f}%  OOS {o['green']:5.1f}% d{o['days']:3d} ₹{o['avg_day']:6.0f}"
        )

    lines = [
        f"sample {summary['sample']}  charge ₹{CHARGE:.0f}/RT  OOS from {OOS_FROM}",
        line("BASE", baseline),
        line("WIRE", champ),
        "",
        "top by OOS green (IS+OOS both profitable)",
    ]
    for r in viable[:10]:
        lines.append(line(" ", r))
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Crude more-green hunt\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
