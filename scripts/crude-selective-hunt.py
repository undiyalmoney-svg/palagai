#!/usr/bin/env python3
"""
Crude selective DNA hunt — few high-quality trades (charge-aware).

MCX option charges (~₹50/roundtrip; ~₹1000 on a 20-trade All-Green day) dominate.
Goal: max 1 trade/day · first-win · confirm · wait for a real opportunity.

  python3 scripts/crude-selective-hunt.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("CACHE", ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"))
OUT = ROOT / "reports" / "crude-selective"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE_RS = float(os.environ.get("CHARGE_RS", "50"))
EXIT_M = 23 * 60 + 10


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path) -> dict:
    rows = json.loads(path.read_text())
    for r in rows:
        d = str(r["date"]).replace("T", " ").replace("+0530", "").split("+")[0].strip()
        r["date"] = d
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"])[11:16]) for r in rows])
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
    j = i - 1
    prev = None
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


def simulate(mk, *, mode, sl, tp, day_loss, max_day, entry_s, entry_e, pierce, max_or_width,
             trail_arm_rs=0.0, trail_lock_rs=0.0, trail_gb_rs=0.0, first_win=True, confirm=True):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n = mk["n"]
    trades = []
    day_net = 0.0
    day_fills = 0
    won_today = False
    cur_day = None
    pending = None
    open_t = None

    for i in range(50, n):
        day = str(days[i])
        mm = int(mins[i])
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_fills = 0
            won_today = False
            pending = None
            open_t = None

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            peak = open_t["peak"]
            if direction == "BUY":
                mfe = max(0.0, float(h[i]) - entry)
                peak = max(peak, mfe)
                if trail_arm_rs > 0 and peak * RS >= trail_arm_rs:
                    floor = max(trail_lock_rs, peak * RS - trail_gb_rs) / RS
                    stop = max(stop, entry + floor)
                hit_sl = float(l[i]) <= stop
                hit_tp = float(h[i]) >= target
                if hit_sl or hit_tp or mm >= EXIT_M:
                    if hit_sl:
                        exit_px, reason = stop, "SL"
                    elif hit_tp:
                        exit_px, reason = target, "TP"
                    else:
                        exit_px, reason = float(c[i]), "EOD"
                    pts = exit_px - entry
                    trades.append(dict(day=day, pts=pts, rs=pts * RS, reason=reason))
                    day_net += pts
                    day_fills += 1
                    won_today = won_today or pts > 0
                    open_t = None
                else:
                    open_t["stop"] = stop
                    open_t["peak"] = peak
            else:
                mfe = max(0.0, entry - float(l[i]))
                peak = max(peak, mfe)
                if trail_arm_rs > 0 and peak * RS >= trail_arm_rs:
                    floor = max(trail_lock_rs, peak * RS - trail_gb_rs) / RS
                    stop = min(stop, entry - floor)
                hit_sl = float(h[i]) >= stop
                hit_tp = float(l[i]) <= target
                if hit_sl or hit_tp or mm >= EXIT_M:
                    if hit_sl:
                        exit_px, reason = stop, "SL"
                    elif hit_tp:
                        exit_px, reason = target, "TP"
                    else:
                        exit_px, reason = float(c[i]), "EOD"
                    pts = entry - exit_px
                    trades.append(dict(day=day, pts=pts, rs=pts * RS, reason=reason))
                    day_net += pts
                    day_fills += 1
                    won_today = won_today or pts > 0
                    open_t = None
                else:
                    open_t["stop"] = stop
                    open_t["peak"] = peak
            continue

        if mm < entry_s or mm > entry_e:
            pending = None
            continue
        if max_day > 0 and day_fills >= max_day:
            continue
        if first_win and won_today:
            continue
        if day_loss > 0 and day_net <= -day_loss:
            continue

        if pending is not None:
            want = pending["dir"]
            ok = (want == "BUY" and float(c[i]) > pending["level"]) or (
                want == "SELL" and float(c[i]) < pending["level"]
            )
            if confirm and ok:
                entry = float(o[i])
                if want == "BUY":
                    open_t = dict(dir="BUY", entry=entry, stop=entry - sl, target=entry + tp, peak=0.0)
                else:
                    open_t = dict(dir="SELL", entry=entry, stop=entry + sl, target=entry - tp, peak=0.0)
            pending = None
            continue

        buy_ok = np.isnan(ema[i]) or float(c[i]) >= float(ema[i])
        sell_ok = np.isnan(ema[i]) or float(c[i]) <= float(ema[i])
        signal = level = None

        if mode == "session_or":
            if mm <= 9 * 60 + 30:
                continue
            band = orb_hl(days, mins, h, l, i)
            if band is None:
                continue
            hi, lo = band
            if max_or_width > 0 and (hi - lo) > max_or_width:
                continue
            if float(c[i]) > hi + pierce and buy_ok:
                signal, level = "BUY", hi
            elif float(c[i]) < lo - pierce and sell_ok:
                signal, level = "SELL", lo
        elif mode == "trap":
            sh, slv = swing_hl(h, l, i)
            if float(c[i]) > sh + pierce and buy_ok:
                signal, level = "BUY", sh
            elif float(c[i]) < slv - pierce and sell_ok:
                signal, level = "SELL", slv
        elif mode == "pdhl":
            pd = prev_day_hl(days, h, l, i)
            if pd is None:
                continue
            pdh, pdl = pd
            if float(c[i]) > pdh + pierce and buy_ok:
                signal, level = "BUY", pdh
            elif float(c[i]) < pdl - pierce and sell_ok:
                signal, level = "SELL", pdl

        if signal is None:
            continue
        if confirm:
            pending = dict(dir=signal, level=level)
        else:
            entry = float(c[i])
            if signal == "BUY":
                open_t = dict(dir="BUY", entry=entry, stop=entry - sl, target=entry + tp, peak=0.0)
            else:
                open_t = dict(dir="SELL", entry=entry, stop=entry + sl, target=entry - tp, peak=0.0)

    if not trades:
        return None
    by_day: dict[str, float] = defaultdict(float)
    for t in trades:
        by_day[t["day"]] += t["rs"]
    day_rs = list(by_day.values())
    green = sum(1 for x in day_rs if x > 0)
    trade_days = len(day_rs)
    wins = sum(1 for t in trades if t["rs"] > 0)
    gross = sum(t["rs"] for t in trades)
    charges = len(trades) * CHARGE_RS
    net_after = gross - charges
    gp = sum(t["rs"] for t in trades if t["rs"] > 0)
    gl = -sum(t["rs"] for t in trades if t["rs"] <= 0)
    pf = (gp / gl) if gl > 1e-9 else 99.0
    return dict(
        trades=len(trades),
        trade_days=trade_days,
        green_pct=100.0 * green / trade_days,
        win_pct=100.0 * wins / len(trades),
        gross_rs=gross,
        charges_rs=charges,
        net_after_rs=net_after,
        rs_per_trade_day=gross / trade_days,
        net_per_trade_day=net_after / trade_days,
        tpd=len(trades) / trade_days,
        pf=pf,
        worst_day=min(day_rs),
        best_day=max(day_rs),
    )


def filter_mk(mk, day_set: set[str]):
    all_days = sorted(set(str(d) for d in mk["days"]))
    first = min(day_set)
    warm = [d for d in all_days if d < first][-5:]
    keep = set(warm) | day_set
    idx = np.array([str(d) in keep for d in mk["days"]], dtype=bool)
    out = {k: (v[idx] if isinstance(v, np.ndarray) else v) for k, v in mk.items()}
    out["n"] = int(idx.sum())
    return out


def score(row: dict) -> float:
    if not row or row["trade_days"] < 10:
        return -1e18
    return (
        row["net_per_trade_day"] * 2.5
        + row["green_pct"] * 4.0
        + min(row["pf"], 4.0) * 25.0
        - abs(row["tpd"] - 1.0) * 50.0
        + min(row["trade_days"], 35) * 0.8
    )


def fmt(x: dict) -> str:
    return (
        f"green={x['green_pct']:.1f}% win={x['win_pct']:.1f}% tpd={x['tpd']:.2f} "
        f"gross₹/d={x['rs_per_trade_day']:.0f} after₹/d={x['net_per_trade_day']:.0f} "
        f"PF={x['pf']:.2f} days={x['trade_days']} worst={x['worst_day']:.0f} "
        f"net={x['net_after_rs']:.0f} (chg₹{x['charges_rs']:.0f})"
    )


def main() -> None:
    mk = load(CACHE)
    days = sorted(set(str(d) for d in mk["days"]))
    print(
        f"cache bars={mk['n']} days={len(days)} {days[0]} → {days[-1]} charge=₹{CHARGE_RS}/trade",
        flush=True,
    )
    cut = max(1, int(len(days) * 0.7))
    is_days, oos_days = set(days[:cut]), set(days[cut:])
    mk_is, mk_oos = filter_mk(mk, is_days), filter_mk(mk, oos_days)
    print(f"IS={len(is_days)} OOS={len(oos_days)}", flush=True)

    configs = []
    for mode in ("session_or", "trap", "pdhl"):
        for sl in (20, 25, 30, 40, 50):
            for tp in (60, 80, 100, 120, 150):
                if tp < sl * 2:
                    continue
                for pierce in (0.0, 1.0, 2.0):
                    for entry_s, entry_e, wname in (
                        (9 * 60 + 35, 23 * 60, "full"),
                        (14 * 60, 22 * 60, "pm"),
                        (18 * 60 + 30, 22 * 60, "eve"),
                    ):
                        widths = (40, 60, 80) if mode == "session_or" else (0,)
                        for max_or in widths:
                            for day_loss in (sl, 0):
                                configs.append(
                                    dict(
                                        mode=mode,
                                        sl=sl,
                                        tp=tp,
                                        day_loss=day_loss,
                                        max_day=1,
                                        entry_s=entry_s,
                                        entry_e=entry_e,
                                        pierce=pierce,
                                        max_or_width=max_or,
                                        wname=wname,
                                    )
                                )

    print(f"testing {len(configs)} configs…", flush=True)
    rows = []
    for i, raw in enumerate(configs, 1):
        if i % 100 == 0:
            print(f"  …{i}/{len(configs)} kept={len(rows)}", flush=True)
        cfg = dict(raw)
        wname = cfg.pop("wname")
        is_res = simulate(mk_is, **cfg)
        if not is_res or is_res["trade_days"] < 10:
            continue
        oos_res = simulate(mk_oos, **cfg)
        if not oos_res or oos_res["trade_days"] < 5:
            continue
        if oos_res["net_after_rs"] < 0 or oos_res["green_pct"] < 55 or oos_res["tpd"] > 1.15:
            continue
        name = (
            f"{cfg['mode']}_sl{cfg['sl']}_tp{cfg['tp']}_p{cfg['pierce']}_or{cfg['max_or_width']}"
            f"_L{cfg['day_loss']}_m1_fw1_{wname}"
        )
        cfg["wname"] = wname
        rows.append(
            {
                "name": name,
                "cfg": cfg,
                "is": is_res,
                "oos": oos_res,
                "score": score(oos_res) * 0.7 + score(is_res) * 0.3,
            }
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    print(f"kept {len(rows)}", flush=True)
    print("\n=== TOP 20 (OOS-first, after charges) ===", flush=True)
    for i, r in enumerate(rows[:20], 1):
        print(f"{i:2d}. {r['name']}", flush=True)
        print(f"    IS  {fmt(r['is'])}", flush=True)
        print(f"    OOS {fmt(r['oos'])}", flush=True)

    baselines = [
        (
            "all_green_unlimited",
            dict(
                mode="session_or",
                sl=15,
                tp=100,
                day_loss=0,
                max_day=99,
                entry_s=9 * 60 + 35,
                entry_e=23 * 60,
                pierce=0.0,
                max_or_width=0,
                first_win=False,
                trail_arm_rs=500,
                trail_lock_rs=240,
                trail_gb_rs=260,
            ),
        ),
        (
            "daily_profit_eve_m2",
            dict(
                mode="pdhl",
                sl=20,
                tp=40,
                day_loss=40,
                max_day=2,
                entry_s=18 * 60 + 30,
                entry_e=21 * 60,
                pierce=0.0,
                max_or_width=0,
                first_win=False,
            ),
        ),
    ]
    print("\n=== BASELINES full sample ===", flush=True)
    base_out = []
    for name, cfg in baselines:
        x = simulate(mk, **cfg)
        base_out.append({"name": name, "cfg": cfg, "full": x})
        if x:
            print(f"{name}: {fmt(x)} trades={x['trades']}", flush=True)

    aug = filter_mk(mk, {"2026-08-03"})
    print("\n=== 2026-08-03 (charge-pain day) ===", flush=True)
    for r in rows[:5]:
        x = simulate(aug, **{k: v for k, v in r["cfg"].items() if k != "wname"})
        print(
            f"TOP {r['name']}: trades={x and x['trades']} gross={x and x['gross_rs']} "
            f"chg={x and x['charges_rs']} after={x and x['net_after_rs']}",
            flush=True,
        )
    for name, cfg in baselines:
        x = simulate(aug, **cfg)
        print(
            f"BASE {name}: trades={x and x['trades']} gross={x and x['gross_rs']} "
            f"chg={x and x['charges_rs']} after={x and x['net_after_rs']}",
            flush=True,
        )

    summary = {
        "charge_rs": CHARGE_RS,
        "days": [days[0], days[-1]],
        "n_days": len(days),
        "top": rows[:30],
        "baselines": base_out,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=float))
    print(f"\nwrote {OUT / 'summary.json'}", flush=True)
    if rows:
        best = rows[0]
        print("\nWIRE CANDIDATE:", best["name"], flush=True)
        print("cfg", json.dumps(best["cfg"], indent=2), flush=True)


if __name__ == "__main__":
    main()
