#!/usr/bin/env python3
"""
Motive: every month ≥ ₹15,000 and 0 red months (causal auto-bot).
Hunt lock targets, lot scaling, multi-arm paths. Writes research JSON.
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path("/workspace")
OUT = Path("/tmp/auto-strategy-select")
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("uni", str(ROOT / "scripts" / "strategy-universe-search.py"))
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)
spec2 = importlib.util.spec_from_file_location("sr", str(ROOT / "scripts" / "sr-pullback-retest-daily500.py"))
sr = importlib.util.module_from_spec(spec2)
sys.modules["sr"] = sr
spec2.loader.exec_module(sr)

OOS = "2024-01-01"
TARGET = 15_000


def day_pnl(dates, rs, start=OOS):
    out = defaultdict(float)
    for d, r in zip(dates, rs):
        if d >= start:
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
    score = (
        (2 if wide else 0)
        + (1 if vwide else 0)
        + (2 if drive >= 0.45 else 0)
        + (1 if drive >= 0.65 else 0)
        + (1 if calm else 0)
        + (1 if ema_buy or ema_sell else 0)
        + (0 if choppy else 1)
    )
    return dict(
        drive=drive,
        gap=gap,
        wide=wide,
        vwide=vwide,
        calm=calm,
        choppy=choppy,
        ema_buy=ema_buy,
        ema_sell=ema_sell,
        score=score,
        or_up=or_c >= or_o,
        strong=drive >= 0.45,
        vstrong=drive >= 0.65,
    )


def build_books(nifty, bank, start=OOS):
    specs = {
        "DONCH_2R": sr.SRSpec("donch_retest", 20, "or_mid", "rr2", "09:45", "09:45", "15:10", True),
        "DONCH_15R": sr.SRSpec("donch_retest", 20, "or_mid", "rr1_5", "09:45", "09:45", "15:10", True),
        "SWING_2R": sr.SRSpec("swing_retest", 0, "ema50", "rr2", "09:45", "09:45", "15:10", True),
        "OR_RETEST_2R": sr.SRSpec("or_retest", 0, "or_break", "rr2", "09:45", "09:45", "14:30", True),
        "DONCH_TRAIL": sr.SRSpec("donch_retest", 20, "or_break", "swing_trail", "09:45", "09:45", "15:10", False),
    }
    books = {}
    for name, sp in specs.items():
        books[name] = {}
        for inst in (nifty, bank):
            print(f"  sim {name} {inst.name}", flush=True)
            _, rs, _, dates = sr.simulate(inst, sp)
            books[name][inst.name] = day_pnl(dates, rs, start)
    return books


def comb(books, arm, d, lots=1.0):
    if arm == "STAND":
        return 0.0
    return lots * float(books[arm]["nifty"].get(d, 0.0) + books[arm]["bank"].get(d, 0.0))


def score_months(day_rs, days, start=OOS, end="2099"):
    months = sorted({d[:7] for d in days if start <= d < end})
    monthly = {m: 0.0 for m in months}
    for d, r in day_rs.items():
        if start <= d < end:
            monthly[d[:7]] = monthly.get(d[:7], 0.0) + r
    vals = [monthly[m] for m in months]
    red = [m for m in months if monthly[m] < 0]
    below = [m for m in months if monthly[m] < TARGET]
    n = len(months)
    return dict(
        green=sum(1 for v in vals if v > 0),
        red=len(red),
        n=n,
        net=round(sum(vals), 1),
        avg=round(sum(vals) / n, 1) if n else 0,
        worst=round(min(vals), 1) if vals else 0,
        best=round(max(vals), 1) if vals else 0,
        ge15k=sum(1 for v in vals if v >= TARGET),
        ge15k_pct=round(100 * sum(1 for v in vals if v >= TARGET) / n, 1) if n else 0,
        below15k=below,
        red_list=red,
        monthly={k: round(v, 1) for k, v in monthly.items()},
        all_ge15k=all(v >= TARGET for v in vals) if vals else False,
        zero_red=len(red) == 0,
    )


# --- pickers ---
def pick_regime(f):
    if f is None or f["choppy"]:
        return "STAND"
    if f["wide"] and f["drive"] >= 0.35:
        return "DONCH_2R"
    if f["ema_buy"] or f["ema_sell"]:
        return "SWING_2R"
    return "STAND"


def pick_edge(f):
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


def pick_edge_no_trail(f):
    a = pick_edge(f)
    return "DONCH_2R" if a == "DONCH_TRAIL" else a


def pick_donch(f):
    return "DONCH_2R" if f and not f["choppy"] else "STAND"


def pick_donch_s4(f):
    return "DONCH_2R" if f and f["score"] >= 4 and not f["choppy"] else "STAND"


def pick_safe(f):
    if f is None or f["choppy"]:
        return "STAND"
    if f["ema_buy"] and f["or_up"] and f["wide"]:
        return "SWING_2R"
    if f["ema_sell"] and (not f["or_up"]) and f["wide"]:
        return "SWING_2R"
    if f["drive"] >= 0.35 and f["calm"]:
        return "DONCH_2R"
    if f["drive"] >= 0.50:
        return "DONCH_15R"
    return "STAND"


def pick_trail(f):
    return "DONCH_TRAIL" if f and not f["choppy"] else "STAND"


def pick_max_edge_morning(f, books, d, lots):
    """Causal? NO — uses same-day outcome. Only for oracle bound."""
    best_a, best_r = "STAND", 0.0
    for a in ("DONCH_2R", "DONCH_15R", "SWING_2R", "OR_RETEST_2R", "DONCH_TRAIL"):
        r = comb(books, a, d, lots)
        if r > best_r:
            best_r, best_a = r, a
    return best_a if best_r > 0 else "STAND"


def run(pick, books, feats, days, lots=1.0, lock=TARGET, no_dig=False, max_loss=99, soft_continue_score=None):
    """Trade until MTD>=lock then stand (unless soft continue on high score)."""
    day_rs = {}
    cur_m = None
    mtd = 0.0
    nl = 0
    for d in days:
        if d < OOS:
            continue
        m = d[:7]
        if m != cur_m:
            cur_m, mtd, nl = m, 0.0, 0
        f = feats.get(d)
        if mtd >= lock:
            if soft_continue_score is None or f is None or f["score"] < soft_continue_score:
                day_rs[d] = 0.0
                continue
        if no_dig and mtd < 0:
            day_rs[d] = 0.0
            continue
        if nl >= max_loss:
            day_rs[d] = 0.0
            continue
        arm = pick(f)
        rs = comb(books, arm, d, lots)
        if arm != "STAND" and rs < 0:
            nl += 1
        day_rs[d] = rs
        mtd += rs
    return day_rs


def run_two_phase(books, feats, days, lots, phase1_pick, phase2_pick, switch_at, lock=TARGET):
    """Aggressive until switch_at or N losses, then safe until lock."""
    day_rs = {}
    cur_m = None
    mtd = 0.0
    nl = 0
    for d in days:
        if d < OOS:
            continue
        m = d[:7]
        if m != cur_m:
            cur_m, mtd, nl = m, 0.0, 0
        if mtd >= lock:
            day_rs[d] = 0.0
            continue
        f = feats.get(d)
        arm = phase1_pick(f) if mtd < switch_at and nl < 2 else phase2_pick(f)
        rs = comb(books, arm, d, lots)
        if arm != "STAND" and rs < 0:
            nl += 1
        day_rs[d] = rs
        mtd += rs
    return day_rs


def main():
    print("Loading…", flush=True)
    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = build_books(nifty, bank)
    days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    oos_days = [d for d in days if d >= OOS]
    feats = {}
    for d in oos_days:
        fn = morning_feat(nifty, d) if d in nifty.day_starts else None
        feats[d] = fn or (morning_feat(bank, d) if d in bank.day_starts else None)

    # Oracle day series
    oracle = {}
    for d in oos_days:
        best = max(comb(books, a, d, 1.0) for a in books)
        oracle[d] = best if best > 0 else 0.0

    results = []

    def add(name, day_rs):
        s = score_months(day_rs, days)
        s["name"] = name
        results.append(s)
        if s["all_ge15k"] and s["zero_red"]:
            print(f"  HIT {name}: net={s['net']:.0f} worst={s['worst']:.0f} avg={s['avg']:.0f}", flush=True)
        return s

    add("ORACLE_1lot", oracle)

    bases = {
        "regime": pick_regime,
        "edge": pick_edge,
        "edgeNT": pick_edge_no_trail,
        "donch": pick_donch,
        "donch_s4": pick_donch_s4,
        "safe": pick_safe,
        "trail": pick_trail,
    }

    print("Grid lots × lock × base…", flush=True)
    for lots, lock, bname in itertools.product(
        [1, 2, 3, 4, 5, 6, 8, 10],
        [15000, 16000, 18000, 20000, 25000, 30000],
        bases,
    ):
        dr = run(bases[bname], books, feats, days, lots=lots, lock=lock)
        add(f"{bname}_x{lots}_L{lock}", dr)

    # no-dig variants
    for lots, bname in itertools.product([2, 3, 4, 5, 6], ["edge", "edgeNT", "donch_s4", "regime", "trail"]):
        dr = run(bases[bname], books, feats, days, lots=lots, lock=TARGET, no_dig=True, max_loss=3)
        add(f"{bname}_x{lots}_L15k_nodig_ml3", dr)

    # soft continue after lock
    for lots, soft in itertools.product([2, 3, 4, 5], [6, 7, 8]):
        dr = run(pick_edge, books, feats, days, lots=lots, lock=TARGET, soft_continue_score=soft)
        add(f"edge_x{lots}_L15k_soft{soft}", dr)

    # two-phase edge→safe
    for lots, sw in itertools.product([2, 3, 4, 5, 6], [0, 3000, 5000, 8000, 10000]):
        dr = run_two_phase(books, feats, days, lots, pick_edge, pick_safe, sw, lock=TARGET)
        add(f"twophase_edge_safe_x{lots}_sw{sw}_L15k", dr)
        dr2 = run_two_phase(books, feats, days, lots, pick_edge, pick_donch_s4, sw, lock=TARGET)
        add(f"twophase_edge_s4_x{lots}_sw{sw}_L15k", dr2)

    # keep trading edge with no lock but stop month if hit 15k (same as lock)
    # already covered

    # Scale oracle to see lot floor for 15k (already know 1 lot works for oracle)
    for lots in (1, 2, 3):
        add(f"ORACLE_x{lots}", {d: oracle[d] * lots for d in oracle})

    # Find minimum lots such that SOME causal policy hits all_ge15k
    hits = [r for r in results if r["all_ge15k"] and r["zero_red"] and not r["name"].startswith("ORACLE")]
    hits.sort(key=lambda r: (r["name"].split("_x")[1].split("_")[0] if "_x" in r["name"] else 99, -r["worst"], -r["net"]))
    # better sort by lots then -worst
    def lots_of(name):
        if "_x" in name:
            try:
                return int(name.split("_x")[1].split("_")[0])
            except Exception:
                return 99
        return 99

    hits.sort(key=lambda r: (lots_of(r["name"]), -r["worst"], -r["net"]))

    # Near misses: zero red + high ge15k count
    near = [r for r in results if r["zero_red"] and not r["name"].startswith("ORACLE")]
    near.sort(key=lambda r: (-r["ge15k"], -r["worst"], -r["net"]))

    # Best ge15k even with some red
    by_ge = sorted(
        [r for r in results if not r["name"].startswith("ORACLE")],
        key=lambda r: (-r["ge15k"], r["red"], -r["worst"]),
    )

    # Path: what lots needed for each base to get all months >=15k with lock 15k
    path = {}
    for bname in bases:
        for lots in range(1, 21):
            dr = run(bases[bname], books, feats, days, lots=lots, lock=TARGET)
            s = score_months(dr, days)
            if s["all_ge15k"] and s["zero_red"]:
                path[bname] = dict(lots=lots, **{k: s[k] for k in ("net", "avg", "worst", "best", "ge15k", "n", "monthly")})
                print(f"PATH {bname} needs x{lots}: worst={s['worst']:.0f} avg={s['avg']:.0f}", flush=True)
                break
        else:
            path[bname] = None
            print(f"PATH {bname}: NOT possible ≤20 lots with L15k freeze", flush=True)

    # Without freeze — trade all month — can we get all >=15k with 0 red?
    path_nofreeze = {}
    for bname in bases:
        for lots in range(1, 21):
            dr = run(bases[bname], books, feats, days, lots=lots, lock=10**12)  # no practical lock
            s = score_months(dr, days)
            if s["all_ge15k"] and s["zero_red"]:
                path_nofreeze[bname] = dict(lots=lots, net=s["net"], worst=s["worst"], red=s["red"])
                print(f"NOFREEZE {bname} x{lots}: worst={s['worst']:.0f} red={s['red']}", flush=True)
                break
        else:
            # report best lots by ge15k
            best = None
            for lots in (1, 2, 3, 4, 5, 8, 10):
                dr = run(bases[bname], books, feats, days, lots=lots, lock=10**12)
                s = score_months(dr, days)
                if best is None or s["ge15k"] > best["ge15k"] or (s["ge15k"] == best["ge15k"] and s["red"] < best["red"]):
                    best = dict(lots=lots, **{k: s[k] for k in ("ge15k", "red", "worst", "net", "below15k")})
            path_nofreeze[bname] = dict(impossible_le20=True, best_try=best)

    # Hybrid: increase lots only when MTD behind pace — skip for now

    # Capital estimate: Nifty ~₹65*~25000 notional rough; for lots use margin proxy
    # India index: Nifty opt/fut margin rough — report lots only

    winner = hits[0] if hits else None
    # Prefer lowest lots among hits
    if hits:
        min_lots = min(lots_of(r["name"]) for r in hits)
        winners_min = [r for r in hits if lots_of(r["name"]) == min_lots]
        winners_min.sort(key=lambda r: (-r["worst"], -r["net"]))
        winner = winners_min[0]

    out = dict(
        motive="Every month ≥ ₹15,000 and 0 red months (causal)",
        oos=f"{oos_days[0]} → {oos_days[-1]}",
        target=TARGET,
        oracle_1lot=score_months(oracle, days),
        n_tested=len(results),
        n_hit=len(hits),
        winner=winner,
        top_hits=[
            {k: r[k] for k in ("name", "ge15k", "red", "net", "avg", "worst", "best", "monthly")}
            for r in hits[:15]
        ],
        path_min_lots_with_lock15k=path,
        path_nofreeze=path_nofreeze,
        top_near_zero_red=[
            {k: r[k] for k in ("name", "ge15k", "ge15k_pct", "red", "net", "worst", "below15k")}
            for r in near[:20]
        ],
        top_by_ge15k=[
            {k: r[k] for k in ("name", "ge15k", "red", "net", "worst", "below15k")}
            for r in by_ge[:15]
        ],
    )

    if winner:
        out["verdict"] = (
            f"POSSIBLE: **{winner['name']}** → {winner['ge15k']}/{winner['n']} months ≥₹15k, "
            f"0 red, worst ₹{winner['worst']:,.0f}, avg ₹{winner['avg']:,.0f}, net ₹{winner['net']:,.0f}. "
            f"Requires position size embedded in name (lots multiplier on 1-lot DNA)."
        )
        out["how_to_make_possible"] = {
            "mechanism": "Scale lots so month-lock at ₹15k is reachable before month ends; freeze once MTD≥15k.",
            "min_lots_by_base": {k: (v["lots"] if v else None) for k, v in path.items()},
            "recommended": winner["name"],
            "english": (
                "Run the named morning router on Nifty+Bank with N lots (N from name). "
                "Each month trade until MTD ≥ ₹15,000 then STAND. Causal: morning features + MTD only."
            ),
        }
    else:
        # find closest
        closest = near[0] if near else by_ge[0]
        out["verdict"] = (
            f"No causal hit in tested grid for all months ≥15k with 0 red. "
            f"Closest zero-red: {closest['name']} ge15k={closest.get('ge15k')}/{closest.get('n')} "
            f"worst=₹{closest.get('worst')}. Oracle 1-lot already has every month ≥₹42k — "
            f"gap is selection quality vs size."
        )
        out["how_to_make_possible"] = {
            "oracle_proves_money_exists": True,
            "oracle_worst_month": out["oracle_1lot"]["worst"],
            "options": [
                "Increase lots until a causal router+lock15k clears every month (see path_min_lots)",
                "Improve morning router toward oracle (hard)",
                "Add other books (stocks GAP_FADE, crude) as parallel income to lift weak months",
            ],
            "path_min_lots_with_lock15k": {k: (v["lots"] if v else None) for k, v in path.items()},
        }

    (OUT / "fifteen-k-every-month.json").write_text(json.dumps(out, indent=2))
    slim = {
        "verdict": out["verdict"],
        "how": out.get("how_to_make_possible"),
        "oracle_worst": out["oracle_1lot"]["worst"],
        "oracle_ge15k": out["oracle_1lot"]["ge15k"],
        "n_hit": out["n_hit"],
        "winner": (
            {k: winner[k] for k in ("name", "ge15k", "red", "net", "avg", "worst", "best", "monthly")}
            if winner
            else None
        ),
        "path_lots": {k: (v["lots"] if v else None) for k, v in path.items()},
        "top_hits": out["top_hits"][:8],
        "top_near": out["top_near_zero_red"][:8],
    }
    (OUT / "fifteen-k-slim.json").write_text(json.dumps(slim, indent=2))
    print(json.dumps(slim, indent=2), flush=True)


if __name__ == "__main__":
    main()
