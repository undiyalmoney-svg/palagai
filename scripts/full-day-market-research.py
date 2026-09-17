#!/usr/bin/env python3
"""
Causal full-session research for NIFTY, BANKNIFTY and CRUDEOILM.

The script deliberately separates model selection (oldest 60% of sessions)
from evaluation (newest 40%). Index option P&L uses a conservative 0.5-delta
ATM proxy and explicit friction; Crude uses CL=F x 85 only when real MCX
history is unavailable.

Usage:
    python3 scripts/full-day-market-research.py

Output (gitignored):
    reports/full-day-market-research/summary.json
"""
from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone, timedelta
from itertools import product
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path("/tmp/palagai-full-day-research")
OUT = ROOT / "reports" / "full-day-market-research"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

KITE_CACHE = ROOT / "reports" / "analyst-cache"
KITE_FILES = {
    "nifty": KITE_CACHE / "nifty-5m-2020-2026.json",
    "bank": KITE_CACHE / "banknifty-5m-2020-2026.json",
    "crude": KITE_CACHE / "crudeoilm-5m-merged.json",
}


@dataclass(frozen=True)
class Market:
    key: str
    symbol: str
    session_start: str
    entry_end: str
    force_exit: str
    rupees_per_point: float
    round_trip_cost: float
    slippage_points: float
    min_stop_points: float
    scale: float = 1.0
    data_note: str = ""


@dataclass(frozen=True)
class Spec:
    family: str
    lookback: int
    ema_period: int
    atr_multiple: float
    reward_r: float
    max_trades: int

    @property
    def label(self) -> str:
        return (
            f"{self.family}|lb{self.lookback}|ema{self.ema_period}|"
            f"atr{self.atr_multiple:g}|rr{self.reward_r:g}|mt{self.max_trades}"
        )


@dataclass
class Bar:
    stamp: str
    day: str
    minute: int
    open: float
    high: float
    low: float
    close: float
    ema20: float = math.nan
    ema50: float = math.nan
    atr14: float = math.nan


@dataclass
class Trade:
    market: str
    spec: str
    day: str
    entry_time: str
    exit_time: str
    direction: int
    entry: float
    exit: float
    stop_distance: float
    gross_points: float
    net_points: float
    net_rupees: float
    exit_reason: str


MARKETS = (
    Market(
        key="nifty",
        symbol="^NSEI",
        session_start="09:15",
        entry_end="15:10",
        force_exit="15:15",
        # ATM option premium proxy: 65 units x approximately 0.5 delta.
        rupees_per_point=32.5,
        round_trip_cost=80.0,
        slippage_points=1.0,
        min_stop_points=6.0,
        data_note="Yahoo NIFTY index; ATM option P&L approximated at 0.5 delta.",
    ),
    Market(
        key="bank",
        symbol="^NSEBANK",
        session_start="09:15",
        entry_end="15:10",
        force_exit="15:15",
        # ATM option premium proxy: 30 units x approximately 0.5 delta.
        rupees_per_point=15.0,
        round_trip_cost=80.0,
        slippage_points=2.0,
        min_stop_points=15.0,
        data_note="Yahoo BANKNIFTY index; ATM option P&L approximated at 0.5 delta.",
    ),
    Market(
        key="crude",
        symbol="CL=F",
        session_start="09:00",
        entry_end="23:00",
        force_exit="23:10",
        rupees_per_point=10.0,
        round_trip_cost=50.0,
        slippage_points=2.0,
        min_stop_points=15.0,
        scale=85.0,
        data_note="Yahoo WTI CL=F x 85 proxy; requires real MCX validation before use.",
    ),
)


def to_minute(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def rows_to_bars(market: Market, rows: list[dict[str, Any]], scale: float) -> list[Bar]:
    start = to_minute(market.session_start)
    end = to_minute(market.force_exit)
    bars: list[Bar] = []
    for row in rows:
        stamp = str(row["date"]).replace("T", " ").split("+")[0][:19]
        minute = to_minute(stamp[11:16])
        if minute < start or minute > end:
            continue
        bars.append(
            Bar(
                stamp=stamp,
                day=stamp[:10],
                minute=minute,
                open=float(row["open"]) * scale,
                high=float(row["high"]) * scale,
                low=float(row["low"]) * scale,
                close=float(row["close"]) * scale,
            )
        )
    bars.sort(key=lambda bar: bar.stamp)
    add_indicators(bars)
    return bars


def fetch_yahoo(market: Market) -> list[Bar]:
    cache_path = CACHE / f"{market.key}-5m-60d.json"
    if cache_path.exists():
        payload = json.loads(cache_path.read_text())
    else:
        url = (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            + urllib.parse.quote(market.symbol)
            + "?interval=5m&range=60d"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    payload = json.load(response)
                cache_path.write_text(json.dumps(payload))
                break
            except Exception as exc:  # pragma: no cover - network-dependent
                last_error = exc
                time.sleep(2**attempt)
        else:
            raise RuntimeError(f"Yahoo download failed for {market.key}: {last_error}")

    result = payload["chart"]["result"][0]
    timestamps = result.get("timestamp") or []
    quote = result["indicators"]["quote"][0]
    rows: list[dict[str, Any]] = []
    for i, epoch in enumerate(timestamps):
        values = (quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i])
        if any(value is None for value in values):
            continue
        ist = datetime.fromtimestamp(epoch, tz=timezone.utc) + timedelta(hours=5, minutes=30)
        rows.append(
            {
                "date": ist.strftime("%Y-%m-%d %H:%M:%S"),
                "open": values[0],
                "high": values[1],
                "low": values[2],
                "close": values[3],
            }
        )
    return rows_to_bars(market, rows, market.scale)


def load_market_bars(market: Market) -> tuple[list[Bar], str]:
    kite_path = KITE_FILES[market.key]
    if kite_path.exists():
        rows = json.loads(kite_path.read_text())
        bars = rows_to_bars(market, rows, 1.0)
        note = {
            "nifty": "Real Kite NIFTY 50 index candles; ATM option P&L approximated at 0.5 delta.",
            "bank": "Real Kite BANKNIFTY index candles; ATM option P&L approximated at 0.5 delta.",
            "crude": "Real Kite CRUDEOILM front-month candles merged from available contracts.",
        }[market.key]
        return bars, note
    return fetch_yahoo(market), market.data_note


def add_indicators(bars: list[Bar]) -> None:
    ema20 = ema50 = None
    alpha20 = 2 / 21
    alpha50 = 2 / 51
    true_ranges: list[float] = []
    previous_close = None
    for bar in bars:
        ema20 = bar.close if ema20 is None else alpha20 * bar.close + (1 - alpha20) * ema20
        ema50 = bar.close if ema50 is None else alpha50 * bar.close + (1 - alpha50) * ema50
        tr = bar.high - bar.low
        if previous_close is not None:
            tr = max(tr, abs(bar.high - previous_close), abs(bar.low - previous_close))
        true_ranges.append(tr)
        bar.ema20 = ema20
        bar.ema50 = ema50
        if len(true_ranges) >= 14:
            bar.atr14 = sum(true_ranges[-14:]) / 14
        previous_close = bar.close


def grouped_indices(bars: list[Bar]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = defaultdict(list)
    for index, bar in enumerate(bars):
        out[bar.day].append(index)
    return out


def signal_at(bars: list[Bar], day_indices: list[int], local: int, spec: Spec) -> int:
    if local < max(spec.lookback, 2):
        return 0
    i = day_indices[local]
    bar = bars[i]
    prior = [bars[j] for j in day_indices[max(0, local - spec.lookback) : local]]
    prior_high = max(row.high for row in prior)
    prior_low = min(row.low for row in prior)
    ema = bar.ema20 if spec.ema_period == 20 else bar.ema50
    previous = bars[day_indices[local - 1]]

    if spec.family == "breakout":
        if bar.close > prior_high and previous.close <= prior_high and bar.close > ema:
            return 1
        if bar.close < prior_low and previous.close >= prior_low and bar.close < ema:
            return -1
    elif spec.family == "trap":
        if bar.low < prior_low and bar.close > prior_low and bar.close > bar.open and bar.close > ema:
            return 1
        if bar.high > prior_high and bar.close < prior_high and bar.close < bar.open and bar.close < ema:
            return -1
    elif spec.family == "pullback":
        trend_up = bar.ema20 > bar.ema50 and bar.ema20 > previous.ema20
        trend_down = bar.ema20 < bar.ema50 and bar.ema20 < previous.ema20
        if trend_up and bar.low <= bar.ema20 and bar.close > bar.ema20 and bar.close > bar.open:
            return 1
        if trend_down and bar.high >= bar.ema20 and bar.close < bar.ema20 and bar.close < bar.open:
            return -1
    elif spec.family == "opening_breakout":
        # lookback is opening-range duration in 5-minute bars.
        if local <= spec.lookback:
            return 0
        opening = [bars[j] for j in day_indices[: spec.lookback]]
        opening_high = max(row.high for row in opening)
        opening_low = min(row.low for row in opening)
        if bar.close > opening_high and previous.close <= opening_high and bar.close > ema:
            return 1
        if bar.close < opening_low and previous.close >= opening_low and bar.close < ema:
            return -1
    return 0


def simulate(market: Market, bars: list[Bar], spec: Spec) -> list[Trade]:
    trades: list[Trade] = []
    by_day = grouped_indices(bars)
    entry_end = to_minute(market.entry_end)
    force_exit = to_minute(market.force_exit)
    for day in sorted(by_day):
        indices = by_day[day]
        local = 0
        trades_today = 0
        while local < len(indices) - 1 and trades_today < spec.max_trades:
            i = indices[local]
            bar = bars[i]
            if bar.minute > entry_end or math.isnan(bar.atr14):
                local += 1
                continue
            direction = signal_at(bars, indices, local, spec)
            if direction == 0:
                local += 1
                continue

            entry_local = local + 1
            entry_bar = bars[indices[entry_local]]
            if entry_bar.minute > entry_end:
                break
            entry = entry_bar.open
            distance = max(market.min_stop_points, bar.atr14 * spec.atr_multiple)
            stop = entry - direction * distance
            target = entry + direction * distance * spec.reward_r
            exit_price = entry
            exit_reason = "TIME"
            exit_local = entry_local

            for cursor in range(entry_local, len(indices)):
                row = bars[indices[cursor]]
                # Conservative same-bar rule: stop is checked before target.
                stop_hit = row.low <= stop if direction == 1 else row.high >= stop
                target_hit = row.high >= target if direction == 1 else row.low <= target
                if stop_hit:
                    exit_price = stop
                    exit_reason = "SL"
                    exit_local = cursor
                    break
                if target_hit:
                    exit_price = target
                    exit_reason = "TP"
                    exit_local = cursor
                    break
                if row.minute >= force_exit:
                    exit_price = row.close
                    exit_reason = "TIME"
                    exit_local = cursor
                    break

            gross_points = direction * (exit_price - entry)
            net_points = gross_points - market.slippage_points
            net_rupees = net_points * market.rupees_per_point - market.round_trip_cost
            exit_bar = bars[indices[exit_local]]
            trades.append(
                Trade(
                    market=market.key,
                    spec=spec.label,
                    day=day,
                    entry_time=entry_bar.stamp[11:16],
                    exit_time=exit_bar.stamp[11:16],
                    direction=direction,
                    entry=round(entry, 2),
                    exit=round(exit_price, 2),
                    stop_distance=round(distance, 2),
                    gross_points=round(gross_points, 2),
                    net_points=round(net_points, 2),
                    net_rupees=round(net_rupees, 2),
                    exit_reason=exit_reason,
                )
            )
            trades_today += 1
            local = exit_local + 1
    return trades


def metrics(trades: list[Trade], calendar_days: int) -> dict:
    if not trades:
        return {
            "trades": 0,
            "net_rs": 0,
            "avg_calendar_day_rs": 0,
            "profit_factor": 0,
            "win_rate_pct": 0,
            "green_day_pct": 0,
            "max_drawdown_rs": 0,
            "worst_day_rs": 0,
        }
    wins = sum(t.net_rupees for t in trades if t.net_rupees > 0)
    losses = -sum(t.net_rupees for t in trades if t.net_rupees < 0)
    by_day: dict[str, float] = defaultdict(float)
    for trade in trades:
        by_day[trade.day] += trade.net_rupees
    running = peak = drawdown = 0.0
    for day in sorted(by_day):
        running += by_day[day]
        peak = max(peak, running)
        drawdown = min(drawdown, running - peak)
    net = sum(by_day.values())
    return {
        "trades": len(trades),
        "net_rs": round(net),
        "avg_calendar_day_rs": round(net / max(1, calendar_days)),
        "profit_factor": round(wins / losses, 2) if losses else None,
        "win_rate_pct": round(100 * sum(t.net_rupees > 0 for t in trades) / len(trades), 1),
        "green_day_pct": round(100 * sum(value > 0 for value in by_day.values()) / max(1, calendar_days), 1),
        "traded_day_pct": round(100 * len(by_day) / max(1, calendar_days), 1),
        "max_drawdown_rs": round(drawdown),
        "worst_day_rs": round(min(by_day.values())),
    }


def bucket_name(market: str, hhmm: str) -> str:
    if market in {"nifty", "bank"}:
        if hhmm < "10:15":
            return "open_0915_1015"
        if hhmm < "11:30":
            return "morning_1015_1130"
        if hhmm < "13:30":
            return "midday_1130_1330"
        if hhmm < "14:45":
            return "afternoon_1330_1445"
        return "close_1445_1510"
    if hhmm < "12:00":
        return "morning_0900_1200"
    if hhmm < "16:00":
        return "midday_1200_1600"
    if hhmm < "19:00":
        return "afternoon_1600_1900"
    if hhmm < "21:00":
        return "evening_1900_2100"
    return "late_2100_2300"


def candidate_specs() -> list[Spec]:
    specs: list[Spec] = []
    for family, lookbacks in (
        ("opening_breakout", (3, 6, 12)),
        ("breakout", (3, 6, 12)),
        ("trap", (3, 6, 12)),
        ("pullback", (3,)),
    ):
        for lookback, ema, atr, rr, max_trades in product(
            lookbacks, (20, 50), (0.75, 1.0, 1.25), (1.0, 1.5, 2.0), (1, 2)
        ):
            specs.append(Spec(family, lookback, ema, atr, rr, max_trades))
    return specs


def rank_train(row: tuple[Spec, list[Trade], dict]) -> tuple:
    _, _, stat = row
    pf = stat["profit_factor"] or 0
    # Net first, but penalize unstable drawdown and reject sparse lucky runs.
    score = stat["net_rs"] + 0.25 * stat["max_drawdown_rs"]
    eligible = stat["trades"] >= 18 and pf >= 1.05
    return (eligible, score, pf, stat["trades"])


def research_market(market: Market, bars: list[Bar], data_note: str) -> dict:
    days = sorted({bar.day for bar in bars})
    split = max(1, int(len(days) * 0.60))
    train_days = set(days[:split])
    test_days = set(days[split:])
    rows = []
    all_trades_by_spec: dict[str, list[Trade]] = {}
    for spec in candidate_specs():
        all_trades = simulate(market, bars, spec)
        all_trades_by_spec[spec.label] = all_trades
        train = [trade for trade in all_trades if trade.day in train_days]
        rows.append((spec, train, metrics(train, len(train_days))))
    rows.sort(key=rank_train, reverse=True)
    chosen, _, train_stat = rows[0]
    chosen_all = all_trades_by_spec[chosen.label]
    test_trades = [trade for trade in chosen_all if trade.day in test_days]
    test_stat = metrics(test_trades, len(test_days))

    # Neighborhood robustness: train top ten are evaluated untouched on holdout.
    top_ten = []
    for spec, _, stat in rows[:10]:
        holdout = [trade for trade in all_trades_by_spec[spec.label] if trade.day in test_days]
        top_ten.append(
            {
                "spec": spec.label,
                "train": stat,
                "holdout": metrics(holdout, len(test_days)),
            }
        )

    buckets: dict[str, list[Trade]] = defaultdict(list)
    for trade in test_trades:
        buckets[bucket_name(market.key, trade.entry_time)].append(trade)

    today = days[-1] if days else None
    return {
        "market": market.key,
        "data_note": data_note,
        "bars": len(bars),
        "sessions": len(days),
        "from": days[0] if days else None,
        "to": today,
        "split": {
            "train": [days[0], days[split - 1]] if train_days else [],
            "holdout": [days[split], days[-1]] if test_days else [],
        },
        "selected_spec": chosen.label,
        "train": train_stat,
        "holdout": test_stat,
        "holdout_time_buckets": {
            name: metrics(trades, len(test_days)) for name, trades in sorted(buckets.items())
        },
        "top_train_neighborhood": top_ten,
        "latest_session_trades": [
            asdict(trade) for trade in test_trades if trade.day == today
        ],
        "_holdout_trades": test_trades,
    }


def main() -> None:
    reports = []
    for market in MARKETS:
        bars, data_note = load_market_bars(market)
        print(f"{market.key}: {len(bars)} bars; researching full session...", flush=True)
        reports.append(research_market(market, bars, data_note))

    combined_trades: list[Trade] = []
    holdout_days: set[str] = set()
    for report in reports:
        combined_trades.extend(report.pop("_holdout_trades"))
        start, end = report["split"]["holdout"]
        holdout_days.update(
            trade.day for trade in combined_trades if start <= trade.day <= end
        )

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "selection": "Oldest 60% train; newest 40% untouched holdout.",
            "execution": "Signal at close, entry next bar open, stop-first same-bar ambiguity.",
            "costs": "Explicit round-trip charges and adverse slippage on every trade.",
            "warning": (
                "Yahoo index/WTI data and delta proxies are screening tools, not broker-fill proof. "
                "Real NFO and MCX candles are required before changing live-money settings."
            ),
        },
        "markets": reports,
        "combined_holdout": metrics(combined_trades, len(holdout_days)),
    }
    path = OUT / "summary.json"
    path.write_text(json.dumps(summary, indent=2))

    print("\n=== UNTOUCHED HOLDOUT ===")
    for report in reports:
        stat = report["holdout"]
        print(
            f"{report['market']:6} {report['selected_spec']:54} "
            f"net ₹{stat['net_rs']:>7} avg/day ₹{stat['avg_calendar_day_rs']:>5} "
            f"PF {str(stat['profit_factor']):>4} green {stat['green_day_pct']:>5}% "
            f"DD ₹{stat['max_drawdown_rs']:>7}"
        )
    combined = summary["combined_holdout"]
    print(
        f"ALL    net ₹{combined['net_rs']} avg/day ₹{combined['avg_calendar_day_rs']} "
        f"PF {combined['profit_factor']} green {combined['green_day_pct']}% "
        f"DD ₹{combined['max_drawdown_rs']}"
    )
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
