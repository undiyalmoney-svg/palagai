#!/usr/bin/env python3
"""
Missed-opportunity audit for last 2 sessions (Nifty / Bank / Crude) at 1 lot.

Shows: arms · confirm fails · entries · exact ₹ · aggressive peers that would
have caught more CE/PE buys (same-bar / no-confirm / OR-break).

  python3 scripts/missed-opportunity-audit-2d.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

DAYS = ["2026-08-03", "2026-08-04"]
CHARGE_IDX = 40.0
CHARGE_CRUDE = 50.0
EXIT_IDX = 15 * 60 + 15
EXIT_CRUDE = 23 * 60 + 10


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


def sim_trap_audit(
    mk,
    *,
    pierce=10,
    rr=2.0,
    peak_arm=150,
    peak_lock=75,
    peak_gb=75,
    soft_frac=0.0,
    soft_max_mfe_r=0.0,
    soft_rs=0.0,
    mode="both",
    confirm=True,
    min_risk=4,
    max_risk=28,
    entry_s=9 * 60 + 45,
    entry_e=14 * 60 + 45,
    day_stop=80,
    only_days=None,
):
    """Trap sim with event log: arm / confirm_fail / enter / exit."""
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, rs = mk["days"], mk["mins"], mk["ema"], mk["rs"]
    n = mk["n"]
    events = []
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
        if only_days and day not in only_days:
            continue
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_fills = 0
            day_stopped = False
            pending = None
            open_t = None

        hhmm = f"{mm // 60:02d}:{mm % 60:02d}"

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
            if peak_r >= 1.0:
                if d == 1:
                    stop = max(stop, entry)
                else:
                    stop = min(stop, entry)
            if peak_arm > 0 and peak_rs >= peak_arm:
                floor_rs = max(peak_lock, peak_rs - peak_gb)
                floor_pts = floor_rs / rs
                if d == 1:
                    stop = max(stop, entry + floor_pts)
                else:
                    stop = min(stop, entry - floor_pts)
            soft_hit = False
            exit_px = None
            if soft_frac > 0 and peak_r < soft_max_mfe_r:
                if mae_pts >= soft_frac * risk or mae_pts * rs >= soft_rs:
                    soft_hit = True
                    exit_px = entry - soft_frac * risk if d == 1 else entry + soft_frac * risk
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
                side = "CE" if d == 1 else "PE"
                trades.append(
                    dict(day=day, time=hhmm, side=side, pts=pts, rs=rs_pnl, reason=reason, entry=entry, exit=exit_px)
                )
                events.append(dict(day=day, time=hhmm, kind="EXIT", side=side, detail=f"{reason} ₹{rs_pnl:.0f}"))
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

        if pending is not None:
            p = pending
            pending = None
            if mm < entry_s or mm > entry_e:
                events.append(dict(day=day, time=hhmm, kind="CONFIRM_SKIP", side="CE" if p["dir"] == 1 else "PE", detail="outside window"))
                continue
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if confirm and not (bull or bear):
                events.append(
                    dict(
                        day=day,
                        time=hhmm,
                        kind="CONFIRM_FAIL",
                        side="CE" if p["dir"] == 1 else "PE",
                        detail=f"armed@{p['arm_t']} sig={p['sig']:.1f}",
                    )
                )
                continue
            if not confirm:
                # same-bar already entered — this branch unused when confirm False
                pass
            fill = float(o[i])
            stop = p["stop"]
            if p["dir"] == 1:
                stop = min(stop, fill - 1)
            else:
                stop = max(stop, fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                events.append(
                    dict(
                        day=day,
                        time=hhmm,
                        kind="RISK_REJECT",
                        side="CE" if p["dir"] == 1 else "PE",
                        detail=f"risk={risk:.1f}",
                    )
                )
                continue
            target = fill + risk * rr if p["dir"] == 1 else fill - risk * rr
            open_t = dict(dir=p["dir"], entry=fill, stop=stop, target=target, risk=risk, peak_r=0.0, peak_rs=0.0)
            side = "CE" if p["dir"] == 1 else "PE"
            events.append(dict(day=day, time=hhmm, kind="ENTER", side=side, detail=f"confirm fill={fill:.1f}"))
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
        bounce_buy = (
            ll <= sl + pierce
            and ll >= sl - pierce * 2
            and cc > oo
            and cc >= sl
            and (hh - cc) / rng < 0.35
        )
        bounce_sell = (
            hh >= sh - pierce
            and hh <= sh + pierce * 2
            and cc < oo
            and cc <= sh
            and (cc - ll) / rng < 0.35
        )
        direction = 0
        stop = 0.0
        kind = ""
        if trap_buy or (mode == "both" and bounce_buy):
            if cc > float(ema[i]):
                direction = 1
                stop = ll - 2
                kind = "trap_buy" if trap_buy else "bounce_buy"
            else:
                if trap_buy or bounce_buy:
                    events.append(dict(day=day, time=hhmm, kind="EMA_REJECT", side="CE", detail="buy setup below EMA"))
        elif trap_sell or (mode == "both" and bounce_sell):
            if cc < float(ema[i]):
                direction = -1
                stop = hh + 2
                kind = "trap_sell" if trap_sell else "bounce_sell"
            else:
                if trap_sell or bounce_sell:
                    events.append(dict(day=day, time=hhmm, kind="EMA_REJECT", side="PE", detail="sell setup above EMA"))
        if not direction:
            continue
        risk = abs(cc - stop)
        if risk < min_risk or risk > max_risk:
            events.append(
                dict(
                    day=day,
                    time=hhmm,
                    kind="RISK_REJECT",
                    side="CE" if direction == 1 else "PE",
                    detail=f"arm risk={risk:.1f} ({kind})",
                )
            )
            continue

        side = "CE" if direction == 1 else "PE"
        if not confirm:
            # same-bar enter at close (aggressive — what "see CE/PE and buy" often means)
            fill = cc
            if direction == 1:
                stop = min(stop, fill - 1)
            else:
                stop = max(stop, fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                continue
            target = fill + risk * rr if direction == 1 else fill - risk * rr
            open_t = dict(dir=direction, entry=fill, stop=stop, target=target, risk=risk, peak_r=0.0, peak_rs=0.0)
            events.append(dict(day=day, time=hhmm, kind="ENTER", side=side, detail=f"NO_CONFIRM {kind} fill={fill:.1f}"))
        else:
            pending = dict(dir=direction, stop=stop, sig=cc, arm_t=hhmm)
            events.append(dict(day=day, time=hhmm, kind="ARM", side=side, detail=kind))

    return trades, events


def sim_orb_break(
    mk,
    *,
    orb_end=9 * 60 + 30,
    entry_s=9 * 60 + 35,
    entry_e=14 * 60 + 45,
    sl_pts=25,
    tp_pts=50,
    max_day=3,
    rs=None,
    charge=CHARGE_IDX,
    exit_mm=EXIT_IDX,
    only_days=None,
    confirm=True,
):
    """Simple opening-range break CE/PE — common discretionary style."""
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    rs = rs if rs is not None else mk["rs"]
    n = mk["n"]
    trades = []
    events = []
    or_cache = {}
    pending = None
    open_t = None
    day_fills = 0
    cur_day = None

    for i in range(1, n):
        day = str(days[i])
        mm = int(mins[i])
        if only_days and day not in only_days:
            continue
        if day != cur_day:
            cur_day = day
            day_fills = 0
            pending = None
            open_t = None
            # build OR
            hi, lo = -1e18, 1e18
            j = i
            while j >= 0 and str(days[j]) == day:
                m2 = int(mins[j])
                if 9 * 60 <= m2 <= orb_end:
                    hi = max(hi, float(h[j]))
                    lo = min(lo, float(l[j]))
                j -= 1
            or_cache[day] = None if hi < -1e17 else (hi, lo)

        hhmm = f"{mm // 60:02d}:{mm % 60:02d}"
        oh = or_cache.get(day)
        if oh is None:
            continue
        or_hi, or_lo = oh

        if open_t is not None:
            d = open_t["dir"]
            entry, stop, target = open_t["entry"], open_t["stop"], open_t["target"]
            if d == 1:
                hit_sl = float(l[i]) <= stop
                hit_tp = float(h[i]) >= target
            else:
                hit_sl = float(h[i]) >= stop
                hit_tp = float(l[i]) <= target
            if hit_sl or hit_tp or mm >= exit_mm:
                if hit_sl:
                    exit_px, reason = stop, "SL"
                elif hit_tp:
                    exit_px, reason = target, "TP"
                else:
                    exit_px, reason = float(c[i]), "EOD"
                pts = (exit_px - entry) if d == 1 else (entry - exit_px)
                side = "CE" if d == 1 else "PE"
                trades.append(dict(day=day, time=hhmm, side=side, pts=pts, rs=pts * rs - charge, reason=reason))
                events.append(dict(day=day, time=hhmm, kind="EXIT", side=side, detail=f"{reason} ₹{pts*rs-charge:.0f}"))
                open_t = None
            continue

        if max_day > 0 and day_fills >= max_day:
            continue

        if pending is not None:
            p = pending
            pending = None
            if mm < entry_s or mm > entry_e:
                continue
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if confirm and not (bull or bear):
                events.append(dict(day=day, time=hhmm, kind="CONFIRM_FAIL", side="CE" if p["dir"] == 1 else "PE", detail="OR break"))
                continue
            fill = float(o[i])
            stop = fill - sl_pts if p["dir"] == 1 else fill + sl_pts
            target = fill + tp_pts if p["dir"] == 1 else fill - tp_pts
            open_t = dict(dir=p["dir"], entry=fill, stop=stop, target=target)
            day_fills += 1
            side = "CE" if p["dir"] == 1 else "PE"
            events.append(dict(day=day, time=hhmm, kind="ENTER", side=side, detail="OR break confirm"))
            continue

        if mm < entry_s or mm > entry_e:
            continue
        if np.isnan(ema[i]):
            continue
        cc = float(c[i])
        if cc > or_hi and cc > float(ema[i]):
            if confirm:
                pending = dict(dir=1, sig=cc)
                events.append(dict(day=day, time=hhmm, kind="ARM", side="CE", detail=f"OR break hi={or_hi:.1f}"))
            else:
                fill = cc
                open_t = dict(dir=1, entry=fill, stop=fill - sl_pts, target=fill + tp_pts)
                day_fills += 1
                events.append(dict(day=day, time=hhmm, kind="ENTER", side="CE", detail="OR break same-bar"))
        elif cc < or_lo and cc < float(ema[i]):
            if confirm:
                pending = dict(dir=-1, sig=cc)
                events.append(dict(day=day, time=hhmm, kind="ARM", side="PE", detail=f"OR break lo={or_lo:.1f}"))
            else:
                fill = cc
                open_t = dict(dir=-1, entry=fill, stop=fill + sl_pts, target=fill - tp_pts)
                day_fills += 1
                events.append(dict(day=day, time=hhmm, kind="ENTER", side="PE", detail="OR break same-bar"))

    return trades, events


def day_sum(trades, day):
    return sum(t["rs"] for t in trades if t["day"] == day)


def count_events(events, day, kind):
    return sum(1 for e in events if e["day"] == day and e["kind"] == kind)


def main():
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude = uh.load(uh.CACHE / "crudeoilm-5m-merged.json", 10)

    # coverage
    cov = {}
    for name, mk in [("nifty", nifty), ("bank", bank), ("crude", crude)]:
        for d in DAYS:
            idx = [i for i, x in enumerate(mk["days"]) if str(x) == d]
            if idx:
                last = int(mk["mins"][idx[-1]])
                cov[f"{name}:{d}"] = f"{len(idx)} bars → {last//60:02d}:{last%60:02d}"
            else:
                cov[f"{name}:{d}"] = "NO DATA"

    variants = []

    # Wired Trap
    for label, kw in [
        ("WIRED_trap_confirm", dict(confirm=True, pierce=10, peak_arm=150, peak_lock=75, peak_gb=75, soft_frac=0, rr=2.0)),
        ("trap_NO_CONFIRM", dict(confirm=False, pierce=10, peak_arm=150, peak_lock=75, peak_gb=75, soft_frac=0, rr=2.0)),
        ("trap_confirm_p5", dict(confirm=True, pierce=5, peak_arm=150, peak_lock=75, peak_gb=75, soft_frac=0, rr=2.0)),
        ("trap_confirm_p3_arm400_soft", dict(confirm=True, pierce=3, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, rr=3.5)),
    ]:
        tn, en = sim_trap_audit(nifty, only_days=set(DAYS), min_risk=4, max_risk=28, **kw)
        tb, eb = sim_trap_audit(bank, only_days=set(DAYS), min_risk=8, max_risk=50, **kw)
        variants.append((label, "index", tn + tb, en + eb))

    # OR-break index (friend-style)
    for label, kw in [
        ("OR_break_confirm_sl25_tp50", dict(confirm=True, sl_pts=25, tp_pts=50, max_day=3)),
        ("OR_break_samebar_sl25_tp50", dict(confirm=False, sl_pts=25, tp_pts=50, max_day=3)),
        ("OR_break_confirm_sl20_tp40", dict(confirm=True, sl_pts=20, tp_pts=40, max_day=4)),
        ("OR_break_samebar_sl15_tp45", dict(confirm=False, sl_pts=15, tp_pts=45, max_day=4)),
    ]:
        tn, en = sim_orb_break(nifty, only_days=set(DAYS), **kw)
        tb, eb = sim_orb_break(bank, only_days=set(DAYS), sl_pts=kw["sl_pts"] * 1.5, tp_pts=kw["tp_pts"] * 1.5, max_day=kw["max_day"], confirm=kw["confirm"])
        variants.append((label, "index", tn + tb, en + eb))

    # Crude Selective peers
    crude_cfgs = [
        ("crude_sel_sl30_tp60_m2_confirm", dict(sl=30, tp=60, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=80, first_win=False, confirm=True)),
        ("crude_sel_sl30_tp60_m4_confirm", dict(sl=30, tp=60, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=4, day_loss=120, first_win=False, confirm=True)),
        ("crude_sel_sl20_tp40_m4_noconfirm", dict(sl=20, tp=40, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=4, day_loss=120, first_win=False, confirm=False)),
        ("crude_allgreen_m6", dict(sl=15, tp=30, max_or=999, entry_s=10 * 60, entry_e=23 * 60, max_day=6, day_loss=150, first_win=False, confirm=True)),
        ("crude_OR_samebar_sl20_tp40_m4", None),  # custom via orb
    ]
    for label, kw in crude_cfgs:
        if kw is None:
            tr, ev = sim_orb_break(
                crude,
                only_days=set(DAYS),
                orb_end=9 * 60 + 30,
                entry_s=10 * 60,
                entry_e=22 * 60,
                sl_pts=20,
                tp_pts=40,
                max_day=4,
                rs=10,
                charge=CHARGE_CRUDE,
                exit_mm=EXIT_CRUDE,
                confirm=False,
            )
        else:
            tr = [t for t in uh.sim_crude(crude, **kw) if t["day"] in DAYS]
            # tag sides unknown in crude sim — leave
            for t in tr:
                t.setdefault("side", "?")
                t.setdefault("time", "?")
            ev = []
        variants.append((label, "crude", tr, ev))

    # Print audit for WIRED
    print("=== DATA COVERAGE (cache) ===")
    for k, v in cov.items():
        print(f"  {k}: {v}")
    print("\nNOTE: Aug 4 cache ends ~14:20 — afternoon index + evening crude not fully in file.")

    wired_n, wired_en = sim_trap_audit(
        nifty,
        only_days=set(DAYS),
        confirm=True,
        pierce=10,
        peak_arm=150,
        peak_lock=75,
        peak_gb=75,
        soft_frac=0,
        rr=2.0,
        min_risk=4,
        max_risk=28,
    )
    wired_b, wired_eb = sim_trap_audit(
        bank,
        only_days=set(DAYS),
        confirm=True,
        pierce=10,
        peak_arm=150,
        peak_lock=75,
        peak_gb=75,
        soft_frac=0,
        rr=2.0,
        min_risk=8,
        max_risk=50,
    )
    crude_wired = [
        t
        for t in uh.sim_crude(
            crude,
            sl=30,
            tp=60,
            max_or=999,
            entry_s=10 * 60,
            entry_e=22 * 60,
            max_day=2,
            day_loss=80,
            first_win=False,
            confirm=True,
        )
        if t["day"] in DAYS
    ]

    print("\n=== WHY MISSED: WIRED Trap event counts ===")
    for d in DAYS:
        for book, ev, tr in [("Nifty", wired_en, wired_n), ("Bank", wired_eb, wired_b)]:
            arms = count_events(ev, d, "ARM")
            fails = count_events(ev, d, "CONFIRM_FAIL")
            enters = count_events(ev, d, "ENTER")
            ema_r = count_events(ev, d, "EMA_REJECT")
            risk_r = count_events(ev, d, "RISK_REJECT")
            pnl = day_sum(tr, d)
            print(
                f"  {d} {book:5}: ARM={arms:2} CONFIRM_FAIL={fails:2} ENTER={enters:2} "
                f"EMA_REJECT={ema_r:2} RISK_REJECT={risk_r:2} | fills={sum(1 for t in tr if t['day']==d)} ₹={pnl:.0f}"
            )
        cp = day_sum(crude_wired, d)
        print(f"  {d} Crude: fills={sum(1 for t in crude_wired if t['day']==d)} ₹={cp:.0f} (Selective max2)")

    print("\n=== WIRED missed list (CONFIRM_FAIL + EMA_REJECT) ===")
    for d in DAYS:
        print(f"--- {d} ---")
        for book, ev in [("Nifty", wired_en), ("Bank", wired_eb)]:
            for e in ev:
                if e["day"] == d and e["kind"] in ("CONFIRM_FAIL", "EMA_REJECT", "ARM", "ENTER", "RISK_REJECT"):
                    print(f"  {book:5} {e['time']} {e['kind']:14} {e['side']} {e['detail']}")

    print("\n=== 1-LOT DAY TOTALS (index ₹ proxy after charges) ===")
    print(f"{'variant':40} {'book':6} {'Aug3':>8} {'Aug4':>8} {'2d':>8} {'fills3':>6} {'fills4':>6}")

    rows = []
    # Combine best index + crude for desk totals
    index_vars = [(a, b, c, d) for a, b, c, d in variants if b == "index"]
    crude_vars = {a: c for a, b, c, _ in variants if b == "crude"}

    for label, book, tr, ev in variants:
        a3, a4 = day_sum(tr, DAYS[0]), day_sum(tr, DAYS[1])
        f3 = sum(1 for t in tr if t["day"] == DAYS[0])
        f4 = sum(1 for t in tr if t["day"] == DAYS[1])
        print(f"{label:40} {book:6} {a3:8.0f} {a4:8.0f} {a3+a4:8.0f} {f3:6} {f4:6}")
        rows.append(dict(label=label, book=book, aug3=round(a3, 1), aug4=round(a4, 1), sum2=round(a3 + a4, 1), f3=f3, f4=f4))

    print("\n=== DESK 1/1/1 COMBOS (index DNA + crude DNA) ===")
    desk_rows = []
    for ilabel, _, itr, _ in index_vars:
        for clabel, ctr in crude_vars.items():
            for d in DAYS:
                pass
            a3 = day_sum(itr, DAYS[0]) + day_sum(ctr, DAYS[0])
            a4 = day_sum(itr, DAYS[1]) + day_sum(ctr, DAYS[1])
            desk_rows.append(dict(index=ilabel, crude=clabel, aug3=round(a3, 1), aug4=round(a4, 1), sum2=round(a3 + a4, 1)))
    desk_rows.sort(key=lambda r: (min(r["aug3"], r["aug4"]) < 0, -(r["aug3"] + r["aug4"])))
    print(f"{'index':40} {'crude':36} {'Aug3':>8} {'Aug4':>8} {'2d':>8}")
    for r in desk_rows[:20]:
        print(f"{r['index'][:40]:40} {r['crude'][:36]:36} {r['aug3']:8.1f} {r['aug4']:8.1f} {r['sum2']:8.1f}")

    # Friend target match: Aug3~3000 Aug4~4000
    print("\n=== CLOSEST TO FRIEND (Aug3≈3k, Aug4≈4k), prefer both green ===")
    scored = []
    for r in desk_rows:
        err = abs(r["aug3"] - 3000) + abs(r["aug4"] - 4000)
        both_green = r["aug3"] > 0 and r["aug4"] > 0
        scored.append((both_green, -err, r))
    scored.sort(reverse=True)
    for both, negerr, r in scored[:12]:
        print(
            f"  err={-negerr:6.0f} Aug3={r['aug3']:8.1f} Aug4={r['aug4']:8.1f} | {r['index'][:32]} + {r['crude'][:28]}"
        )

    # Exact wired desk
    w3 = day_sum(wired_n, DAYS[0]) + day_sum(wired_b, DAYS[0]) + day_sum(crude_wired, DAYS[0])
    w4 = day_sum(wired_n, DAYS[1]) + day_sum(wired_b, DAYS[1]) + day_sum(crude_wired, DAYS[1])
    print(f"\n=== WIRED DESK 1/1/1 EXACT (cache) ===")
    print(f"  Aug 3: ₹{w3:.1f}")
    print(f"  Aug 4: ₹{w4:.1f}  (PARTIAL cache to ~14:20)")
    print(f"  2-day: ₹{w3+w4:.1f}")

    out = {
        "coverage": cov,
        "wired_desk": {"aug3": round(w3, 1), "aug4": round(w4, 1), "note": "Aug4 cache partial to 14:20"},
        "variants": rows,
        "desk_top": desk_rows[:30],
        "friend_closest": [
            dict(aug3=r["aug3"], aug4=r["aug4"], index=r["index"], crude=r["crude"])
            for _, __, r in scored[:10]
        ],
    }
    (OUT / "missed-opportunity-2d.json").write_text(json.dumps(out, indent=2))
    print(f"\nWrote {OUT / 'missed-opportunity-2d.json'}")


if __name__ == "__main__":
    main()
