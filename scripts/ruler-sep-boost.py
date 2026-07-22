#!/usr/bin/env python3
"""
Zero-red Ruler + ₹15k month bank.

Recipe:
  1. MTD ≥ ₹15,000 → STAND (bank the month)
  2. Beast only while 0 ≤ MTD < ₹3,000
  3. MTD < 0 → hunter recover
  4. Else → trail on wide mornings
  5. 2 clipped reds anytime → edge
  6. Day-cap ₹500

Trained and reported at 1 lot only.
Research: no causal 1-lot router clears ₹15k in every 2020–2026 month (0 red kept).
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


def trail_wide_calm_else_2r(f: dict | None) -> str:
    if f is None or f["choppy"]:
        return "STAND"
    if f["wide"] and f["calm"]:
        return "DONCH_TRAIL"
    if f["wide"] and f["drive"] >= 0.35:
        return "DONCH_2R"
    if f["drive"] >= 0.35:
        return "DONCH_2R"
    if f["ema_buy"] or f["ema_sell"]:
        return "SWING_2R"
    return "STAND"


def hunter_uw(f: dict | None) -> str:
    if f is None or f["choppy"]:
        return "STAND"
    if f["vwide"] and f["vstrong"]:
        return "DONCH_TRAIL"
    if f["vwide"] and f["strong"]:
        return "DONCH_2R"
    if f["wide"] and f["drive"] >= 0.35 and f["calm"]:
        return "DONCH_2R"
    if f["wide"] and (f["ema_buy"] or f["ema_sell"]):
        return "SWING_2R"
    if f["drive"] >= 0.5:
        return "DONCH_15R"
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
    base_cap: float = 500.0,
    loss_streak: int = 2,
    month_target: float = 15000.0,
    post: Callable | None = None,
    hunter: Callable | None = None,
    early_breaker: bool = True,
    lots: float = 1.0,
) -> dict[str, Any]:
    post_witch = post or trail_wide_else_2r
    hunter_witch = hunter or hunter_uw
    day_rs: dict[str, float] = {}
    arms: dict[str, int] = defaultdict(int)
    picks: list[dict] = []
    cur = None
    mtd = 0.0
    streak = 0
    broken = False

    def sized_comb(arm: str, d: str) -> float:
        return float(lots) * float(comb(books, arm, d))

    for d in days:
        m = d[:7]
        if m != cur:
            cur, mtd, streak, broken = m, 0.0, 0, False
        f = feats.get(d)
        if month_target and mtd >= month_target:
            arm, mode = "STAND", "month_bank"
        elif broken:
            arm, mode = edge(f), "breaker_edge"
        elif mtd < 0:
            arm, mode = hunter_witch(f), "hunter_uw"
        elif mtd < rampage_until:
            arm, mode = beast(f), "beast"
        else:
            arm, mode = post_witch(f), "trail_wide"
        raw = float(sized_comb(arm, d))
        cap = float(base_cap)  # absolute ₹ (Angular-style), not scaled by lots
        if mtd > 0:
            dyn = min(cap, mtd)
            r = float(clip(raw, dyn)) if dyn > 0 else 0.0
        else:
            r = float(clip(raw, cap))
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
            if streak >= loss_streak and not broken:
                if early_breaker or mtd >= rampage_until:
                    broken = True
        elif r > 0:
            streak = 0
        mtd += r

    mon: dict[str, float] = defaultdict(float)
    for d, r in day_rs.items():
        mon[d[:7]] += r
    vals = list(mon.values())
    red = [m for m, v in mon.items() if v < 0]
    below = sorted(m for m, v in mon.items() if v < month_target)
    return {
        "net": round(sum(vals), 1),
        "red": len(red),
        "red_list": red,
        "worst": round(min(vals), 1) if vals else 0.0,
        "best": round(max(vals), 1) if vals else 0.0,
        "ge15k": sum(1 for v in vals if v >= month_target),
        "below15k": below,
        "n_months": len(vals),
        "monthly": {k: round(v, 1) for k, v in sorted(mon.items())},
        "arms": dict(arms),
        "picks": picks,
        "lots": lots,
        "recipe": f"beast@0..3k / hunter when red / wide trail · streak2→edge · day_cap₹{int(base_cap)} · bank@{int(month_target)} · lots={lots}",
    }
