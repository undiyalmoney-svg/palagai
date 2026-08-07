#!/usr/bin/env python3
"""
₹40k capital plan hunt — target ~₹2k/day (₹40k → ₹60k in ~10 sessions).

Uses Kite cache. Index proxy ₹ = pts × 65/30; Crude ₹10/pt.
Long-option capital model: concurrent premium budget ≤ 60% of capital
(ATM premium proxies). Lots auto-capped to what ₹40k can hold.

  python3 scripts/capital-40k-2k-day-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

CAPITAL = 40_000
PREMIUM_BUDGET_FRAC = 0.60
# Conservative ATM premium proxies (₹ per lot) for capital sizing
ATM_PREMIUM_RS = dict(nifty=10_000, bank=12_000, crude=1_500)
OOS = "2025-01-01"
RECENT = "2026-06-01"
TARGET_DAY = 2_000
TEN_DAY_GOAL = 20_000


def day_map(trades: list[dict], lot_mult: float = 1.0) -> dict[str, float]:
    by: dict[str, float] = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"] * lot_mult
    return dict(by)


def merge_days(*maps: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for m in maps:
        for d, v in m.items():
            out[d] += v
    return dict(out)


def apply_day_lock(nets: list[float], lock: float) -> list[float]:
    if lock <= 0:
        return nets
    return [min(x, lock) if x > 0 else x for x in nets]


def stats(nets: list[float], label: str, meta: dict) -> dict:
    if not nets:
        return dict(label=label, days=0, **meta)
    arr = sorted(nets)
    n = len(arr)
    p10 = arr[max(0, int(0.10 * n) - 1)]
    rolling10 = []
    for i in range(len(nets) - 9):
        rolling10.append(sum(nets[i : i + 10]))
    hit10 = sum(1 for x in rolling10 if x >= TEN_DAY_GOAL) / max(1, len(rolling10)) * 100
    return dict(
        label=label,
        days=n,
        avg=round(sum(arr) / n, 1),
        med=round(arr[n // 2], 1),
        green=round(sum(1 for x in arr if x > 0) / n * 100, 1),
        ge1k=round(sum(1 for x in arr if x >= 1000) / n * 100, 1),
        ge2k=round(sum(1 for x in arr if x >= TARGET_DAY) / n * 100, 1),
        ge3k=round(sum(1 for x in arr if x >= 3000) / n * 100, 1),
        p10=round(p10, 1),
        worst=round(min(arr), 1),
        best=round(max(arr), 1),
        zeroish=round(sum(1 for x in arr if abs(x) < 1) / n * 100, 1),
        roll10_hit_20k_pct=round(hit10, 1),
        roll10_avg=round(sum(rolling10) / max(1, len(rolling10)), 1) if rolling10 else 0,
        max_roll10=round(max(rolling10), 1) if rolling10 else 0,
        **meta,
    )


def auto_lots(capital: int = CAPITAL) -> dict[str, int]:
    """Pick max 1/1/1-style lots that fit premium budget."""
    budget = capital * PREMIUM_BUDGET_FRAC
    # Prefer all three books at 1 lot when possible; otherwise drop Crude then Bank.
    for books in (
        dict(nifty=1, bank=1, crude=1),
        dict(nifty=1, bank=1, crude=0),
        dict(nifty=1, bank=0, crude=1),
        dict(nifty=1, bank=0, crude=0),
        dict(nifty=0, bank=1, crude=0),
    ):
        cost = (
            books["nifty"] * ATM_PREMIUM_RS["nifty"]
            + books["bank"] * ATM_PREMIUM_RS["bank"]
            + books["crude"] * ATM_PREMIUM_RS["crude"]
        )
        if cost <= budget:
            return books
    return dict(nifty=1, bank=0, crude=0)


def main() -> None:
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude = uh.load(uh.CACHE / "crudeoilm-5m-merged.json", 10)
    lots = auto_lots()
    budget = CAPITAL * PREMIUM_BUDGET_FRAC
    lot_cost = (
        lots["nifty"] * ATM_PREMIUM_RS["nifty"]
        + lots["bank"] * ATM_PREMIUM_RS["bank"]
        + lots["crude"] * ATM_PREMIUM_RS["crude"]
    )

    # Curated DNA — live-safe, 1-lot hunt winners, monster green, high RR
    trap_books = [
        (
            "live-safe peak400 pierce15/30 bounce softOFF rr2",
            dict(
                pierce=15,
                peak_arm=400,
                peak_lock=200,
                peak_gb=200,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                mode="both",
                max_trades=0,
                day_stop=80,
            ),
            dict(bank_pierce=30),
        ),
        (
            "doc43 pierce10 peak150 softOFF rr2",
            dict(
                pierce=10,
                peak_arm=150,
                peak_lock=75,
                peak_gb=75,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                mode="both",
                max_trades=0,
                day_stop=80,
            ),
            dict(bank_pierce=10),
        ),
        (
            "monster pierce15 peak150 max2 softOFF rr2",
            dict(
                pierce=15,
                peak_arm=150,
                peak_lock=75,
                peak_gb=75,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                mode="both",
                max_trades=2,
                day_stop=40,
            ),
            dict(bank_pierce=30),
        ),
        (
            "max-earn pierce3 bounce rr3.5",
            dict(
                pierce=3,
                peak_arm=400,
                peak_lock=200,
                peak_gb=200,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=3.5,
                mode="both",
                max_trades=3,
                day_stop=80,
            ),
            dict(bank_pierce=3),
        ),
        (
            "smooth pierce3 bounce rr2 max3",
            dict(
                pierce=3,
                peak_arm=400,
                peak_lock=200,
                peak_gb=200,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                mode="both",
                max_trades=3,
                day_stop=80,
            ),
            dict(bank_pierce=3),
        ),
        (
            "pierce8 peak200 softOFF rr2.5",
            dict(
                pierce=8,
                peak_arm=200,
                peak_lock=100,
                peak_gb=100,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.5,
                mode="both",
                max_trades=0,
                day_stop=80,
            ),
            dict(bank_pierce=8),
        ),
        (
            "pierce12 peak150 softOFF rr2",
            dict(
                pierce=12,
                peak_arm=150,
                peak_lock=75,
                peak_gb=75,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                mode="both",
                max_trades=0,
                day_stop=80,
            ),
            dict(bank_pierce=12),
        ),
    ]

    rows = []
    for label, params, extra in trap_books:
        n_params = dict(params)
        b_params = dict(params)
        b_params["pierce"] = extra.get("bank_pierce", params["pierce"])
        b_params["min_risk"] = 8
        b_params["max_risk"] = 50
        n_tr = uh.sim_trap(nifty, **n_params) if lots["nifty"] else []
        b_tr = uh.sim_trap(bank, **b_params) if lots["bank"] else []
        n_map = day_map(n_tr, lots["nifty"])
        b_map = day_map(b_tr, lots["bank"])

        # Crude Selective overlay (futures proxy + ₹50/RT in sim_crude).
        c_map: dict[str, float] = {}
        crude_label = "none"
        if lots["crude"]:
            c_tr = uh.sim_crude(
                crude,
                sl=50,
                tp=200,
                max_or=10_000,  # no OR-width skip (Selective live DNA)
                entry_s=10 * 60,
                entry_e=23 * 60,
                max_day=4,
                day_loss=10_000,
                confirm=True,
                first_win=False,
                rs=10.0,
            )
            # Soft day lock ~₹1k on Crude book (cap late drains after a solid win).
            by_c: dict[str, float] = defaultdict(float)
            for t in c_tr:
                d = t["day"]
                if by_c[d] >= 1000:
                    continue
                by_c[d] = min(1000.0, by_c[d] + t["rs"] * lots["crude"])
            c_map = dict(by_c)
            crude_label = "SL50/TP200 max4 lock1k"

        merged = merge_days(n_map, b_map, c_map)
        # Align to OOS index days that have either book
        days = sorted(d for d in merged if d >= OOS)
        nets = [merged[d] for d in days]
        locked = apply_day_lock(nets, 3000)
        recent_days = [d for d in days if d >= RECENT]
        recent_nets = [merged[d] for d in recent_days]
        recent_locked = apply_day_lock(recent_nets, 3000)

        base = stats(
            nets,
            label,
            dict(
                lots=lots,
                crude=crude_label,
                day_lock=0,
                window="OOS>=2025",
            ),
        )
        lock = stats(
            locked,
            label + " +lock3k",
            dict(lots=lots, crude=crude_label, day_lock=3000, window="OOS>=2025"),
        )
        recent = stats(
            recent_locked if recent_locked else recent_nets,
            label + " recent+lock3k",
            dict(lots=lots, crude=crude_label, day_lock=3000, window=">=2026-06"),
        )
        rows.extend([base, lock, recent])
        print(
            f"{label:48} avg={base['avg']:8} ge2k={base['ge2k']:5}% green={base['green']:5}% "
            f"worst={base['worst']:8} roll10_hit20k={base['roll10_hit_20k_pct']:5}%",
            flush=True,
        )

    # Rank for the objective: high ge2k, then green, then avg, punish terrible worst
    def score(r: dict) -> tuple:
        if r["days"] < 20:
            return (-1, 0, 0, 0)
        return (
            r.get("ge2k", 0),
            r.get("green", 0),
            r.get("roll10_hit_20k_pct", 0),
            r.get("avg", 0),
            -abs(min(0, r.get("worst", 0))),
        )

    ranked = sorted(rows, key=score, reverse=True)
    winners = [r for r in ranked if r["window"] == "OOS>=2025" and "lock3k" in r["label"]][:8]
    recent_winners = [r for r in ranked if r["window"] == ">=2026-06"][:5]

    summary = dict(
        capital=CAPITAL,
        premium_budget=budget,
        auto_lots=lots,
        lot_premium_cost=lot_cost,
        target_day_rs=TARGET_DAY,
        ten_day_goal_rs=TEN_DAY_GOAL,
        note=(
            "Index proxy ₹ (pts×lot). Live option fills + charges are lower. "
            "No DNA is zero-loss; hunt maximizes ≥₹2k hit-rate and 10-day +₹20k odds."
        ),
        top_oos_lock3k=winners,
        top_recent=recent_winners,
        all=rows,
    )
    out = OUT / "capital-40k-2k-day-hunt.json"
    out.write_text(json.dumps(summary, indent=2))
    print("\n=== AUTO LOTS FOR ₹40k ===", lots, f"premium~₹{lot_cost:.0f} / budget₹{budget:.0f}")
    print("\n=== TOP OOS (+day lock ₹3k) ===")
    for r in winners:
        print(
            f"{r['label'][:60]:60} avg={r['avg']} ge2k={r['ge2k']}% green={r['green']}% "
            f"p10={r['p10']} worst={r['worst']} roll10_hit20k={r['roll10_hit_20k_pct']}%"
        )
    print("\n=== TOP RECENT (>=2026-06, lock3k) ===")
    for r in recent_winners:
        print(
            f"{r['label'][:60]:60} avg={r['avg']} ge2k={r['ge2k']}% green={r['green']}% "
            f"p10={r['p10']} worst={r['worst']} roll10_hit20k={r['roll10_hit_20k_pct']}%"
        )
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
