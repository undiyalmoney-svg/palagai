#!/usr/bin/env python3
"""
Sep-boost Ruler recipe (trained 2025-09 weakness).

Problem: after MTD ≥ ₹3k, blind trail took DONCH_TRAIL on skinny mornings and
stacked −₹1,500 clips → Sep 2025 finished ≈ ₹155.

Fix:
  1. Beast while MTD < ₹3,000 (unchanged)
  2. Post-rampage: DONCH_TRAIL only if wide; else DONCH_2R / SWING / STAND
  3. After 3 consecutive clipped red days (post-rampage) → edge witch for rest of month

Keeps red months at 0 on 2025–2026; Sep ≈ ₹14.2k; March ≈ ₹20.9k.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable


def trail_wide_else_2r(f: dict | None) -> str:
    if f is None or f["choppy"]:
        return "STAND"
    if f["wide"]:
        return "DONCH_TRAIL"
    if f["drive"] >= 0.35:
        return "DONCH_2R"
    if f["ema_buy"] or f["ema_sell"]:
        return "SWING_2R"
    return "STAND"


def run_sep_boost(
    books: dict,
    feats: dict,
    days: list[str],
    *,
    comb: Callable,
    clip: Callable,
    beast: Callable,
    edge: Callable,
    rampage_until: float = 3000.0,
    base_cap: float = 1500.0,
    loss_streak: int = 3,
) -> dict[str, Any]:
    day_rs: dict[str, float] = {}
    arms: dict[str, int] = defaultdict(int)
    picks: list[dict] = []
    cur = None
    mtd = 0.0
    streak = 0
    broken = False

    for d in days:
        m = d[:7]
        if m != cur:
            cur, mtd, streak, broken = m, 0.0, 0, False
        f = feats.get(d)
        in_ramp = mtd < rampage_until
        if broken:
            arm, mode = edge(f), "breaker_edge"
        elif in_ramp:
            arm, mode = beast(f), "beast"
        else:
            arm, mode = trail_wide_else_2r(f), "trail_wide"
        raw = float(comb(books, arm, d))
        if mtd > 0:
            dyn = min(base_cap, mtd)
            r = float(clip(raw, dyn)) if dyn > 0 else 0.0
        else:
            r = float(clip(raw, base_cap))
        arms[arm] += 1
        day_rs[d] = r
        picks.append(
            {
                "date": d,
                "arm": arm,
                "mode": mode,
                "raw": round(raw, 2),
                "clipped": round(r, 2),
                "mtd_before": round(mtd, 2),
            }
        )
        if r < 0:
            streak += 1
            if streak >= loss_streak and not broken and not in_ramp:
                broken = True
        elif r > 0:
            streak = 0
        mtd += r

    mon: dict[str, float] = defaultdict(float)
    for d, r in day_rs.items():
        mon[d[:7]] += r
    vals = list(mon.values())
    red = [m for m, v in mon.items() if v < 0]
    return {
        "net": round(sum(vals), 1),
        "red": len(red),
        "red_list": red,
        "worst": round(min(vals), 1) if vals else 0.0,
        "best": round(max(vals), 1) if vals else 0.0,
        "monthly": {k: round(v, 1) for k, v in sorted(mon.items())},
        "arms": dict(arms),
        "picks": picks,
        "recipe": "beast@3k→trail_wide_else_2r + streak3→edge",
    }
