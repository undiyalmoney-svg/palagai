#!/usr/bin/env python3
"""
Train a pure one-lot Sniper (no Ruler router) for ₹1,000-₹2,500/day average.

Search dimensions:
  - six causal entry families and three direction biases
  - fixed winner ₹400/₹500/₹650/₹800
  - small fixed loser ₹100/₹150/₹200
  - max 10 combined Nifty+Bank trades
  - day profit lock ₹1,000/₹1,500/₹2,500
  - day loss lock ₹300/₹450/₹600
  - ₹25/trade selection cost, ₹50/trade stress

Selection uses 2020-2023, validation uses 2024-2025, and 2026 is untouched.
The conservative 5m same-bar rule always gives the stop priority.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = ROOT / "scripts" / "sniper-250-search.py"
DEFAULT_OUT = Path("/tmp/sniper-profitable-search/report.json")

TARGETS = (400.0, 500.0, 650.0, 800.0)
STOPS = (100.0, 150.0, 200.0)
PROFIT_LOCKS = (1000.0, 1500.0, 2500.0)
LOSS_LOCKS = (300.0, 450.0, 600.0)
SELECTION_COST = 25.0


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def search_specs(sniper) -> list[Any]:
    return [
        sniper.SniperSpec(entry, bias, earliest, latest, width, drive, gap)
        for entry in (
            "donch_retest",
            "or_retest",
            "pdhl_retest",
            "ema_pullback",
            "inside_break",
            "momentum2",
        )
        for bias in ("or_mid", "or_direction", "ema50")
        for earliest, latest in (("09:45", "15:00"), ("10:15", "15:00"))
        for width, drive, gap in (
            ("any", 0.0, 99.0),
            ("wide", 0.35, 2.5),
            ("vwide", 0.5, 2.5),
        )
    ]


def score(metrics: dict[str, Any]) -> tuple[float, float, float]:
    return (
        metrics["avg_per_session_after_cost"],
        metrics["green_session_pct"],
        -metrics["red_sessions"],
    )


def best_risk(
    sniper,
    trades,
    sessions,
    window,
    cost: float,
) -> tuple[dict[str, float], dict[str, Any]]:
    candidates = []
    for profit_lock in PROFIT_LOCKS:
        for loss_lock in LOSS_LOCKS:
            metrics = sniper.combine_days(
                trades,
                sessions,
                *window,
                cost_per_trade=cost,
                day_profit_target=profit_lock,
                day_loss_limit=loss_lock,
            )
            candidates.append(
                (
                    {"day_profit_lock": profit_lock, "day_loss_lock": loss_lock},
                    metrics,
                )
            )
    return max(candidates, key=lambda row: score(row[1]))


def evaluate(
    sniper,
    trades,
    sessions,
    window,
    risk: dict[str, float],
    cost: float,
    optimistic: bool = False,
) -> dict[str, Any]:
    return sniper.combine_days(
        trades,
        sessions,
        *window,
        cost_per_trade=cost,
        ambiguous_target_first=optimistic,
        day_profit_target=risk["day_profit_lock"],
        day_loss_limit=risk["day_loss_lock"],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    output = Path(args.json)
    output.parent.mkdir(parents=True, exist_ok=True)

    sniper = load_module("sniper_profitable_base", BASE_PATH)
    uni = load_module(
        "sniper_profitable_uni", ROOT / "scripts" / "strategy-universe-search.py"
    )
    print("Loading 5m caches…", flush=True)
    nifty = uni.load_inst(sniper.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(
        sniper.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30
    )
    all_sessions = sorted(set(nifty.day_starts) | set(bank.day_starts))
    window_sessions = {
        name: [day for day in all_sessions if start <= day <= end]
        for name, (start, end) in sniper.WINDOWS.items()
    }

    specs = search_specs(sniper)
    total = len(specs) * len(TARGETS) * len(STOPS)
    print(f"Searching {total:,} Sniper target/stop/entry systems…", flush=True)
    train_leaders: list[dict[str, Any]] = []
    completed = 0
    for target in TARGETS:
        for stop in STOPS:
            sniper.TARGET_RS = target
            sniper.STOP_RS = stop
            for spec in specs:
                completed += 1
                trades = sniper.simulate_instrument(
                    nifty, spec
                ) + sniper.simulate_instrument(bank, spec)
                risk, train = best_risk(
                    sniper,
                    trades,
                    window_sessions["train_2020_2023"],
                    sniper.WINDOWS["train_2020_2023"],
                    SELECTION_COST,
                )
                if train["trades"] >= 200:
                    train_leaders.append(
                        {
                            "spec": spec,
                            "target": target,
                            "stop": stop,
                            "risk": risk,
                            "train": train,
                            "trades_data": trades,
                        }
                    )
                    train_leaders.sort(key=lambda row: score(row["train"]), reverse=True)
                    if len(train_leaders) > 200:
                        train_leaders = train_leaders[:150]
                if completed % 200 == 0:
                    leader = (
                        train_leaders[0]["train"]["avg_per_session_after_cost"]
                        if train_leaders
                        else 0
                    )
                    print(f"  {completed:,}/{total:,} · train leader ₹{leader:,.0f}/day", flush=True)

    validation_rows = []
    for row in train_leaders:
        sniper.TARGET_RS = row["target"]
        sniper.STOP_RS = row["stop"]
        validation = evaluate(
            sniper,
            row["trades_data"],
            window_sessions["validation_2024_2025"],
            sniper.WINDOWS["validation_2024_2025"],
            row["risk"],
            SELECTION_COST,
        )
        validation_rows.append({**row, "validation": validation})
    validation_rows.sort(key=lambda row: score(row["validation"]), reverse=True)

    finalists = []
    for row in validation_rows[:20]:
        sniper.TARGET_RS = row["target"]
        sniper.STOP_RS = row["stop"]
        test = evaluate(
            sniper,
            row["trades_data"],
            window_sessions["test_2026"],
            sniper.WINDOWS["test_2026"],
            row["risk"],
            SELECTION_COST,
        )
        stressed = {
            name: evaluate(
                sniper,
                row["trades_data"],
                window_sessions[name],
                sniper.WINDOWS[name],
                row["risk"],
                50.0,
            )
            for name in sniper.WINDOWS
        }
        optimistic = {
            name: evaluate(
                sniper,
                row["trades_data"],
                window_sessions[name],
                sniper.WINDOWS[name],
                row["risk"],
                SELECTION_COST,
                optimistic=True,
            )
            for name in sniper.WINDOWS
        }
        finalists.append(
            {
                "label": (
                    f"{row['spec'].label()}_tp{int(row['target'])}_"
                    f"sl{int(row['stop'])}_pl{int(row['risk']['day_profit_lock'])}_"
                    f"dl{int(row['risk']['day_loss_lock'])}"
                ),
                "spec": asdict(row["spec"]),
                "target": row["target"],
                "stop": row["stop"],
                "risk": row["risk"],
                "cost_per_trade": SELECTION_COST,
                "windows": {
                    "train_2020_2023": row["train"],
                    "validation_2024_2025": row["validation"],
                    "test_2026": test,
                },
                "cost_50_stress": stressed,
                "optimistic_target_first": optimistic,
            }
        )

    winner = finalists[0] if finalists else None
    robust = bool(
        winner
        and all(
            1000
            <= winner["windows"][name]["avg_per_session_after_cost"]
            <= 2500
            for name in sniper.WINDOWS
        )
        and all(
            winner["cost_50_stress"][name]["avg_per_session_after_cost"] > 0
            for name in sniper.WINDOWS
        )
    )
    report = {
        "goal": (
            "Pure Sniper (no Ruler): ₹1,000-₹2,500 average/session, "
            "max 10 trades, small stops"
        ),
        "method": {
            "systems": total,
            "targets": TARGETS,
            "stops": STOPS,
            "profit_locks": PROFIT_LOCKS,
            "loss_locks": LOSS_LOCKS,
            "selection_cost_per_trade": SELECTION_COST,
            "cost_stress_per_trade": 50,
            "train": "2020-2023",
            "validation": "2024-2025",
            "untouched_test": "2026 through 2026-07-21",
            "fill_rule": "stop first when target and stop share a 5m candle",
        },
        "robust": robust,
        "verdict": (
            "GO — robust conservative Sniper found"
            if robust
            else "NO_GO — no conservative Sniper held ₹1,000/day across train, validation, and test"
        ),
        "finalists": finalists,
    }
    output.write_text(json.dumps(report, indent=2))

    print("\n" + report["verdict"])
    if winner:
        print(f"Best walk-forward candidate: {winner['label']}")
        for name, metrics in winner["windows"].items():
            print(
                f"  {name}: net avg ₹{metrics['avg_per_session_after_cost']:,.0f}/day · "
                f"WR {metrics['win_rate_pct']:.1f}% · "
                f"green {metrics['green_session_pct']:.1f}% · "
                f"{metrics['avg_trades_per_session']:.2f} trades/day"
            )
        print("₹50/trade stress:")
        for name, metrics in winner["cost_50_stress"].items():
            print(
                f"  {name}: ₹{metrics['avg_per_session_after_cost']:,.0f}/day"
            )
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
