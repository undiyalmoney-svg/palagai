#!/usr/bin/env python3
"""
Prior-day / morning-only regime filter for VolExpand Donch15.

No look-ahead: features known by OR end (10:15) using prior day + morning OR only.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
# Prefer repo script; fall back to /tmp copy from research branch
UNI = ROOT / "scripts" / "strategy-universe-search.py"
if not UNI.exists():
    UNI = Path("/tmp/uni.py")

spec = importlib.util.spec_from_file_location("uni", UNI)
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)

CACHE = Path(ROOT / "reports" / "analyst-cache")
OUT = Path("/tmp/regime-filter")
OUT.mkdir(parents=True, exist_ok=True)


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def day_bars(inst, d: str):
    # inst has days array parallel to bars
    idxs = [i for i, day in enumerate(inst.days) if day == d]
    return idxs


def atr_at(inst, i: int, period=14) -> float:
    if i < period:
        return float("nan")
    # use precomputed if present
    if hasattr(inst, "atr14") and inst.atr14[i] == inst.atr14[i]:
        return float(inst.atr14[i])
    return float("nan")


def features_for_day(inst, d: str) -> dict | None:
    """Features known by 10:15 (OR end)."""
    idxs = day_bars(inst, d)
    if len(idxs) < 5:
        return None
    # previous trading day
    all_days = sorted(set(inst.days))
    if d not in all_days:
        return None
    di = all_days.index(d)
    if di == 0:
        return None
    prev = all_days[di - 1]
    pidx = day_bars(inst, prev)
    if not pidx:
        return None

    open_m = to_min("09:15")
    or_end_m = to_min("10:15")

    # OR bars
    or_hi, or_lo = -1e18, 1e18
    first_o = last_c = None
    or_count = 0
    day_open = None
    for i in idxs:
        m = int(inst.mins[i])
        if m < open_m:
            continue
        if day_open is None:
            day_open = float(inst.o[i])
        if m >= or_end_m:
            break
        or_hi = max(or_hi, float(inst.h[i]))
        or_lo = min(or_lo, float(inst.l[i]))
        if first_o is None:
            first_o = float(inst.o[i])
        last_c = float(inst.c[i])
        or_count += 1
    if or_count < 3 or first_o is None or last_c is None or not (or_hi > or_lo):
        return None

    or_width = or_hi - or_lo
    or_drive = abs(last_c - first_o)

    # ATR at last OR bar
    last_or_i = None
    for i in idxs:
        m = int(inst.mins[i])
        if m < open_m:
            continue
        if m >= or_end_m:
            break
        last_or_i = i
    atr = atr_at(inst, last_or_i) if last_or_i is not None else float("nan")
    if atr != atr or atr <= 0:
        return None

    prev_o = float(inst.o[pidx[0]])
    prev_c = float(inst.c[pidx[-1]])
    prev_h = float(max(inst.h[i] for i in pidx))
    prev_l = float(min(inst.l[i] for i in pidx))
    prev_range = prev_h - prev_l
    prev_body = abs(prev_c - prev_o)
    gap = abs(day_open - prev_c) if day_open is not None else 0.0

    return dict(
        or_width=or_width,
        or_width_atr=or_width / atr,
        or_drive=or_drive,
        or_drive_frac=or_drive / or_width if or_width > 0 else 0,
        atr=atr,
        prev_range=prev_range,
        prev_body=prev_body,
        prev_body_frac=prev_body / prev_range if prev_range > 0 else 0,
        gap=gap,
        gap_atr=gap / atr,
        prev_trend=1 if prev_c > prev_o else (-1 if prev_c < prev_o else 0),
    )


def generate_signals(inst, spec):
    """Load Signal + generate_signals helper (no Kite auth)."""
    vc = Path("/tmp/vehicle-comparison-noload.py")
    vspec = importlib.util.spec_from_file_location("vc", vc)
    vmod = importlib.util.module_from_spec(vspec)
    sys.modules["uni"] = uni
    sys.modules["vc"] = vmod
    vspec.loader.exec_module(vmod)
    return vmod.generate_signals(inst, spec)



def metrics(pts):
    if not pts:
        return dict(n=0, exp=None, net=0, wr=None, pf=None)
    a = np.array(pts, float)
    wins = a[a > 0]
    losses = a[a <= 0]
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) and losses.sum() != 0 else (999 if len(wins) else 0)
    return dict(
        n=int(len(a)),
        exp=round(float(a.mean()), 2),
        net=round(float(a.sum()), 1),
        wr=round(float((a > 0).mean() * 100), 1),
        pf=round(pf, 3),
    )


def main():
    nifty = uni.load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    spec = uni.Spec("vol_expand", 15, "ema50", "eod", 0, 0.0, "10:15", "10:15", "11:30", True)

    print("Generating signals...", flush=True)
    signals = generate_signals(nifty, spec) + generate_signals(bank, spec)
    oos = [s for s in signals if s.year >= 2024]
    print(f"  oos={len(oos)}", flush=True)

    inst_map = {"nifty": nifty, "bank": bank}
    feat_cache = {}

    def feat(sig):
        key = (sig.instrument, sig.date)
        if key not in feat_cache:
            feat_cache[key] = features_for_day(inst_map[sig.instrument], sig.date)
        return feat_cache[key]

    # Annotate
    enriched = []
    miss = 0
    for s in oos:
        f = feat(s)
        if f is None:
            miss += 1
            continue
        enriched.append((s, f))
    print(f"  with features={len(enriched)} miss={miss}", flush=True)

    # Filter definitions (morning/prior only)
    filters = {
        "none": lambda f: True,
        "or_wide_0.8": lambda f: f["or_width_atr"] >= 0.8,
        "or_wide_1.0": lambda f: f["or_width_atr"] >= 1.0,
        "or_wide_1.2": lambda f: f["or_width_atr"] >= 1.2,
        "prev_trend_body_0.5": lambda f: f["prev_body_frac"] >= 0.5,
        "prev_trend_body_0.6": lambda f: f["prev_body_frac"] >= 0.6,
        "gap_0.3atr": lambda f: f["gap_atr"] >= 0.3,
        "gap_0.5atr": lambda f: f["gap_atr"] >= 0.5,
        "or_drive_0.4": lambda f: f["or_drive_frac"] >= 0.4,
        "or_drive_0.5": lambda f: f["or_drive_frac"] >= 0.5,
        # Practical: trending morning OR high morning vol OR meaningful gap
        "trend_or_vol_v1": lambda f: (
            f["or_width_atr"] >= 1.0
            or f["prev_body_frac"] >= 0.55
            or f["gap_atr"] >= 0.4
            or f["or_drive_frac"] >= 0.45
        ),
        "trend_or_vol_v2": lambda f: (
            f["or_width_atr"] >= 0.9
            or f["prev_body_frac"] >= 0.5
            or f["gap_atr"] >= 0.35
        ),
        "trend_or_vol_v3": lambda f: (
            f["or_width_atr"] >= 1.1
            or f["prev_body_frac"] >= 0.6
            or f["gap_atr"] >= 0.5
            or f["or_drive_frac"] >= 0.5
        ),
        # Stricter: require morning vol expansion (OR vs ATR) OR prior trend day
        "or_or_prev_v1": lambda f: f["or_width_atr"] >= 1.0 or f["prev_body_frac"] >= 0.55,
        "or_or_prev_v2": lambda f: f["or_width_atr"] >= 0.9 or f["prev_body_frac"] >= 0.5,
    }

    rows = []
    print(f"\n{'filter':22} {'keep%':>6} {'n':>4} {'exp':>7} {'net':>9} {'wr':>6} {'pf':>6} {'mar26_n':>7} {'mar26_exp':>9} {'mar26_net':>9}")
    for name, fn in filters.items():
        kept = [(s, f) for s, f in enriched if fn(f)]
        pts = [s.index_pts for s, _ in kept]
        mar = [(s, f) for s, f in kept if s.date.startswith("2026-03")]
        mar_pts = [s.index_pts for s, _ in mar]
        m = metrics(pts)
        mm = metrics(mar_pts)
        keep_pct = round(100 * len(kept) / max(len(enriched), 1), 1)
        rows.append(
            dict(
                filter=name,
                keep_pct=keep_pct,
                oos=m,
                mar2026=mm,
            )
        )
        print(
            f"{name:22} {keep_pct:5.1f}% {m['n']:4} {m['exp']} {m['net']:9} {m['wr']}% {m['pf']:6} "
            f"{mm['n']:7} {mm['exp']} {mm['net']:9}"
        )

    # Pick best: maximize OOS exp with keep>=45% and mar26 exp improved vs baseline
    baseline_mar = next(r for r in rows if r["filter"] == "none")["mar2026"]
    baseline_oos = next(r for r in rows if r["filter"] == "none")["oos"]
    candidates = [
        r
        for r in rows
        if r["filter"] != "none"
        and r["keep_pct"] >= 45
        and r["oos"]["exp"] is not None
        and r["oos"]["exp"] > baseline_oos["exp"]
    ]
    # Prefer also better/less bad Mar 2026
    candidates.sort(
        key=lambda r: (
            (r["mar2026"]["exp"] or -1e9),
            r["oos"]["exp"],
            r["keep_pct"],
        ),
        reverse=True,
    )
    best = candidates[0] if candidates else None

    # Also rank by OOS exp alone
    by_oos = sorted(
        [r for r in rows if r["filter"] != "none" and r["keep_pct"] >= 45],
        key=lambda r: r["oos"]["exp"] or -1e9,
        reverse=True,
    )

    report = dict(
        baseline=dict(oos=baseline_oos, mar2026=baseline_mar),
        filters=rows,
        best_for_mar_and_oos=best,
        best_oos=by_oos[0] if by_oos else None,
        rule_text={
            "trend_or_vol_v2": "Allow if OR_width/ATR>=0.9 OR prev_body/prev_range>=0.5 OR gap/ATR>=0.35",
            "or_or_prev_v2": "Allow if OR_width/ATR>=0.9 OR prev_body/prev_range>=0.5",
            "trend_or_vol_v1": "Allow if OR/ATR>=1.0 OR prev_body_frac>=0.55 OR gap/ATR>=0.4 OR OR_drive_frac>=0.45",
        },
    )
    json.dump(report, open(OUT / "summary.json", "w"), indent=2)
    print("\nBEST (Mar+OOS):", json.dumps(best, indent=2))
    print("BEST OOS:", json.dumps(by_oos[0] if by_oos else None, indent=2))
    print(f"Wrote {OUT}/summary.json")


if __name__ == "__main__":
    main()
