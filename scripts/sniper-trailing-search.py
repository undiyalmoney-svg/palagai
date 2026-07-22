#!/usr/bin/env python3
"""
Search the non-Ruler Sniper variant that keeps a small fixed stop but does not
cap winners at ₹250: EMA exit, swing trail, or EOD hold.

Target: ₹1,000-₹2,500 average/session after ₹25/trade costs, max 10 combined
Nifty+Bank trades, with hard day profit/loss locks. Train 2020-2023,
validation 2024-2025, untouched 2026 test.
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
GRID_PATH = ROOT / "scripts" / "sniper-profitable-search.py"
DEFAULT_OUT = Path("/tmp/sniper-trailing-search/report.json")
STOPS = (100.0, 150.0, 200.0, 300.0)
EXITS = ("ema", "swing_trail", "eod")
SELECTION_COST = 25.0


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def rank(metrics: dict[str, Any]) -> tuple[float, float, float]:
    return (
        metrics["avg_per_session_after_cost"],
        metrics["green_session_pct"],
        -metrics["red_sessions"],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    output = Path(args.json)
    output.parent.mkdir(parents=True, exist_ok=True)

    sniper = load_module("sniper_trailing_base", BASE_PATH)
    grid = load_module("sniper_trailing_grid", GRID_PATH)
    uni = load_module(
        "sniper_trailing_uni", ROOT / "scripts" / "strategy-universe-search.py"
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

    specs = grid.search_specs(sniper)
    total = len(specs) * len(STOPS) * len(EXITS)
    print(f"Searching {total:,} small-stop trailing Snipers…", flush=True)
    leaders: list[dict[str, Any]] = []
    completed = 0
    for exit_mode in EXITS:
        sniper.EXIT_MODE = exit_mode
        for stop in STOPS:
            sniper.STOP_RS = stop
            for spec in specs:
                completed += 1
                trades = sniper.simulate_instrument(
                    nifty, spec
                ) + sniper.simulate_instrument(bank, spec)
                risk, train = grid.best_risk(
                    sniper,
                    trades,
                    window_sessions["train_2020_2023"],
                    sniper.WINDOWS["train_2020_2023"],
                    SELECTION_COST,
                )
                if train["trades"] >= 200:
                    leaders.append(
                        {
                            "spec": spec,
                            "exit_mode": exit_mode,
                            "stop": stop,
                            "risk": risk,
                            "train": train,
                            "trades_data": trades,
                        }
                    )
                    leaders.sort(key=lambda row: rank(row["train"]), reverse=True)
                    if len(leaders) > 200:
                        leaders = leaders[:150]
                if completed % 200 == 0:
                    best = (
                        leaders[0]["train"]["avg_per_session_after_cost"]
                        if leaders
                        else 0
                    )
                    print(f"  {completed:,}/{total:,} · train leader ₹{best:,.0f}/day", flush=True)

    validation_rows = []
    for row in leaders:
        sniper.EXIT_MODE = row["exit_mode"]
        sniper.STOP_RS = row["stop"]
        validation = grid.evaluate(
            sniper,
            row["trades_data"],
            window_sessions["validation_2024_2025"],
            sniper.WINDOWS["validation_2024_2025"],
            row["risk"],
            SELECTION_COST,
        )
        validation_rows.append({**row, "validation": validation})
    validation_rows.sort(key=lambda row: rank(row["validation"]), reverse=True)

    finalists = []
    for row in validation_rows[:20]:
        sniper.EXIT_MODE = row["exit_mode"]
        sniper.STOP_RS = row["stop"]
        test = grid.evaluate(
            sniper,
            row["trades_data"],
            window_sessions["test_2026"],
            sniper.WINDOWS["test_2026"],
            row["risk"],
            SELECTION_COST,
        )
        cost_stress = {
            f"cost_{int(cost)}": {
                name: grid.evaluate(
                    sniper,
                    row["trades_data"],
                    window_sessions[name],
                    sniper.WINDOWS[name],
                    row["risk"],
                    cost,
                )
                for name in sniper.WINDOWS
            }
            for cost in (50.0, 75.0)
        }
        finalists.append(
            {
                "label": (
                    f"{row['spec'].label()}_{row['exit_mode']}_sl{int(row['stop'])}_"
                    f"pl{int(row['risk']['day_profit_lock'])}_"
                    f"dl{int(row['risk']['day_loss_lock'])}"
                ),
                "spec": asdict(row["spec"]),
                "exit": row["exit_mode"],
                "stop": row["stop"],
                "risk": row["risk"],
                "cost_per_trade": SELECTION_COST,
                "windows": {
                    "train_2020_2023": row["train"],
                    "validation_2024_2025": row["validation"],
                    "test_2026": test,
                },
                "cost_stress": cost_stress,
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
            winner["cost_stress"]["cost_50"][name]["avg_per_session_after_cost"]
            >= 750
            for name in sniper.WINDOWS
        )
    )
    report = {
        "goal": (
            "Pure Sniper, no Ruler: small stop + uncapped winner, "
            "₹1,000-₹2,500 average/session"
        ),
        "method": {
            "systems": total,
            "entries": len(specs),
            "stops": STOPS,
            "exits": EXITS,
            "max_trades_per_session": sniper.MAX_TRADES_DAY,
            "profit_locks": grid.PROFIT_LOCKS,
            "loss_locks": grid.LOSS_LOCKS,
            "selection_cost_per_trade": SELECTION_COST,
            "cost_stress": [50, 75],
            "train": "2020-2023",
            "validation": "2024-2025",
            "untouched_test": "2026 through 2026-07-21",
            "fill_rule": "stop priority on 5m bars",
        },
        "robust": robust,
        "verdict": (
            "GO — robust small-stop trailing Sniper found"
            if robust
            else "NO_GO — trailing Sniper did not hold ₹1,000/day across all windows"
        ),
        "finalists": finalists,
    }
    output.write_text(json.dumps(report, indent=2))

    print("\n" + report["verdict"])
    if winner:
        print(f"Best candidate: {winner['label']}")
        for name, metrics in winner["windows"].items():
            print(
                f"  {name}: avg ₹{metrics['avg_per_session_after_cost']:,.0f}/day · "
                f"WR {metrics['win_rate_pct']:.1f}% · green {metrics['green_session_pct']:.1f}% · "
                f"{metrics['avg_trades_per_session']:.2f} trades/day"
            )
        for cost_name, windows in winner["cost_stress"].items():
            values = ", ".join(
                f"{name}=₹{metrics['avg_per_session_after_cost']:,.0f}"
                for name, metrics in windows.items()
            )
            print(f"  {cost_name}: {values}")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
