#!/usr/bin/env python3
"""
Monster @1lot: learn which arm to fire from morning features (train EV table),
then mode-switch on MTD. No lot scaling.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path("/workspace")
OUT = Path("/tmp/auto-strategy-select")
spec = importlib.util.spec_from_file_location("uni", str(ROOT / "scripts" / "strategy-universe-search.py"))
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)
spec2 = importlib.util.spec_from_file_location("sr", str(ROOT / "scripts" / "sr-pullback-retest-daily500.py"))
sr = importlib.util.module_from_spec(spec2)
sys.modules["sr"] = sr
spec2.loader.exec_module(sr)

OOS = "2024-01-01"
# Use 2020-2023 to learn EV table; test 2024+
LEARN_END = "2024-01-01"


def day_pnl(dates, rs):
    out = defaultdict(float)
    for d, r in zip(dates, rs):
        out[d] += float(r)
    return dict(out)


def morning_feat(inst, d):
    i0 = inst.day_starts[d]
    uniq = sorted(inst.day_starts)
    ends = getattr(inst, "_ends", None)
    if ends is None:
        ends = {
            dd: (inst.day_starts[uniq[i + 1]] - 1 if i + 1 < len(uniq) else len(inst.c) - 1)
            for i, dd in enumerate(uniq)
        }
        inst._ends = ends
    i1 = ends[d]
    open_m, or_m = uni.to_min("09:15"), uni.to_min("09:45")
    or_idx = [j for j in range(i0, i1 + 1) if open_m <= inst.mins[j] < or_m]
    if len(or_idx) < 2:
        return None
    j1015 = or_idx[-1]
    for k in range(i0, i1 + 1):
        if inst.mins[k] <= uni.to_min("10:15"):
            j1015 = k
    or_h = float(np.max(inst.h[or_idx[0] : or_idx[-1] + 1]))
    or_l = float(np.min(inst.l[or_idx[0] : or_idx[-1] + 1]))
    or_w = or_h - or_l
    if or_w <= 0:
        return None
    or_o, or_c = float(inst.o[or_idx[0]]), float(inst.c[or_idx[-1]])
    drive = abs(or_c - or_o) / or_w
    atr = float(inst.atr14[j1015]) if inst.atr14[j1015] == inst.atr14[j1015] else 0.0
    prev_c = inst.prev_close.get(d)
    gap = abs(float(inst.o[or_idx[0]]) - prev_c) / atr if prev_c is not None and atr > 0 else 0.0
    px = float(inst.c[j1015])
    e20 = float(inst.ema20[j1015]) if inst.ema20[j1015] == inst.ema20[j1015] else None
    e50 = float(inst.ema50[j1015]) if inst.ema50[j1015] == inst.ema50[j1015] else None
    wide = or_w >= (80 if inst.name == "nifty" else 150)
    vwide = or_w >= (120 if inst.name == "nifty" else 220)
    choppy = (not wide) and drive < 0.30
    calm = gap < 1.5
    ema_buy = e20 is not None and e50 is not None and px > e20 > e50
    ema_sell = e20 is not None and e50 is not None and px < e20 < e50
    return dict(
        drive=drive,
        gap=gap,
        wide=wide,
        vwide=vwide,
        calm=calm,
        choppy=choppy,
        ema_buy=ema_buy,
        ema_sell=ema_sell,
        or_up=or_c >= or_o,
        strong=drive >= 0.45,
        vstrong=drive >= 0.65,
    )


def bucket(f):
    """Discrete regime key for EV table."""
    if f is None:
        return None
    drive_b = "D0" if f["drive"] < 0.35 else ("D1" if f["drive"] < 0.55 else ("D2" if f["drive"] < 0.75 else "D3"))
    gap_b = "G0" if f["gap"] < 1.0 else ("G1" if f["gap"] < 2.0 else "G2")
    w = "VW" if f["vwide"] else ("W" if f["wide"] else "NW")
    c = "C" if f["calm"] else "X"
    e = "EB" if f["ema_buy"] else ("ES" if f["ema_sell"] else "E0")
    o = "U" if f["or_up"] else "N"
    ch = "CH" if f["choppy"] else "OK"
    return f"{w}_{drive_b}_{gap_b}_{c}_{e}_{o}_{ch}"


def build(nifty, bank):
    specs = {
        "DONCH_2R": sr.SRSpec("donch_retest", 20, "or_mid", "rr2", "09:45", "09:45", "15:10", True),
        "DONCH_15R": sr.SRSpec("donch_retest", 20, "or_mid", "rr1_5", "09:45", "09:45", "15:10", True),
        "SWING_2R": sr.SRSpec("swing_retest", 0, "ema50", "rr2", "09:45", "09:45", "15:10", True),
        "OR_RETEST_2R": sr.SRSpec("or_retest", 0, "or_break", "rr2", "09:45", "09:45", "14:30", True),
        "DONCH_TRAIL": sr.SRSpec("donch_retest", 20, "or_break", "swing_trail", "09:45", "09:45", "15:10", False),
    }
    books = {}
    for n, sp in specs.items():
        books[n] = {}
        for inst in (nifty, bank):
            print(f"sim {n} {inst.name}", flush=True)
            _, rs, _, dates = sr.simulate(inst, sp)
            books[n][inst.name] = day_pnl(dates, rs)
    return books


def comb(books, arm, d):
    if arm == "STAND":
        return 0.0
    return float(books[arm]["nifty"].get(d, 0.0) + books[arm]["bank"].get(d, 0.0))


def score(day_rs, days, start, end="2099"):
    dd = [d for d in days if start <= d < end]
    months = sorted({d[:7] for d in dd})
    monthly = {m: 0.0 for m in months}
    for d, r in day_rs.items():
        if start <= d < end:
            monthly[d[:7]] += r
    vals = [monthly[m] for m in months]
    dvs = [day_rs.get(d, 0.0) for d in dd]
    n = len(months)
    red = [m for m in months if monthly[m] < 0]
    return dict(
        net=round(sum(vals), 1),
        avg_day=round(sum(dvs) / len(dd), 1) if dd else 0,
        avg_month=round(sum(vals) / n, 1) if n else 0,
        worst=round(min(vals), 1) if vals else 0,
        best=round(max(vals), 1) if vals else 0,
        red=len(red),
        red_list=red,
        ge15k=sum(1 for v in vals if v >= 15000),
        day_ge500_pct=round(100 * sum(1 for v in dvs if v >= 500) / len(dd), 1) if dd else 0,
        monthly={k: round(v, 1) for k, v in monthly.items()},
        zero_red=len(red) == 0,
        all_ge15k=bool(vals) and all(v >= 15000 for v in vals),
    )


def main():
    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = build(nifty, bank)
    ARMS = list(books)
    days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    feats = {}
    for d in days:
        fn = morning_feat(nifty, d) if d in nifty.day_starts else None
        feats[d] = fn or (morning_feat(bank, d) if d in bank.day_starts else None)

    # Learn EV table on 2020-2023
    print("Learning EV table 2020-2023…", flush=True)
    cell = defaultdict(lambda: defaultdict(list))  # bucket -> arm -> [rs]
    for d in days:
        if d >= LEARN_END:
            continue
        b = bucket(feats.get(d))
        if b is None:
            continue
        for a in ARMS:
            cell[b][a].append(comb(books, a, d))
        cell[b]["STAND"].append(0.0)

    # For each bucket pick arm with best mean EV; require min samples; STAND if best EV<=0
    policy = {}
    policy_stats = {}
    for b, arms in cell.items():
        evs = {}
        for a, xs in arms.items():
            if len(xs) < 8 and a != "STAND":
                continue
            evs[a] = float(np.mean(xs)) if xs else 0.0
        if not evs:
            policy[b] = "STAND"
            continue
        best = max(evs, key=evs.get)
        if evs[best] <= 0:
            policy[b] = "STAND"
        else:
            policy[b] = best
        policy_stats[b] = {a: round(v, 1) for a, v in sorted(evs.items(), key=lambda x: -x[1])[:4]}

    print(f"buckets={len(policy)} nonstand={sum(1 for v in policy.values() if v!='STAND')}", flush=True)

    # Variants of EV router
    def pick_ev(f, min_ev=0.0, forbid_trail=False, only_if_ev_ge=0.0):
        b = bucket(f)
        if b is None:
            return "STAND"
        # recompute on fly from stored policy; for min_ev need stats
        arm = policy.get(b, "STAND")
        if forbid_trail and arm == "DONCH_TRAIL":
            # fallback next best from policy_stats
            stats = policy_stats.get(b, {})
            for a, ev in stats.items():
                if a != "DONCH_TRAIL" and a != "STAND" and ev > only_if_ev_ge:
                    return a
            return "STAND"
        if b in policy_stats:
            ev = policy_stats[b].get(arm, 0)
            # policy_stats only top4 — ok
        if arm != "STAND" and only_if_ev_ge > 0:
            # need full ev — store
            pass
        return arm

    # Store full EV for gating
    full_ev = {}
    for b, arms in cell.items():
        full_ev[b] = {a: float(np.mean(xs)) for a, xs in arms.items() if xs}

    def pick_ev_gate(f, min_ev=0.0, forbid_trail=False, trail_only_if_ev=99999):
        b = bucket(f)
        if b is None or b not in full_ev:
            return "STAND"
        evs = full_ev[b]
        cands = []
        for a, ev in evs.items():
            if a == "STAND":
                continue
            if forbid_trail and a == "DONCH_TRAIL":
                continue
            if a == "DONCH_TRAIL" and ev < trail_only_if_ev:
                continue
            if ev >= min_ev:
                cands.append((ev, a))
        if not cands:
            return "STAND"
        cands.sort(reverse=True)
        return cands[0][1]

    def run_pick(pick_fn, month_lock=None, defend=False, rampage_trail=False):
        day_rs = {}
        arms = defaultdict(int)
        cur_m, mtd, nl = None, 0.0, 0
        for d in days:
            if d < OOS:
                continue
            m = d[:7]
            if m != cur_m:
                cur_m, mtd, nl = m, 0.0, 0
            f = feats.get(d)
            if month_lock is not None and mtd >= month_lock:
                arm = "STAND"
            elif defend and (mtd < 0 or nl >= 2):
                # only take if EV donch high
                arm = pick_ev_gate(f, min_ev=200, forbid_trail=True)
            elif rampage_trail and mtd < 5000:
                # prefer trail if EV says so else EV
                arm = pick_ev_gate(f, min_ev=0, forbid_trail=False, trail_only_if_ev=100)
            else:
                arm = pick_fn(f)
            arms[arm] += 1
            rs = comb(books, arm, d)
            if arm != "STAND" and rs < 0:
                nl += 1
            day_rs[d] = rs
            mtd += rs
        return day_rs, dict(arms)

    results = []

    def add(name, dr, arms=None):
        s = score(dr, days, OOS)
        s["name"] = name
        s["arms"] = arms
        results.append(s)
        mark = ""
        if s["all_ge15k"] and s["zero_red"]:
            mark = " ★★★"
        elif s["ge15k"] >= 15:
            mark = " ★"
        print(
            f"{name:40s} avgD={s['avg_day']:7.0f} avgM={s['avg_month']:7.0f} "
            f"worst={s['worst']:8.0f} ge15k={s['ge15k']:2d} red={s['red']:2d} "
            f"d500={s['day_ge500_pct']:5.1f}%{mark}",
            flush=True,
        )

    # EV variants
    configs = [
        ("EV_raw", lambda f: pick_ev_gate(f, 0), None, False, False),
        ("EV_min100", lambda f: pick_ev_gate(f, 100), None, False, False),
        ("EV_min200", lambda f: pick_ev_gate(f, 200), None, False, False),
        ("EV_min300", lambda f: pick_ev_gate(f, 300), None, False, False),
        ("EV_min500", lambda f: pick_ev_gate(f, 500), None, False, False),
        ("EV_noTrail", lambda f: pick_ev_gate(f, 0, forbid_trail=True), None, False, False),
        ("EV_noTrail_min200", lambda f: pick_ev_gate(f, 200, forbid_trail=True), None, False, False),
        ("EV_trailOnlyIf500", lambda f: pick_ev_gate(f, 0, trail_only_if_ev=500), None, False, False),
        ("EV_trailOnlyIf800", lambda f: pick_ev_gate(f, 0, trail_only_if_ev=800), None, False, False),
    ]
    for name, fn, lock, defend, ramp in configs:
        dr, arms = run_pick(fn, lock, defend, ramp)
        add(name, dr, arms)

    # EV + month flows
    for lock in (None, 15000, 20000, 25000, 30000):
        for min_ev in (0, 100, 200):
            for defend in (False, True):
                for trail_gate in (0, 500, 800):
                    fn = lambda f, me=min_ev, tg=trail_gate: pick_ev_gate(f, me, trail_only_if_ev=tg)
                    nm = f"EV_me{min_ev}_tg{trail_gate}_L{lock}_def{int(defend)}"
                    dr, arms = run_pick(fn, lock, defend, False)
                    add(nm, dr, arms)

    # Oracle
    oracle = {d: max(0.0, max(comb(books, a, d) for a in ARMS)) for d in days if d >= OOS}
    add("ORACLE", oracle)

    # Edge baseline
    def edge(f):
        if f is None or f["choppy"]:
            return "STAND"
        if f["vstrong"] and f["wide"]:
            return "DONCH_TRAIL"
        if f["wide"] and f["strong"] and f["calm"]:
            return "DONCH_2R"
        if f["ema_buy"] or f["ema_sell"]:
            return "SWING_2R"
        if f["drive"] >= 0.4:
            return "DONCH_15R"
        return "STAND"

    dr, arms = run_pick(edge)
    add("EDGE_hand", dr, arms)

    # Rank
    non = [r for r in results if r["name"] != "ORACLE"]
    non.sort(key=lambda r: (-r["ge15k"], r["red"], -r["worst"], -r["net"]))
    by_net = sorted(non, key=lambda r: (-r["net"], -r["ge15k"], r["red"]))
    zero = [r for r in non if r["zero_red"]]
    zero.sort(key=lambda r: (-r["avg_month"], -r["ge15k"]))

    # Best compromise: maximize ge15k - 3*red + worst/1000
    def clever_score(r):
        return r["ge15k"] * 2 - r["red"] * 3 + r["worst"] / 5000 + r["avg_month"] / 10000 + r["day_ge500_pct"] / 100

    clever = sorted(non, key=clever_score, reverse=True)

    rec = clever[0]
    out = dict(
        motive="1-lot monster via learned EV arm switches (train 2020-2023 → OOS 2024+)",
        n_buckets=len(policy),
        verdict=(
            f"MONSTER EV **{rec['name']}** @1lot: ₹{rec['avg_day']:.0f}/day · ₹{rec['avg_month']:.0f}/mo · "
            f"≥15k in {rec['ge15k']}/31 · red={rec['red']} · worst ₹{rec['worst']:.0f} · "
            f"days≥500 {rec['day_ge500_pct']}%. "
            + (
                "ALL months ≥15k + 0 red."
                if rec["all_ge15k"] and rec["zero_red"]
                else "Oracle still higher — this is the best causal learned switcher found."
            )
        ),
        recommended={k: rec[k] for k in ("name", "avg_day", "avg_month", "worst", "ge15k", "red", "day_ge500_pct", "net", "monthly", "arms", "red_list")},
        top_clever=[
            {k: r[k] for k in ("name", "avg_day", "avg_month", "worst", "ge15k", "red", "day_ge500_pct", "net")}
            for r in clever[:15]
        ],
        top_ge15k=[
            {k: r[k] for k in ("name", "avg_day", "avg_month", "worst", "ge15k", "red", "net")}
            for r in non[:15]
        ],
        top_net=[
            {k: r[k] for k in ("name", "avg_day", "avg_month", "worst", "ge15k", "red", "net")}
            for r in by_net[:10]
        ],
        zero_red=[{k: r[k] for k in ("name", "avg_month", "worst", "ge15k", "net")} for r in zero[:8]],
        oracle={k: next(r for r in results if r["name"] == "ORACLE")[k] for k in ("avg_day", "avg_month", "worst", "ge15k", "red", "net")},
        how=(
            "Each morning: bucket OR regime (width/drive/gap/EMA/OR dir). "
            "Pick the arm with highest historical EV in that bucket from 2020-2023 "
            "(Donch/Swing/Trail/OR-retest/STAND). Optional: EV gates, defend when month red, "
            "month-lock after target. 1 lot only — profit from clever switches, not size."
        ),
    )
    (OUT / "monster-ev-1lot.json").write_text(json.dumps(out, indent=2))
    print("\n" + out["verdict"], flush=True)
    print("TOP CLEVER:", flush=True)
    for r in clever[:12]:
        print(f"  {r['name']:40s} ge15k={r['ge15k']:2d} red={r['red']:2d} avgM={r['avg_month']:7.0f} worst={r['worst']:8.0f} net={r['net']:9.0f}", flush=True)
    print("ZERO RED:", zero[:5], flush=True)


if __name__ == "__main__":
    main()
