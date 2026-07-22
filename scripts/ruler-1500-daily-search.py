#!/usr/bin/env python3
"""
Walk-forward search for a causal 1-lot Ruler averaging ₹1,500/session.

The user's full target is deliberately strict:
  - average research-book P&L >= ₹1,500 per market session
  - no more than 3 red sessions in any month
  - Nifty ₹65/pt + Bank ₹30/pt, one lot

Selection uses 2020-2023 train and 2024-2025 validation. 2026 is reported
only after selection. Morning gates use information available by 09:45.

Important: ARM books are end-of-day trade replays and the loss cap is applied
to the completed daily book. Any winner must still pass the slower Angular
intraday flatten replay before deployment.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = Path("/tmp/ruler-1500-daily-search/report.json")
BOOST_PATH = Path("/tmp/ruler-profit-boost.py")

WINDOWS = {
    "train_2020_2023": ("2020-01-01", "2023-12-31"),
    "validation_2024_2025": ("2024-01-01", "2025-12-31"),
    "test_2026": ("2026-01-01", "2026-12-31"),
}
ARMS = ("DONCH_TRAIL", "DONCH_2R", "DONCH_15R", "SWING_2R", "OR_RETEST_2R")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def full_day_pnl(dates, rupees):
    out: dict[str, float] = defaultdict(float)
    for day, value in zip(dates, rupees):
        out[day] += float(value)
    return dict(out)


@dataclass(frozen=True)
class Gate:
    width: str
    min_drive: float
    max_gap: float
    require_trend: bool
    require_calm: bool

    def accepts(self, feature: dict[str, Any] | None) -> bool:
        if feature is None or feature["choppy"]:
            return False
        if self.width == "wide" and not feature["wide"]:
            return False
        if self.width == "vwide" and not feature["vwide"]:
            return False
        if float(feature["drive"]) < self.min_drive:
            return False
        if float(feature["gap"]) > self.max_gap:
            return False
        if self.require_trend and not (feature["ema_buy"] or feature["ema_sell"]):
            return False
        if self.require_calm and not feature["calm"]:
            return False
        return True


@dataclass(frozen=True)
class Policy:
    gate: Gate
    arm: str
    cap: float
    cap_mode: str
    monthly_red_lock: int

    def key(self) -> str:
        trend = "trend" if self.gate.require_trend else "anytrend"
        calm = "calm" if self.gate.require_calm else "anygapregime"
        gap = "inf" if self.gate.max_gap >= 99 else f"{self.gate.max_gap:g}"
        return (
            f"{self.arm}__{self.gate.width}_drive{self.gate.min_drive:g}"
            f"_gap{gap}_{trend}_{calm}__{self.cap_mode}_cap{self.cap:g}"
            f"__redlock{self.monthly_red_lock}"
        )


def clipped(raw: float, cap: float) -> float:
    return max(float(raw), -float(cap))


def summarize(days: list[str], values: list[float]) -> dict[str, Any]:
    if not days:
        return {}
    by_month: dict[str, list[float]] = defaultdict(list)
    for day, value in zip(days, values):
        by_month[day[:7]].append(float(value))
    monthly = {month: sum(rows) for month, rows in sorted(by_month.items())}
    red_counts = {month: sum(value < 0 for value in rows) for month, rows in by_month.items()}
    traded = [value for value in values if value != 0]
    return {
        "sessions": len(days),
        "traded_sessions": len(traded),
        "net": round(sum(values), 1),
        "avg_per_session": round(sum(values) / len(days), 1),
        "avg_per_traded_session": round(sum(traded) / len(traded), 1) if traded else 0.0,
        "red_sessions": sum(value < 0 for value in values),
        "avg_red_sessions_per_month": round(sum(red_counts.values()) / len(red_counts), 2),
        "max_red_sessions_in_month": max(red_counts.values()),
        "red_months": sum(value < 0 for value in monthly.values()),
        "worst_month": round(min(monthly.values()), 1),
        "best_month": round(max(monthly.values()), 1),
        "monthly": {month: round(value, 1) for month, value in monthly.items()},
        "red_sessions_by_month": dict(sorted(red_counts.items())),
    }


def run_policy(
    policy: Policy,
    days: list[str],
    features: dict[str, dict[str, Any] | None],
    books: dict[str, dict[str, dict[str, float]]],
    comb: Callable,
) -> list[float]:
    values: list[float] = []
    current_month = ""
    mtd = 0.0
    red_sessions = 0
    for day in days:
        month = day[:7]
        if month != current_month:
            current_month = month
            mtd = 0.0
            red_sessions = 0
        if red_sessions >= policy.monthly_red_lock or not policy.gate.accepts(features.get(day)):
            value = 0.0
        else:
            raw = float(comb(books, policy.arm, day))
            cap = policy.cap
            if policy.cap_mode == "dyn0" and mtd > 0:
                cap = min(cap, mtd)
            value = clipped(raw, cap)
        values.append(value)
        if value < 0:
            red_sessions += 1
        mtd += value
    return values


def current_ruler(
    days: list[str],
    books,
    features,
    boost,
    sep,
) -> dict[str, Any]:
    result = sep.run_sep_boost(
        books,
        features,
        days,
        comb=boost.comb,
        clip=boost.clip,
        beast=boost.beast,
        edge=boost.edge,
    )
    values = [float(row["clipped"]) for row in result["picks"]]
    return summarize(days, values)


def policy_payload(policy: Policy, metrics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": policy.key(),
        "policy": {
            "gate": asdict(policy.gate),
            "arm": policy.arm,
            "cap": policy.cap,
            "cap_mode": policy.cap_mode,
            "monthly_red_lock": policy.monthly_red_lock,
        },
        "windows": metrics,
    }


def meets_target(metrics: dict[str, Any]) -> bool:
    return (
        metrics["avg_per_session"] >= 1500
        and metrics["max_red_sessions_in_month"] <= 3
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    out_path = Path(args.json)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not BOOST_PATH.exists():
        raise SystemExit(f"Missing shared Ruler research helper: {BOOST_PATH}")

    uni = load_module("ruler1500_uni", ROOT / "scripts/strategy-universe-search.py")
    load_module("ruler1500_sr", ROOT / "scripts/sr-pullback-retest-daily500.py")
    boost = load_module("ruler1500_boost", BOOST_PATH)
    sep = load_module("ruler1500_sep", ROOT / "scripts/ruler-sep-boost.py")
    boost.day_pnl = full_day_pnl
    boost.OOS = "1900-01-01"

    print("Loading 5m cache and building one-lot ARM books…", flush=True)
    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = boost.build(nifty, bank)
    all_days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    features = {
        day: (
            boost.morning_feat(nifty, day) if day in nifty.day_starts else None
        )
        or (boost.morning_feat(bank, day) if day in bank.day_starts else None)
        for day in all_days
    }
    window_days = {
        name: [day for day in all_days if start <= day <= end]
        for name, (start, end) in WINDOWS.items()
    }

    print("Scoring current Ruler baseline…", flush=True)
    baseline = {
        name: current_ruler(days, books, features, boost, sep)
        for name, days in window_days.items()
    }

    gates = [
        Gate(width, drive, gap, trend, calm)
        for width in ("any", "wide", "vwide")
        for drive in (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7)
        for gap in (0.75, 1.0, 1.5, 2.5, 99.0)
        for trend in (False, True)
        for calm in (False, True)
    ]
    policies = [
        Policy(gate, arm, cap, cap_mode, red_lock)
        for gate in gates
        for arm in ARMS
        for cap in (500.0, 1000.0, 1500.0)
        for cap_mode in ("fixed", "dyn0")
        for red_lock in (3, 99)
    ]
    print(f"Searching {len(policies):,} causal policies…", flush=True)

    evaluated: list[tuple[Policy, dict[str, dict[str, Any]]]] = []
    for index, policy in enumerate(policies, start=1):
        metrics = {
            name: summarize(days, run_policy(policy, days, features, books, boost.comb))
            for name, days in window_days.items()
        }
        evaluated.append((policy, metrics))
        if index % 10000 == 0:
            print(f"  {index:,}/{len(policies):,}", flush=True)

    train_name = "train_2020_2023"
    validation_name = "validation_2024_2025"
    test_name = "test_2026"
    stable_joint = [
        row
        for row in evaluated
        if meets_target(row[1][train_name]) and meets_target(row[1][validation_name])
    ]
    stable_average = [
        row
        for row in evaluated
        if row[1][train_name]["avg_per_session"] >= 1500
        and row[1][validation_name]["avg_per_session"] >= 1500
    ]
    constrained = [
        row
        for row in evaluated
        if row[1][train_name]["max_red_sessions_in_month"] <= 3
        and row[1][validation_name]["max_red_sessions_in_month"] <= 3
    ]

    stable_joint.sort(
        key=lambda row: (
            row[1][validation_name]["avg_per_session"],
            row[1][train_name]["avg_per_session"],
        ),
        reverse=True,
    )
    stable_average.sort(
        key=lambda row: (
            row[1][validation_name]["avg_per_session"],
            -row[1][validation_name]["max_red_sessions_in_month"],
        ),
        reverse=True,
    )
    constrained.sort(
        key=lambda row: (
            row[1][validation_name]["avg_per_session"],
            row[1][train_name]["avg_per_session"],
        ),
        reverse=True,
    )

    # Look-ahead only: proves the books contain enough payout, not that it is predictable.
    oracle: dict[str, Any] = {}
    for name, days in window_days.items():
        values = [
            max(0.0, *(float(boost.comb(books, arm, day)) for arm in ARMS))
            for day in days
        ]
        oracle[name] = summarize(days, values)

    report = {
        "goal": {
            "lots": 1,
            "average_per_market_session": 1500,
            "max_red_sessions_in_any_month": 3,
            "money_model": "Nifty ₹65/pt + Bank ₹30/pt",
        },
        "method": {
            "selection": "2020-2023 train + 2024-2025 validation",
            "untouched_test": "2026-01-01 through cache end 2026-07-21",
            "causal_features": "09:45 width/drive/gap/EMA/calm/choppy",
            "policies_searched": len(policies),
            "warning": (
                "Daily ARM-book caps are soft end-of-day clips. A candidate must pass "
                "Angular intraday hard-flatten replay before deployment."
            ),
        },
        "current_ruler": baseline,
        "joint_target_hits_train_and_validation": len(stable_joint),
        "joint_target_hits": [
            policy_payload(policy, metrics) for policy, metrics in stable_joint[:20]
        ],
        "best_with_red_session_constraint": [
            policy_payload(policy, metrics) for policy, metrics in constrained[:20]
        ],
        "best_stable_average_candidates": [
            policy_payload(policy, metrics) for policy, metrics in stable_average[:20]
        ],
        "lookahead_oracle_not_deployable": oracle,
        "verdict": (
            "FOUND — candidate still needs Angular hard-flatten replay"
            if stable_joint
            else (
                "NO_GO — no causal policy reached ₹1,500/session while limiting every "
                "month to at most 3 red sessions on both train and validation"
            )
        ),
    }
    out_path.write_text(json.dumps(report, indent=2))

    print("\n" + report["verdict"])
    print(f"Joint hits: {len(stable_joint):,}/{len(policies):,}")
    if constrained:
        best_policy, best_metrics = constrained[0]
        print(f"Best <=3-red policy: {best_policy.key()}")
        for name in WINDOWS:
            row = best_metrics[name]
            print(
                f"  {name}: avg ₹{row['avg_per_session']:,.0f} · "
                f"max red/month {row['max_red_sessions_in_month']} · "
                f"net ₹{row['net']:,.0f}"
            )
    if stable_average:
        best_policy, best_metrics = stable_average[0]
        print(f"Best stable >=₹1,500 policy: {best_policy.key()}")
        for name in WINDOWS:
            row = best_metrics[name]
            print(
                f"  {name}: avg ₹{row['avg_per_session']:,.0f} · "
                f"avg/max red per month {row['avg_red_sessions_per_month']}/"
                f"{row['max_red_sessions_in_month']}"
            )
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
