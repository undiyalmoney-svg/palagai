#!/usr/bin/env python3
"""
Discipline-trained Ruler recipe (capital protect + selective entry/exit).

Research window: candle cache 2020-01-01..2026-07-21 (no 2018–2019 data).

Problem history:
  - Blind post-rampage trail on skinny mornings → Sep 2025 bleed (Sep-boost fix).
  - ₹1,500 day-cap + 3-loss breaker still left 9 red months 2020–2026
    (worst 2022-05 ≈ −₹8,050).

Discipline train (2020–2026):
  1. Beast while MTD < ₹3,000 (entry gate: choppy STAND; wide+strong trail;
     wide+drive 2R; EMA swing)
  2. Post-rampage: DONCH_TRAIL only if *wide and calm*; else DONCH_2R / SWING / STAND
     (exit discipline — no trail on wide-but-jumpy mornings)
  3. After 2 consecutive clipped red days (post-rampage) → edge witch for rest of month
  4. Day-cap ₹1,000 (capital protect; dyn when month green)

Keeps 2025–2026 red=0; Sep ≈ ₹19.7k; March ≈ ₹27.4k;
full-history red 9→2, worst −₹8k→−₹2.1k.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable


def trail_wide_else_2r(f: dict | None) -> str:
    """Legacy Sep-boost post witch (wide → trail). Prefer trail_wide_calm_else_2r."""
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
    """Post-rampage exit discipline: trail only on wide+calm mornings."""
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
    base_cap: float = 1000.0,
    loss_streak: int = 2,
    post: Callable | None = None,
) -> dict[str, Any]:
    post_witch = post or trail_wide_calm_else_2r
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
            arm, mode = post_witch(f), "trail_wide_calm"
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
        "recipe": "beast@3k→trail_wide_calm + streak2→edge · day_cap₹1000",
    }
