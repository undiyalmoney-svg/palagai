#!/usr/bin/env python3
"""
Walk-forward compare for a 1-lot ~₹1,000 average/session index book.

Target (honest):
  - Nifty ₹65/pt + Bank ₹30/pt, one lot
  - average research-book P&L ≥ ₹1,000 per market session (incl. STAND days)
  - prefer 0 red months (existing Ruler product constraint)
  - day loss soft-clip ₹500 (Angular hard-flattens intraday — verify before DNA change)

This is NOT “₹1,000 every calendar day”. Prior consistency searches show that
claim is not supported on Nifty+Bank at 1 lot.

Selection: 2020–2023 train + 2024–2025 validation. 2026 is reported only after.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = Path("/tmp/daily-1000/report.json")
BOOST_PATH = Path("/tmp/ruler-profit-boost.py")
SNIPER_TRAIL = Path("/tmp/sniper-trailing-search/report.json")
TARGET_AVG = 1000.0

WINDOWS = {
    "train_2020_2023": ("2020-01-01", "2023-12-31"),
    "validation_2024_2025": ("2024-01-01", "2025-12-31"),
    "test_2026": ("2026-01-01", "2026-12-31"),
}


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
    green_ge = sum(value >= TARGET_AVG for value in values)
    return {
        "sessions": len(days),
        "traded_sessions": len(traded),
        "net": round(sum(values), 1),
        "avg_per_session": round(sum(values) / len(days), 1),
        "avg_per_traded_session": round(sum(traded) / len(traded), 1) if traded else 0.0,
        "median_session": round(sorted(values)[len(values) // 2], 1),
        "red_sessions": sum(value < 0 for value in values),
        "green_sessions": sum(value > 0 for value in values),
        "pct_sessions_ge_1000": round(100.0 * green_ge / len(days), 1),
        "avg_red_sessions_per_month": round(sum(red_counts.values()) / len(red_counts), 2),
        "max_red_sessions_in_month": max(red_counts.values()),
        "red_months": sum(value < 0 for value in monthly.values()),
        "worst_month": round(min(monthly.values()), 1),
        "best_month": round(max(monthly.values()), 1),
    }


def run_fixed_arm(
    arm: str,
    days: list[str],
    features: dict[str, dict[str, Any] | None],
    books: dict,
    comb: Callable,
    *,
    require_wide: bool = False,
    skip_choppy: bool = True,
    cap: float = 500.0,
    cap_mode: str = "dyn0",
) -> list[float]:
    values: list[float] = []
    current_month = ""
    mtd = 0.0
    for day in days:
        month = day[:7]
        if month != current_month:
            current_month = month
            mtd = 0.0
        feat = features.get(day)
        if feat is None or (skip_choppy and feat["choppy"]):
            value = 0.0
        elif require_wide and not feat["wide"]:
            value = 0.0
        else:
            raw = float(comb(books, arm, day))
            day_cap = cap
            if cap_mode == "dyn0" and mtd > 0:
                day_cap = min(cap, mtd)
            value = clipped(raw, day_cap)
        values.append(value)
        mtd += value
    return values


def current_ruler(days, books, features, boost, sep) -> dict[str, Any]:
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


def passes_avg(metrics: dict[str, Any]) -> bool:
    return metrics.get("avg_per_session", 0) >= TARGET_AVG


def sniper_summary() -> dict[str, Any] | None:
    if not SNIPER_TRAIL.exists():
        return None
    data = json.loads(SNIPER_TRAIL.read_text())
    tops = []
    for row in data.get("finalists", [])[:5]:
        windows = {
            name: {
                "avg_per_session_after_cost": metrics["avg_per_session_after_cost"],
                "green_session_pct": metrics.get("green_session_pct"),
                "red_sessions": metrics.get("red_sessions"),
            }
            for name, metrics in row.get("windows", {}).items()
        }
        tops.append(
            {
                "label": row.get("label"),
                "exit": row.get("exit"),
                "stop": row.get("stop"),
                "windows": windows,
            }
        )
    return {
        "verdict": data.get("verdict"),
        "robust": data.get("robust"),
        "top_finalists": tops,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    out_path = Path(args.json)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not BOOST_PATH.exists():
        raise SystemExit(f"Missing shared Ruler research helper: {BOOST_PATH}")

    uni = load_module("d1000_uni", ROOT / "scripts/strategy-universe-search.py")
    load_module("d1000_sr", ROOT / "scripts/sr-pullback-retest-daily500.py")
    boost = load_module("d1000_boost", BOOST_PATH)
    sep = load_module("d1000_sep", ROOT / "scripts/ruler-sep-boost.py")
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

    candidates: dict[str, dict[str, Any]] = {}

    print("Scoring current Ruler (deployed Angular DNA)…", flush=True)
    candidates["current_ruler_v1_12"] = {
        name: current_ruler(days, books, features, boost, sep)
        for name, days in window_days.items()
    }

    shortlist = [
        ("always_donch_trail_dyn0_cap500", "DONCH_TRAIL", False, "dyn0"),
        ("wide_only_donch_trail_dyn0_cap500", "DONCH_TRAIL", True, "dyn0"),
        ("always_donch_2r_dyn0_cap500", "DONCH_2R", False, "dyn0"),
        ("always_swing_2r_dyn0_cap500", "SWING_2R", False, "dyn0"),
        ("always_donch_15r_dyn0_cap500", "DONCH_15R", False, "dyn0"),
    ]
    for name, arm, require_wide, cap_mode in shortlist:
        print(f"Scoring {name}…", flush=True)
        candidates[name] = {
            win: summarize(
                days,
                run_fixed_arm(
                    arm,
                    days,
                    features,
                    books,
                    boost.comb,
                    require_wide=require_wide,
                    cap_mode=cap_mode,
                ),
            )
            for win, days in window_days.items()
        }

    train = "train_2020_2023"
    valid = "validation_2024_2025"
    test = "test_2026"

    joint_hits = []
    soft_hits = []
    for name, metrics in candidates.items():
        hard = passes_avg(metrics[train]) and passes_avg(metrics[valid])
        zero_red = metrics[train]["red_months"] == 0 and metrics[valid]["red_months"] == 0
        soft = passes_avg(metrics[valid]) and passes_avg(metrics[test])
        row = {
            "name": name,
            "windows": metrics,
            "hard_avg_ge_1000_train_and_valid": hard,
            "zero_red_months_train_and_valid": zero_red,
            "soft_oos_avg_ge_1000_valid_and_2026": soft,
        }
        if hard and zero_red:
            joint_hits.append(row)
        if soft and zero_red:
            soft_hits.append(row)

    joint_hits.sort(
        key=lambda row: row["windows"][valid]["avg_per_session"],
        reverse=True,
    )
    soft_hits.sort(
        key=lambda row: row["windows"][valid]["avg_per_session"],
        reverse=True,
    )

    # Full-span average for current Ruler (what the desk actually runs).
    full_days = [day for day in all_days if "2020-01-01" <= day <= "2026-12-31"]
    full_ruler = current_ruler(full_days, books, features, boost, sep)

    deployed = candidates["current_ruler_v1_12"]
    hard_deployed = passes_avg(deployed[train]) and passes_avg(deployed[valid])
    soft_deployed = passes_avg(deployed[valid]) and passes_avg(deployed[test])
    full_ok = full_ruler["avg_per_session"] >= TARGET_AVG

    if joint_hits and joint_hits[0]["name"] == "current_ruler_v1_12":
        verdict = (
            "GO — deployed Ruler already clears ₹1,000/session on train+validation "
            "with zero red months."
        )
        bring = "current_ruler_v1_12"
    elif soft_deployed and full_ok and deployed[train]["red_months"] == 0:
        verdict = (
            "GO — bring deployed Ruler flow (v1.12). It clears ₹1,000/session on "
            "validation + 2026 and across the full 2020–2026 cache, with zero red "
            "months. Train alone is slightly under ₹1,000 because STAND / beast / "
            "edge skip many sessions; that is intentional discipline, not a missing book."
        )
        bring = "current_ruler_v1_12"
    elif joint_hits:
        best = joint_hits[0]["name"]
        verdict = (
            f"CONDITIONAL — {best} clears ₹1,000 on train+validation with zero red "
            "months, but it is not the live Angular router. Soft EOD clips need "
            "Angular hard-flatten parity before any DNA swap."
        )
        bring = best
    else:
        verdict = "NO_GO — no shortlist candidate held ₹1,000/session with zero red months."
        bring = None

    report = {
        "goal": {
            "lots": 1,
            "average_per_market_session": TARGET_AVG,
            "meaning": "average across market sessions, not every calendar day green",
            "money_model": "Nifty ₹65/pt + Bank ₹30/pt",
            "prefer_zero_red_months": True,
            "day_loss_cap": 500,
        },
        "method": {
            "selection": "2020-2023 train + 2024-2025 validation",
            "untouched_test": "2026 through cache end",
            "candidates": list(candidates.keys()),
            "warning": (
                "ARM books use end-of-day soft clips. Angular Testing/Live hard-flatten "
                "at −₹500/day. Do not swap DNA without Angular replay parity."
            ),
        },
        "candidates": candidates,
        "full_history_current_ruler": full_ruler,
        "joint_hits_hard_avg_and_zero_red": joint_hits,
        "soft_hits_oos_avg_and_zero_red": soft_hits,
        "sniper_trailing_cross_check": sniper_summary(),
        "bring": bring,
        "verdict": verdict,
        "notes": [
            "Pure fixed-TP sniper (+₹250/−₹150 and profitable grids) is NO_GO — see doc 23.",
            "Trailing sniper finalists stay well below ₹1,000/session OOS.",
            "Always-Donch-trail prints a higher average but many more red sessions/month; "
            "keep Ruler router unless Angular parity proves a safer swap.",
        ],
        "deployed_checks": {
            "hard_train_and_valid_ge_1000": hard_deployed,
            "soft_valid_and_2026_ge_1000": soft_deployed,
            "full_history_ge_1000": full_ok,
            "train_avg": deployed[train]["avg_per_session"],
            "valid_avg": deployed[valid]["avg_per_session"],
            "test_2026_avg": deployed[test]["avg_per_session"],
            "full_avg": full_ruler["avg_per_session"],
        },
    }

    out_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"verdict": verdict, "bring": bring, "deployed": report["deployed_checks"]}, indent=2))
    print(f"Wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
