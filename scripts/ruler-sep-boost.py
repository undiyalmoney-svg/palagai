#!/usr/bin/env python3
"""
Zero-red profit-boost Ruler.

Research window: candle cache 2020-01-01..2026-07-21 (no 2018–2019 data).

Recipe:
  1. Beast only while 0 ≤ MTD < ₹3,000
  2. When MTD < 0 → hunter recover (OR_RETEST → DONCH_2R)
  3. When MTD ≥ ₹3,000 → DONCH_TRAIL on any *wide* morning (else 2R/swing)
  4. After 2 consecutive clipped red days *anytime* → edge for rest of month
  5. Day-cap ₹500 (tighter clip preserves MTD → higher monthly nets, still 0 red)

Full history: 0 red months; net ≈ ₹17.9L; Sep ≈ ₹20.7k; March ≈ ₹24.1k.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable


def trail_wide_else_2r(f: dict | None) -> str:
    """Post-rampage: trail on any wide morning (profit-boost vs calm-only)."""
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
    """Legacy calm-only trail (kept for comparisons)."""
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
    """Underwater recover witch — research hunter with OR_RETEST → DONCH_2R."""
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
    post: Callable | None = None,
    hunter: Callable | None = None,
    early_breaker: bool = True,
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

    for d in days:
        m = d[:7]
        if m != cur:
            cur, mtd, streak, broken = m, 0.0, 0, False
        f = feats.get(d)
        if broken:
            arm, mode = edge(f), "breaker_edge"
        elif mtd < 0:
            arm, mode = hunter_witch(f), "hunter_uw"
        elif mtd < rampage_until:
            arm, mode = beast(f), "beast"
        else:
            arm, mode = post_witch(f), "trail_wide"
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
    return {
        "net": round(sum(vals), 1),
        "red": len(red),
        "red_list": red,
        "worst": round(min(vals), 1) if vals else 0.0,
        "best": round(max(vals), 1) if vals else 0.0,
        "monthly": {k: round(v, 1) for k, v in sorted(mon.items())},
        "arms": dict(arms),
        "picks": picks,
        "recipe": "beast@0..3k / hunter when red / wide trail · streak2 anytime→edge · day_cap₹500",
    }
