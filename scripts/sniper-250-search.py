#!/usr/bin/env python3
"""
Research a one-lot Nifty+Bank sniper:

  +₹250 fixed target / -₹150 fixed stop
  max 10 combined trades per session
  stop opening trades when the day reaches +₹2,500

The simulator is deliberately conservative for 5-minute OHLC:
  - entry is the signal bar close
  - exits begin on the next bar
  - if target and stop are both touched in one bar, stop wins
  - one open trade per instrument
  - all positions flatten at the final bar

Selection: 2020-2023 train, 2024-2025 validation, 2026 untouched test.
This is index-point proxy research, not options-fill or cost-inclusive proof.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
DEFAULT_OUT = Path("/tmp/sniper-250-search/report.json")
TARGET_RS = 250.0
STOP_RS = 150.0
EXIT_MODE = "fixed"  # fixed | ema | swing_trail | eod
DAY_TARGET_RS = 2500.0
MAX_TRADES_DAY = 10

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


@dataclass(frozen=True)
class SniperSpec:
    entry: str
    bias: str
    earliest: str
    latest: str
    width: str
    min_drive: float
    max_gap_atr: float

    def label(self) -> str:
        gap = "inf" if self.max_gap_atr >= 99 else f"{self.max_gap_atr:g}"
        return (
            f"{self.entry}_{self.bias}_{self.earliest.replace(':', '')}-"
            f"{self.latest.replace(':', '')}_{self.width}_drive{self.min_drive:g}_gap{gap}"
        )


@dataclass
class Trade:
    date: str
    instrument: str
    entry_time: str
    exit_time: str
    direction: str
    rs: float
    reason: str
    ambiguous_bar: bool


def day_ranges(inst) -> dict[str, tuple[int, int]]:
    days = sorted(inst.day_starts)
    return {
        day: (
            inst.day_starts[day],
            inst.day_starts[days[index + 1]] - 1
            if index + 1 < len(days)
            else len(inst.c) - 1,
        )
        for index, day in enumerate(days)
    }


def bias_direction(inst, index: int, spec: SniperSpec, or_mid: float, or_up: bool) -> str:
    if spec.bias == "none":
        return "ANY"
    if spec.bias == "or_mid":
        return "BUY" if inst.c[index] >= or_mid else "SELL"
    if spec.bias == "or_direction":
        return "BUY" if or_up else "SELL"
    if spec.bias == "ema50":
        ema = inst.ema50[index]
        if not np.isfinite(ema):
            return "NONE"
        return "BUY" if inst.c[index] >= ema else "SELL"
    return "NONE"


def fixed_levels(inst, day: str, entry: str, or_high: float, or_low: float):
    if entry.startswith("or_"):
        return or_high, or_low
    if entry.startswith("pdhl_"):
        return inst.prev_high.get(day), inst.prev_low.get(day)
    return None, None


def signal_direction(
    inst,
    index: int,
    day_start: int,
    spec: SniperSpec,
    day: str,
    or_high: float,
    or_low: float,
    broke: dict[str, float | None],
) -> str | None:
    if index <= day_start:
        return None
    previous_close = float(inst.c[index - 1])
    close = float(inst.c[index])

    if spec.entry.startswith("donch_"):
        lookback_start = max(day_start, index - 20)
        if index <= lookback_start:
            return None
        high_level = float(np.max(inst.h[lookback_start:index]))
        low_level = float(np.min(inst.l[lookback_start:index]))
    else:
        high_level, low_level = fixed_levels(
            inst, day, spec.entry, or_high, or_low
        )

    if spec.entry.endswith("_break"):
        if high_level is not None and previous_close <= high_level < close:
            return "BUY"
        if low_level is not None and previous_close >= low_level > close:
            return "SELL"
        return None

    if spec.entry.endswith("_retest"):
        if high_level is None or low_level is None:
            return None
        if broke["high"] is None and close > high_level:
            broke["high"] = float(high_level)
        if broke["low"] is None and close < low_level:
            broke["low"] = float(low_level)
        if (
            broke["high"] is not None
            and inst.l[index] <= broke["high"] <= inst.h[index]
            and close >= broke["high"]
            and previous_close >= broke["high"]
        ):
            broke["high"] = None
            return "BUY"
        if (
            broke["low"] is not None
            and inst.l[index] <= broke["low"] <= inst.h[index]
            and close <= broke["low"]
            and previous_close <= broke["low"]
        ):
            broke["low"] = None
            return "SELL"
        return None

    if spec.entry == "ema_pullback":
        ema20 = inst.ema20[index]
        ema50 = inst.ema50[index]
        if not np.isfinite(ema20) or not np.isfinite(ema50):
            return None
        if close > ema20 > ema50 and inst.l[index] <= ema20:
            return "BUY"
        if close < ema20 < ema50 and inst.h[index] >= ema20:
            return "SELL"
        return None

    if spec.entry == "inside_break":
        if index < day_start + 2:
            return None
        inside = (
            inst.h[index - 1] < inst.h[index - 2]
            and inst.l[index - 1] > inst.l[index - 2]
        )
        if not inside:
            return None
        if close > inst.h[index - 1] and previous_close <= inst.h[index - 1]:
            return "BUY"
        if close < inst.l[index - 1] and previous_close >= inst.l[index - 1]:
            return "SELL"
        return None

    if spec.entry == "momentum2":
        if index < day_start + 2:
            return None
        body0 = float(inst.c[index - 1] - inst.o[index - 1])
        body1 = float(inst.c[index] - inst.o[index])
        atr = float(inst.atr14[index])
        threshold = 0.25 * atr if np.isfinite(atr) else math.inf
        if body0 > threshold and body1 > threshold and close > previous_close:
            return "BUY"
        if body0 < -threshold and body1 < -threshold and close < previous_close:
            return "SELL"
        return None
    return None


def simulate_instrument(inst, spec: SniperSpec) -> list[Trade]:
    target_points = (
        TARGET_RS / float(inst.rs_mult) if EXIT_MODE == "fixed" else math.inf
    )
    stop_points = STOP_RS / float(inst.rs_mult)
    opening = 9 * 60 + 15
    or_end = 9 * 60 + 45
    earliest = max(opening, int(spec.earliest[:2]) * 60 + int(spec.earliest[3:]))
    latest = int(spec.latest[:2]) * 60 + int(spec.latest[3:])
    ranges = day_ranges(inst)
    trades: list[Trade] = []

    for day, (start, end) in ranges.items():
        or_indexes = [
            index
            for index in range(start, end + 1)
            if opening <= inst.mins[index] < or_end
        ]
        if len(or_indexes) < 2:
            continue
        or_high = float(np.max(inst.h[or_indexes]))
        or_low = float(np.min(inst.l[or_indexes]))
        or_open = float(inst.o[or_indexes[0]])
        or_close = float(inst.c[or_indexes[-1]])
        width = or_high - or_low
        if width <= 0:
            continue
        drive = abs(or_close - or_open) / width
        width_floor = {
            "any": 0.0,
            "wide": 80.0 if inst.name == "nifty" else 150.0,
            "vwide": 120.0 if inst.name == "nifty" else 220.0,
        }[spec.width]
        if width < width_floor or drive < spec.min_drive:
            continue
        atr = float(inst.atr14[or_indexes[-1]])
        previous_close = inst.prev_close.get(day)
        gap_atr = (
            abs(or_open - previous_close) / atr
            if previous_close is not None and np.isfinite(atr) and atr > 0
            else 0.0
        )
        if gap_atr > spec.max_gap_atr:
            continue

        or_mid = (or_high + or_low) / 2
        or_up = or_close >= or_open
        open_trade: dict[str, Any] | None = None
        broke: dict[str, float | None] = {"high": None, "low": None}
        entries = 0

        for index in range(or_indexes[-1] + 1, end + 1):
            minute = int(inst.mins[index])
            if open_trade is not None:
                direction = open_trade["direction"]
                entry_price = open_trade["entry"]
                target = (
                    entry_price + target_points
                    if direction == "BUY"
                    else entry_price - target_points
                )
                stop = (
                    entry_price - stop_points
                    if direction == "BUY"
                    else entry_price + stop_points
                )
                stop_hit = (
                    inst.l[index] <= stop
                    if direction == "BUY"
                    else inst.h[index] >= stop
                )
                target_hit = (
                    inst.h[index] >= target
                    if direction == "BUY"
                    else inst.l[index] <= target
                ) if EXIT_MODE == "fixed" else False
                ambiguous = bool(stop_hit and target_hit)
                if stop_hit:
                    rs, reason = -STOP_RS, "SL"
                elif target_hit:
                    rs, reason = TARGET_RS, "TP"
                elif EXIT_MODE == "ema" and np.isfinite(inst.ema20[index]) and (
                    (direction == "BUY" and inst.c[index] < inst.ema20[index])
                    or (direction == "SELL" and inst.c[index] > inst.ema20[index])
                ):
                    points = (
                        float(inst.c[index]) - entry_price
                        if direction == "BUY"
                        else entry_price - float(inst.c[index])
                    )
                    rs, reason = points * inst.rs_mult, "EMA"
                elif EXIT_MODE == "swing_trail":
                    swing = (
                        float(inst.swing3_l[index])
                        if direction == "BUY"
                        else float(inst.swing3_h[index])
                    )
                    if np.isfinite(swing):
                        previous_trail = open_trade.get("trail")
                        trail = (
                            swing
                            if previous_trail is None
                            else max(previous_trail, swing)
                            if direction == "BUY"
                            else min(previous_trail, swing)
                        )
                        open_trade["trail"] = trail
                        trail_hit = (
                            inst.l[index] <= trail
                            if direction == "BUY"
                            else inst.h[index] >= trail
                        )
                    else:
                        trail_hit = False
                        trail = None
                    if trail_hit and trail is not None:
                        points = (
                            trail - entry_price
                            if direction == "BUY"
                            else entry_price - trail
                        )
                        rs, reason = max(-STOP_RS, points * inst.rs_mult), "TRAIL"
                    elif index == end:
                        points = (
                            float(inst.c[index]) - entry_price
                            if direction == "BUY"
                            else entry_price - float(inst.c[index])
                        )
                        rs, reason = max(-STOP_RS, points * inst.rs_mult), "EOD"
                    else:
                        continue
                elif index == end:
                    points = (
                        float(inst.c[index]) - entry_price
                        if direction == "BUY"
                        else entry_price - float(inst.c[index])
                    )
                    raw_rs = points * inst.rs_mult
                    rs = (
                        max(-STOP_RS, min(TARGET_RS, raw_rs))
                        if EXIT_MODE == "fixed"
                        else max(-STOP_RS, raw_rs)
                    )
                    reason = "EOD"
                else:
                    continue
                trades.append(
                    Trade(
                        date=day,
                        instrument=inst.name,
                        entry_time=open_trade["time"],
                        exit_time=inst.times[index],
                        direction=direction,
                        rs=round(float(rs), 2),
                        reason=reason,
                        ambiguous_bar=ambiguous,
                    )
                )
                open_trade = None
                continue

            if minute < earliest or minute > latest or entries >= MAX_TRADES_DAY:
                continue
            direction = signal_direction(
                inst, index, start, spec, day, or_high, or_low, broke
            )
            if direction is None:
                continue
            bias = bias_direction(inst, index, spec, or_mid, or_up)
            if bias not in ("ANY", direction):
                continue
            open_trade = {
                "direction": direction,
                "entry": float(inst.c[index]),
                "time": inst.times[index],
                "trail": None,
            }
            entries += 1
    return trades


def combine_days(
    trades: list[Trade],
    sessions: list[str],
    start: str,
    end: str,
    cost_per_trade: float,
    ambiguous_target_first: bool = False,
    day_profit_target: float = DAY_TARGET_RS,
    day_loss_limit: float = math.inf,
) -> dict[str, Any]:
    by_day: dict[str, list[Trade]] = defaultdict(list)
    for trade in trades:
        if start <= trade.date <= end:
            by_day[trade.date].append(trade)

    day_values: list[float] = []
    accepted: list[Trade] = []
    accepted_values: list[float] = []
    target_days = 0
    for day in sessions:
        candidates = sorted(
            by_day.get(day, []),
            key=lambda trade: (trade.entry_time, trade.instrument, trade.exit_time),
        )
        realized = 0.0
        count = 0
        for trade in candidates:
            if (
                count >= MAX_TRADES_DAY
                or realized >= day_profit_target
                or realized <= -day_loss_limit
            ):
                break
            trade_value = (
                TARGET_RS if ambiguous_target_first and trade.ambiguous_bar else trade.rs
            )
            realized += trade_value - cost_per_trade
            accepted.append(trade)
            accepted_values.append(trade_value)
            count += 1
        day_values.append(realized)
        if realized >= day_profit_target:
            target_days += 1

    wins = sum(value > 0 for value in accepted_values)
    losses = sum(value < 0 for value in accepted_values)
    gross = sum(accepted_values)
    net = sum(day_values)
    red_days = sum(value < 0 for value in day_values)
    green_days = sum(value > 0 for value in day_values)
    ambiguous = sum(trade.ambiguous_bar for trade in accepted)
    return {
        "sessions": len(sessions),
        "trades": len(accepted),
        "avg_trades_per_session": round(len(accepted) / len(sessions), 2),
        "wins": wins,
        "losses": losses,
        "win_rate_pct": round(100 * wins / len(accepted), 2) if accepted else 0.0,
        "gross": round(gross, 1),
        "net_after_cost": round(net, 1),
        "avg_per_trade_after_cost": round(net / len(accepted), 1) if accepted else 0.0,
        "avg_per_session_after_cost": round(net / len(sessions), 1),
        "green_session_pct": round(100 * green_days / len(sessions), 2),
        "red_sessions": red_days,
        "day_target_hits": target_days,
        "day_target_hit_pct": round(100 * target_days / len(sessions), 3),
        "day_profit_target": day_profit_target,
        "day_loss_limit": None if math.isinf(day_loss_limit) else day_loss_limit,
        "best_day": round(max(day_values), 1),
        "worst_day": round(min(day_values), 1),
        "ambiguous_stop_first_trades": ambiguous,
        "same_bar_rule": "target_first" if ambiguous_target_first else "stop_first",
    }


def build_specs() -> list[SniperSpec]:
    filters = (
        ("any", 0.0, 99.0),
        ("wide", 0.0, 99.0),
        ("wide", 0.35, 2.5),
        ("wide", 0.5, 1.5),
        ("vwide", 0.5, 2.5),
        ("vwide", 0.65, 1.5),
    )
    windows = (
        ("09:45", "12:00"),
        ("09:45", "14:30"),
        ("09:45", "15:00"),
        ("10:15", "12:00"),
        ("10:15", "14:30"),
        ("10:15", "15:00"),
    )
    return [
        SniperSpec(entry, bias, earliest, latest, width, drive, gap)
        for entry in (
            "donch_break",
            "donch_retest",
            "or_break",
            "or_retest",
            "pdhl_break",
            "pdhl_retest",
            "ema_pullback",
            "inside_break",
            "momentum2",
        )
        for bias in ("none", "or_mid", "or_direction", "ema50")
        for earliest, latest in windows
        for width, drive, gap in filters
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    output = Path(args.json)
    output.parent.mkdir(parents=True, exist_ok=True)

    uni = load_module("sniper250_uni", ROOT / "scripts/strategy-universe-search.py")
    print("Loading 5m caches…", flush=True)
    nifty = uni.load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    all_sessions = sorted(set(nifty.day_starts) | set(bank.day_starts))
    window_sessions = {
        name: [day for day in all_sessions if start <= day <= end]
        for name, (start, end) in WINDOWS.items()
    }

    specs = build_specs()
    print(f"Searching {len(specs):,} entry/filter systems…", flush=True)
    train_rows: list[dict[str, Any]] = []
    optimistic_train_rows: list[dict[str, Any]] = []
    trade_cache: dict[str, list[Trade]] = {}
    for index, spec in enumerate(specs, start=1):
        trades = simulate_instrument(nifty, spec) + simulate_instrument(bank, spec)
        trade_cache[spec.label()] = trades
        train = combine_days(
            trades,
            window_sessions["train_2020_2023"],
            *WINDOWS["train_2020_2023"],
            cost_per_trade=0.0,
        )
        if train["trades"] >= 200:
            train_rows.append({"spec": spec, "train": train})
            optimistic_train_rows.append(
                {
                    "spec": spec,
                    "train": combine_days(
                        trades,
                        window_sessions["train_2020_2023"],
                        *WINDOWS["train_2020_2023"],
                        cost_per_trade=0.0,
                        ambiguous_target_first=True,
                    ),
                }
            )
        if index % 200 == 0:
            print(f"  {index:,}/{len(specs):,}", flush=True)

    # Pick only from train. Validation ranks the train shortlist; 2026 stays untouched.
    train_rows.sort(
        key=lambda row: (
            row["train"]["day_target_hit_pct"],
            row["train"]["avg_per_session_after_cost"],
            row["train"]["win_rate_pct"],
        ),
        reverse=True,
    )
    shortlist = train_rows[:100]
    validation_rows: list[dict[str, Any]] = []
    for row in shortlist:
        spec = row["spec"]
        trades = trade_cache[spec.label()]
        validation = combine_days(
            trades,
            window_sessions["validation_2024_2025"],
            *WINDOWS["validation_2024_2025"],
            cost_per_trade=0.0,
        )
        validation_rows.append(
            {"spec": spec, "train": row["train"], "validation": validation}
        )
    validation_rows.sort(
        key=lambda row: (
            row["validation"]["day_target_hit_pct"],
            row["validation"]["avg_per_session_after_cost"],
            row["validation"]["win_rate_pct"],
        ),
        reverse=True,
    )

    optimistic_train_rows.sort(
        key=lambda row: (
            row["train"]["day_target_hit_pct"],
            row["train"]["avg_per_session_after_cost"],
            row["train"]["win_rate_pct"],
        ),
        reverse=True,
    )
    optimistic_validation_rows: list[dict[str, Any]] = []
    for row in optimistic_train_rows[:100]:
        spec = row["spec"]
        trades = trade_cache[spec.label()]
        validation = combine_days(
            trades,
            window_sessions["validation_2024_2025"],
            *WINDOWS["validation_2024_2025"],
            cost_per_trade=0.0,
            ambiguous_target_first=True,
        )
        optimistic_validation_rows.append(
            {"spec": spec, "train": row["train"], "validation": validation}
        )
    optimistic_validation_rows.sort(
        key=lambda row: (
            row["validation"]["day_target_hit_pct"],
            row["validation"]["avg_per_session_after_cost"],
            row["validation"]["win_rate_pct"],
        ),
        reverse=True,
    )

    finalists = []
    for row in validation_rows[:20]:
        spec = row["spec"]
        trades = trade_cache[spec.label()]
        test = combine_days(
            trades,
            window_sessions["test_2026"],
            *WINDOWS["test_2026"],
            cost_per_trade=0.0,
        )
        stressed = {
            f"cost_{int(cost)}": {
                name: combine_days(
                    trades,
                    window_sessions[name],
                    *WINDOWS[name],
                    cost_per_trade=cost,
                )
                for name in WINDOWS
            }
            for cost in (25.0, 50.0)
        }
        finalists.append(
            {
                "label": spec.label(),
                "spec": asdict(spec),
                "gross_windows": {
                    "train_2020_2023": row["train"],
                    "validation_2024_2025": row["validation"],
                    "test_2026": test,
                },
                "cost_stress": stressed,
            }
        )

    optimistic_finalists = []
    for row in optimistic_validation_rows[:20]:
        spec = row["spec"]
        trades = trade_cache[spec.label()]
        optimistic_finalists.append(
            {
                "label": spec.label(),
                "spec": asdict(spec),
                "windows": {
                    "train_2020_2023": row["train"],
                    "validation_2024_2025": row["validation"],
                    "test_2026": combine_days(
                        trades,
                        window_sessions["test_2026"],
                        *WINDOWS["test_2026"],
                        cost_per_trade=0.0,
                        ambiguous_target_first=True,
                    ),
                },
            }
        )

    winner = finalists[0] if finalists else None
    proven = bool(
        winner
        and all(
            winner["gross_windows"][name]["avg_per_session_after_cost"] >= DAY_TARGET_RS
            and winner["gross_windows"][name]["day_target_hit_pct"] >= 50
            for name in WINDOWS
        )
    )
    required_win_rate = 100 * (
        (DAY_TARGET_RS / MAX_TRADES_DAY + STOP_RS) / (TARGET_RS + STOP_RS)
    )
    report = {
        "goal": {
            "target_per_winner": TARGET_RS,
            "stop_per_loser": -STOP_RS,
            "max_combined_trades_per_session": MAX_TRADES_DAY,
            "day_target": DAY_TARGET_RS,
            "lots": 1,
        },
        "math": {
            "required_average_per_trade": DAY_TARGET_RS / MAX_TRADES_DAY,
            "required_win_rate_at_10_trades_pct": round(required_win_rate, 2),
            "after_one_loss_best_possible_day": (
                (MAX_TRADES_DAY - 1) * TARGET_RS - STOP_RS
            ),
            "conclusion": (
                "The day target requires 10 wins from 10 trades before costs. "
                "One loss caps the best possible 10-trade day at ₹2,100."
            ),
        },
        "method": {
            "candidates": len(specs),
            "train": "2020-2023",
            "validation": "2024-2025",
            "untouched_test": "2026 through 2026-07-21",
            "same_bar_rule": "stop first when both target and stop touch",
            "cost_stress_per_trade": [25, 50],
            "warning": (
                "5m index OHLC cannot prove 3.85pt Nifty / 8.33pt Bank targets "
                "or options fills; 1m/tick paper validation is mandatory."
            ),
        },
        "proven": proven,
        "verdict": (
            "GO — candidate cleared the stated day target"
            if proven
            else "NO_GO — no candidate evidenced ₹2,500/session within 10 fixed ₹250/₹150 trades"
        ),
        "finalists": finalists,
        "optimistic_target_first_upper_bound": {
            "warning": (
                "Not deployable evidence: assumes target wins whenever target and stop "
                "are both touched inside the same 5-minute candle."
            ),
            "finalists": optimistic_finalists,
        },
    }
    output.write_text(json.dumps(report, indent=2))

    print("\n" + report["verdict"])
    print(report["math"]["conclusion"])
    if winner:
        print(f"Best candidate: {winner['label']}")
        for name, metrics in winner["gross_windows"].items():
            print(
                f"  {name}: avg/day ₹{metrics['avg_per_session_after_cost']:,.0f} · "
                f"WR {metrics['win_rate_pct']:.1f}% · "
                f"target days {metrics['day_target_hit_pct']:.2f}% · "
                f"trades/day {metrics['avg_trades_per_session']:.2f}"
            )
    if optimistic_finalists:
        optimistic = optimistic_finalists[0]
        print(f"Optimistic target-first bound: {optimistic['label']}")
        for name, metrics in optimistic["windows"].items():
            print(
                f"  {name}: avg/day ₹{metrics['avg_per_session_after_cost']:,.0f} · "
                f"WR {metrics['win_rate_pct']:.1f}% · "
                f"target days {metrics['day_target_hit_pct']:.2f}%"
            )
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
