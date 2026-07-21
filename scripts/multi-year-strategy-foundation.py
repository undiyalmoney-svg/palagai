#!/usr/bin/env python3
"""
Multi-year trading strategy foundation research (2020–2026).

Research ONLY — no production strategy changes.
Compares base strategies, exits, regimes, robustness, and discovery candidates.
"""
from __future__ import annotations

import json
import math
import os
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PALAGAI_CACHE", ROOT / "reports" / "analyst-cache"))
OUT_DIR = Path(os.environ.get("PALAGAI_OUT", "/tmp/strategy-foundation"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

TRAIN_YEARS = {2020, 2021, 2022, 2023}
TEST_YEARS = {2024, 2025, 2026}
ALL_YEARS = sorted(TRAIN_YEARS | TEST_YEARS)


# ---------------------------------------------------------------------------
# Indicators / data
# ---------------------------------------------------------------------------

def hhmm(iso: str) -> str:
    return iso[11:16]


def day(iso: str) -> str:
    return iso[:10]


def to_min(hh: str) -> int:
    h, m = map(int, hh.split(":"))
    return h * 60 + m


def ema_arr(closes: np.ndarray, period: int) -> np.ndarray:
    n = len(closes)
    out = np.full(n, np.nan)
    if n < period:
        return out
    out[period - 1] = closes[:period].mean()
    k = 2 / (period + 1)
    for i in range(period, n):
        out[i] = closes[i] * k + out[i - 1] * (1 - k)
    return out


def precompute_swings(high: np.ndarray, low: np.ndarray, lookback: int):
    n = len(high)
    last_sh = np.full(n, np.nan)
    last_sl = np.full(n, np.nan)
    cur_h = cur_l = np.nan
    for i in range(lookback, n - lookback):
        h, l = high[i], low[i]
        is_h = is_l = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            if high[j] >= h:
                is_h = False
            if low[j] <= l:
                is_l = False
            if not is_h and not is_l:
                break
        conf = i + lookback
        if is_h:
            cur_h = h
        if is_l:
            cur_l = l
        if conf < n:
            last_sh[conf] = cur_h
            last_sl[conf] = cur_l
    for i in range(1, n):
        if np.isnan(last_sh[i]) and not np.isnan(last_sh[i - 1]):
            last_sh[i] = last_sh[i - 1]
        if np.isnan(last_sl[i]) and not np.isnan(last_sl[i - 1]):
            last_sl[i] = last_sl[i - 1]
    return last_sh, last_sl


@dataclass
class Inst:
    name: str
    max_stop: float
    rs_mult: float
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    dates: list[str]
    times: list[str]
    days: list[str]
    years: np.ndarray
    months: np.ndarray  # YYYY-MM as object
    mins: np.ndarray
    ema20: np.ndarray
    ema50: np.ndarray
    swing3_h: np.ndarray
    swing3_l: np.ndarray
    swing5_h: np.ndarray
    swing5_l: np.ndarray
    atr14: np.ndarray
    day_starts: dict[str, int]
    day_ends: dict[str, int]
    prev_close: dict[str, float]
    prev_high: dict[str, float]
    prev_low: dict[str, float]
    # day-level regime features
    day_range: dict[str, float]
    day_ret: dict[str, float]
    day_gap: dict[str, float]
    day_atr: dict[str, float]


def load_inst(path: Path, name: str, max_stop: float, rs_mult: float) -> Inst:
    candles = json.load(open(path))
    o = np.array([x["open"] for x in candles], float)
    h = np.array([x["high"] for x in candles], float)
    l = np.array([x["low"] for x in candles], float)
    c = np.array([x["close"] for x in candles], float)
    dates = [x["date"] for x in candles]
    times = [hhmm(d) for d in dates]
    days = [day(d) for d in dates]
    years = np.array([int(d[:4]) for d in days])
    months = np.array([d[:7] for d in days])
    mins = np.array([to_min(t) for t in times])
    print(f"  indicators {name} n={len(c)}", flush=True)
    ema20 = ema_arr(c, 20)
    ema50 = ema_arr(c, 50)
    s3h, s3l = precompute_swings(h, l, 3)
    s5h, s5l = precompute_swings(h, l, 5)
    br = h - l
    atr14 = np.full(len(c), np.nan)
    for i in range(1, len(c)):
        atr14[i] = br[max(0, i - 14) : i].mean()

    day_starts: dict[str, int] = {}
    day_ends: dict[str, int] = {}
    for i, d in enumerate(days):
        if d not in day_starts:
            day_starts[d] = i
        day_ends[d] = i

    uniq = sorted(day_starts)
    prev_close: dict[str, float] = {}
    prev_high: dict[str, float] = {}
    prev_low: dict[str, float] = {}
    day_range: dict[str, float] = {}
    day_ret: dict[str, float] = {}
    day_gap: dict[str, float] = {}
    day_atr: dict[str, float] = {}
    for i, d in enumerate(uniq):
        a, b = day_starts[d], day_ends[d]
        day_range[d] = float(h[a : b + 1].max() - l[a : b + 1].min())
        day_ret[d] = float(c[b] - c[a])  # open-to-close approx using first/last bar close
        # better: first open to last close
        day_ret[d] = float(c[b] - o[a])
        day_atr[d] = float(np.nanmean(atr14[a : b + 1]))
        if i == 0:
            day_gap[d] = 0.0
            continue
        pd_ = uniq[i - 1]
        pa, pb = day_starts[pd_], day_ends[pd_]
        prev_close[d] = float(c[pb])
        prev_high[d] = float(h[pa : pb + 1].max())
        prev_low[d] = float(l[pa : pb + 1].min())
        day_gap[d] = float(o[a] - c[pb])

    return Inst(
        name=name,
        max_stop=max_stop,
        rs_mult=rs_mult,
        o=o,
        h=h,
        l=l,
        c=c,
        dates=dates,
        times=times,
        days=days,
        years=years,
        months=months,
        mins=mins,
        ema20=ema20,
        ema50=ema50,
        swing3_h=s3h,
        swing3_l=s3l,
        swing5_h=s5h,
        swing5_l=s5l,
        atr14=atr14,
        day_starts=day_starts,
        day_ends=day_ends,
        prev_close=prev_close,
        prev_high=prev_high,
        prev_low=prev_low,
        day_range=day_range,
        day_ret=day_ret,
        day_gap=day_gap,
        day_atr=day_atr,
    )


# ---------------------------------------------------------------------------
# Strategy config
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Strat:
    id: str
    family: str
    entry: str  # donch_n | pdhl_break | pdhl_retest | swing_prev | or_swing | turtle | open_drive | vol_expand | ema_pb
    exit: str  # eod | ema | atr_trail | swing_trail | chandelier | donch_exit | hybrid_ema_atr | r1_ema | fixed_r
    entry_n: int = 20
    exit_n: int = 10
    atr_mult: float = 2.0
    bias: str = "none"  # none | ema50 | prev_day | or_break | or_mid
    swing_lb: int = 5
    or_end: str = "10:15"
    earliest: str = "10:15"
    latest: str = "15:10"
    rr: float = 1.0
    day_stop: float | None = 60.0
    one_trade_day: bool = False
    note: str = ""


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------

@dataclass
class Trade:
    instrument: str
    date: str
    year: int
    month: str
    dir: str
    entry: float
    exit: float
    pts: float
    rs: float
    hold_bars: int
    exit_reason: str
    entry_hhmm: str
    mfe: float
    mae: float
    atr_at_entry: float
    day_range: float
    day_ret: float
    day_gap: float
    day_atr: float


def simulate(inst: Inst, s: Strat) -> list[Trade]:
    or_end_m = to_min(s.or_end)
    earliest_m = max(to_min(s.earliest), or_end_m)
    latest_m = to_min(s.latest)
    open_m = to_min("09:15")
    n = len(inst.c)
    trades: list[Trade] = []

    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    day_start = 0
    or_cache = None
    broke_res = broke_sup = False
    broke_r = broke_s = np.nan
    # trail state
    extreme = None  # favorable extreme for chandelier/atr
    trail = None

    for i in range(100, n):
        d = inst.days[i]
        t = inst.times[i]
        m = inst.mins[i]

        if trading_date != d:
            trading_date = d
            day_net = 0.0
            trades_today = 0
            day_stopped = False
            day_start = inst.day_starts[d]
            or_cache = None
            broke_res = broke_sup = False
            broke_r = broke_s = np.nan
            if open_t is not None:
                open_t = None
            extreme = trail = None

        # ----- manage -----
        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t.get("target")
            atr_e = open_t["atr"]
            ei = open_t["ei"]
            mfe, mae = open_t["mfe"], open_t["mae"]
            exit_px = None
            reason = ""

            if direction == "BUY":
                mfe = max(mfe, inst.h[i] - entry)
                mae = max(mae, entry - inst.l[i])
                extreme = inst.h[i] if extreme is None else max(extreme, inst.h[i])
            else:
                mfe = max(mfe, entry - inst.l[i])
                mae = max(mae, inst.h[i] - entry)
                extreme = inst.l[i] if extreme is None else min(extreme, inst.l[i])
            open_t["mfe"], open_t["mae"] = mfe, mae

            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else atr_e

            # update trailing stops
            if s.exit in ("atr_trail", "chandelier", "hybrid_ema_atr", "vol_trail"):
                mult = s.atr_mult
                if direction == "BUY":
                    cand = extreme - mult * atr
                    trail = cand if trail is None else max(trail, cand)
                else:
                    cand = extreme + mult * atr
                    trail = cand if trail is None else min(trail, cand)

            if s.exit == "swing_trail":
                if direction == "BUY":
                    sl = inst.swing3_l[i]
                    if sl == sl:
                        trail = float(sl) if trail is None else max(trail, float(sl))
                else:
                    sh = inst.swing3_h[i]
                    if sh == sh:
                        trail = float(sh) if trail is None else min(trail, float(sh))

            if s.exit == "donch_exit":
                en = s.exit_n
                if i >= en:
                    if direction == "BUY":
                        trail = float(inst.l[i - en : i].min())
                    else:
                        trail = float(inst.h[i - en : i].max())

            # hard SL always
            if direction == "BUY":
                if inst.l[i] <= stop:
                    exit_px, reason = stop, "SL"
                elif target is not None and inst.h[i] >= target:
                    exit_px, reason = target, "TP"
            else:
                if inst.h[i] >= stop:
                    exit_px, reason = stop, "SL"
                elif target is not None and inst.l[i] <= target:
                    exit_px, reason = target, "TP"

            # trail hit
            if exit_px is None and trail is not None and s.exit in (
                "atr_trail",
                "swing_trail",
                "chandelier",
                "donch_exit",
                "hybrid_ema_atr",
                "vol_trail",
            ):
                if direction == "BUY" and inst.l[i] <= trail:
                    exit_px, reason = trail, "TRAIL"
                if direction == "SELL" and inst.h[i] >= trail:
                    exit_px, reason = trail, "TRAIL"

            # EMA exit
            if exit_px is None and s.exit in ("ema", "hybrid_ema_atr", "r1_ema"):
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px, reason = float(inst.c[i]), "EMA20"
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px, reason = float(inst.c[i]), "EMA20"

            # EOD
            if exit_px is None and t >= "15:15":
                exit_px, reason = float(inst.c[i]), "EOD"

            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                trades.append(
                    Trade(
                        instrument=inst.name,
                        date=d,
                        year=int(d[:4]),
                        month=d[:7],
                        dir=direction,
                        entry=entry,
                        exit=float(exit_px),
                        pts=float(pts),
                        rs=float(pts) * inst.rs_mult,
                        hold_bars=i - ei,
                        exit_reason=reason,
                        entry_hhmm=open_t["hhmm"],
                        mfe=float(mfe),
                        mae=float(mae),
                        atr_at_entry=float(atr_e),
                        day_range=inst.day_range.get(d, 0.0),
                        day_ret=inst.day_ret.get(d, 0.0),
                        day_gap=inst.day_gap.get(d, 0.0),
                        day_atr=inst.day_atr.get(d, 0.0),
                    )
                )
                day_net += pts
                trades_today += 1
                if s.day_stop is not None and day_net <= -s.day_stop:
                    day_stopped = True
                open_t = None
                extreme = trail = None
            continue

        if day_stopped:
            continue
        if s.one_trade_day and trades_today >= 1:
            continue
        if m < earliest_m or m > latest_m:
            continue

        # OR cache
        if or_cache is None:
            hi, lo = -1e18, 1e18
            cnt = 0
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_m:
                    continue
                if inst.mins[j] >= or_end_m:
                    break
                hi = max(hi, inst.h[j])
                lo = min(lo, inst.l[j])
                cnt += 1
            if cnt == 0 or hi <= lo:
                continue
            or_cache = dict(high=hi, low=lo, mid=(hi + lo) / 2)
        orr = or_cache

        # bias
        bias_dir = "FLAT"
        if s.bias == "or_mid":
            bias_dir = "BUY" if inst.c[i] >= orr["mid"] else "SELL"
        elif s.bias == "ema50":
            e = inst.ema50[i]
            if e != e:
                continue
            bias_dir = "BUY" if inst.c[i] > e else "SELL"
        elif s.bias == "prev_day":
            pc = inst.prev_close.get(d)
            if pc is None:
                continue
            bias_dir = "BUY" if inst.c[i] >= pc else "SELL"
        elif s.bias == "or_break":
            if inst.c[i] > orr["high"]:
                bias_dir = "BUY"
            elif inst.c[i] < orr["low"]:
                bias_dir = "SELL"
            else:
                continue
        elif s.bias == "none":
            bias_dir = "FLAT"

        close = float(inst.c[i])
        direction = None

        # ----- entries -----
        if s.entry.startswith("donch") or s.entry in ("donch_n", "turtle", "vol_expand"):
            en = s.entry_n
            if i < en:
                continue
            res = float(inst.h[i - en : i].max())
            sup = float(inst.l[i - en : i].min())
            if s.entry == "vol_expand":
                # require breakout bar range > 1.2 * atr
                if inst.atr14[i] != inst.atr14[i] or (inst.h[i] - inst.l[i]) < 1.2 * inst.atr14[i]:
                    continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "pdhl_break":
            res = inst.prev_high.get(d, np.nan)
            sup = inst.prev_low.get(d, np.nan)
            if res != res:
                continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "pdhl_retest":
            res = inst.prev_high.get(d, np.nan)
            sup = inst.prev_low.get(d, np.nan)
            if res != res:
                continue
            if close > res:
                broke_res, broke_r = True, float(res)
            if close < sup:
                broke_sup, broke_s = True, float(sup)
            if broke_res and broke_r == broke_r and inst.l[i] <= broke_r <= close:
                direction = "BUY"
            elif broke_sup and broke_s == broke_s and inst.h[i] >= broke_s >= close:
                direction = "SELL"

        elif s.entry == "swing_prev":
            res, sup = inst.swing5_h[i], inst.swing5_l[i]
            if s.swing_lb == 3:
                res, sup = inst.swing3_h[i], inst.swing3_l[i]
            if res != res:
                continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "or_swing":
            res, sup = inst.swing3_h[i], inst.swing3_l[i]
            if res != res:
                continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "open_drive":
            # first 30m direction continuation after 10:00
            if m < to_min("10:00"):
                continue
            # OR already built; require close beyond OR in drive direction from 09:15-09:45
            drive_end = to_min("09:45")
            hi, lo = -1e18, 1e18
            first_o = last_c = None
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_m:
                    continue
                if inst.mins[j] >= drive_end:
                    break
                hi = max(hi, inst.h[j])
                lo = min(lo, inst.l[j])
                if first_o is None:
                    first_o = inst.o[j]
                last_c = inst.c[j]
            if first_o is None or hi <= lo:
                continue
            drive_up = last_c >= first_o
            if drive_up and close > orr["high"]:
                direction = "BUY"
            elif (not drive_up) and close < orr["low"]:
                direction = "SELL"

        elif s.entry == "ema_pb":
            e20 = inst.ema20[i]
            if e20 != e20:
                continue
            if bias_dir == "BUY" and inst.l[i] <= e20 <= close:
                direction = "BUY"
            elif bias_dir == "SELL" and inst.h[i] >= e20 >= close:
                direction = "SELL"

        if not direction:
            continue
        if bias_dir in ("BUY", "SELL") and direction != bias_dir:
            continue

        entry = close
        stop = float(inst.l[i] if direction == "BUY" else inst.h[i])
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if s.day_stop is not None and day_net - risk < -s.day_stop:
            continue

        atr_e = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else risk
        target = None
        if s.exit in ("r1_ema", "fixed_r"):
            target = entry + risk * s.rr if direction == "BUY" else entry - risk * s.rr

        # initial trail for chandelier = entry-based
        extreme = entry
        trail = None
        if s.exit in ("chandelier", "atr_trail", "hybrid_ema_atr"):
            if direction == "BUY":
                trail = entry - s.atr_mult * atr_e
            else:
                trail = entry + s.atr_mult * atr_e

        open_t = dict(
            dir=direction,
            entry=entry,
            stop=stop,
            target=target,
            atr=atr_e,
            ei=i,
            hhmm=t,
            mfe=0.0,
            mae=0.0,
        )
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return trades


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def _metrics_core(trades: list[Trade]) -> dict[str, Any]:
    """Core path metrics without calling yearly (avoids recursion)."""
    if not trades:
        return dict(
            n=0,
            net_profit_rs=0,
            expectancy_pts=None,
            win_rate=None,
            profit_factor=None,
            sharpe=None,
            recovery_factor=None,
            max_dd_rs=0,
            avg_winner=None,
            avg_loser=None,
            largest_winner=None,
            largest_loser=None,
            avg_hold_bars=None,
            stability_score=0,
            years_positive="0/0",
        )

    trades = sorted(trades, key=lambda t: (t.date, t.entry_hhmm, t.instrument))
    pts = np.array([t.pts for t in trades])
    rs = np.array([t.rs for t in trades])
    wins = pts[pts > 0]
    losses = pts[pts <= 0]
    eq = np.cumsum(rs)
    peak = np.maximum.accumulate(eq)
    dd = eq - peak
    max_dd = float(dd.min()) if len(dd) else 0.0
    net = float(rs.sum())
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) and losses.sum() != 0 else (
        999.0 if len(wins) else 0.0
    )

    by_day: dict[str, float] = defaultdict(float)
    for t in trades:
        by_day[t.date] += t.rs
    daily = np.array(list(by_day.values()))
    if len(daily) > 1 and daily.std() > 1e-9:
        sharpe = float(np.sqrt(252) * daily.mean() / daily.std())
    else:
        sharpe = 0.0

    recovery = float(net / abs(max_dd)) if max_dd < 0 else (999.0 if net > 0 else 0.0)

    return dict(
        n=int(len(trades)),
        net_profit_rs=round(net, 0),
        expectancy_pts=round(float(pts.mean()), 3),
        win_rate=round(float((pts > 0).mean() * 100), 1),
        profit_factor=round(pf, 3),
        sharpe=round(sharpe, 3),
        recovery_factor=round(recovery, 3),
        max_dd_rs=round(max_dd, 0),
        avg_winner=round(float(wins.mean()), 3) if len(wins) else None,
        avg_loser=round(float(losses.mean()), 3) if len(losses) else None,
        largest_winner=round(float(wins.max()), 3) if len(wins) else None,
        largest_loser=round(float(losses.min()), 3) if len(losses) else None,
        avg_hold_bars=round(float(np.mean([t.hold_bars for t in trades])), 2),
        stability_score=0,
        years_positive="0/0",
        _pts=pts,
        _rs=rs,
    )


def full_metrics(trades: list[Trade], label: str = "") -> dict[str, Any]:
    core = _metrics_core(trades)
    # strip private
    pts = core.pop("_pts", None)
    core.pop("_rs", None)
    if not trades or pts is None:
        return core

    # yearly positivity for stability (use core only — no recursion)
    by_y: dict[int, list[Trade]] = defaultdict(list)
    for t in trades:
        by_y[t.year].append(t)
    y_exp = []
    years_pos = 0
    for y in sorted(by_y):
        ym = _metrics_core(by_y[y])
        if ym["net_profit_rs"] > 0:
            years_pos += 1
        if ym["expectancy_pts"] is not None:
            y_exp.append(ym["expectancy_pts"])
    years_n = len(by_y) or 1
    yoy_rate = years_pos / years_n
    exp_stab = 1.0 / (1.0 + float(np.std(y_exp))) if len(y_exp) > 1 else 0.5
    sharpe = core["sharpe"] or 0.0
    recovery = core["recovery_factor"] or 0.0

    core["stability_score"] = round(
        100
        * (
            0.45 * yoy_rate
            + 0.25 * min(1.0, max(0.0, recovery / 5))
            + 0.20 * exp_stab
            + 0.10 * (1.0 if sharpe > 0.5 else max(0, sharpe) / 0.5 if sharpe > 0 else 0)
        ),
        1,
    )
    core["years_positive"] = f"{years_pos}/{years_n}"
    return core


def yearly_metrics(trades: list[Trade]) -> dict[str, dict]:
    by: dict[int, list[Trade]] = defaultdict(list)
    for t in trades:
        by[t.year].append(t)
    return {str(y): full_metrics(by[y]) for y in sorted(by)}


def monthly_metrics(trades: list[Trade]) -> dict[str, dict]:
    by: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        by[t.month].append(t)
    # compact: only net + n + expectancy
    out = {}
    for m in sorted(by):
        tr = by[m]
        pts = np.array([t.pts for t in tr])
        rs = np.array([t.rs for t in tr])
        out[m] = dict(
            n=len(tr),
            expectancy_pts=round(float(pts.mean()), 3),
            net_profit_rs=round(float(rs.sum()), 0),
            win_rate=round(float((pts > 0).mean() * 100), 1),
        )
    return out


def equity_curve(trades: list[Trade]) -> list[dict]:
    trades = sorted(trades, key=lambda t: (t.date, t.entry_hhmm, t.instrument))
    eq = 0.0
    peak = 0.0
    out = []
    for t in trades:
        eq += t.rs
        peak = max(peak, eq)
        out.append(
            dict(
                date=t.date,
                instrument=t.instrument,
                pts=round(t.pts, 2),
                rs=round(t.rs, 0),
                equity_rs=round(eq, 0),
                dd_rs=round(eq - peak, 0),
            )
        )
    return out


def split_oos(trades: list[Trade]):
    tr = [t for t in trades if t.year in TRAIN_YEARS]
    te = [t for t in trades if t.year in TEST_YEARS]
    return tr, te


# ---------------------------------------------------------------------------
# Regimes
# ---------------------------------------------------------------------------

def tag_regimes(trades: list[Trade], inst_map: dict[str, Inst]) -> dict[str, list[Trade]]:
    """Assign each trade to regime buckets using day features vs instrument medians."""
    # build per-instrument thresholds from that instrument's day stats
    thr: dict[str, dict] = {}
    for name, inst in inst_map.items():
        atrs = np.array(list(inst.day_atr.values()))
        ranges = np.array(list(inst.day_range.values()))
        gaps = np.array([abs(v) for v in inst.day_gap.values()])
        rets = np.array(list(inst.day_ret.values()))
        thr[name] = dict(
            atr_hi=float(np.nanpercentile(atrs, 67)),
            atr_lo=float(np.nanpercentile(atrs, 33)),
            range_hi=float(np.nanpercentile(ranges, 67)),
            range_lo=float(np.nanpercentile(ranges, 33)),
            gap_hi=float(np.nanpercentile(gaps, 80)),
            ret_trend=float(np.nanpercentile(np.abs(rets), 60)),
        )

    buckets: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        th = thr[t.instrument]
        # vol
        if t.day_atr >= th["atr_hi"]:
            buckets["high_vol"].append(t)
        elif t.day_atr <= th["atr_lo"]:
            buckets["low_vol"].append(t)
        else:
            buckets["mid_vol"].append(t)
        # range vs trend day
        if abs(t.day_ret) >= th["ret_trend"] and abs(t.day_ret) >= 0.35 * max(t.day_range, 1):
            buckets["trending"].append(t)
        else:
            buckets["sideways"].append(t)
        if t.day_range >= th["range_hi"]:
            buckets["range_day_wide"].append(t)
        elif t.day_range <= th["range_lo"]:
            buckets["range_day_narrow"].append(t)
        # bull/bear by day return
        if t.day_ret > 0:
            buckets["bull_day"].append(t)
        else:
            buckets["bear_day"].append(t)
        # gap
        if abs(t.day_gap) >= th["gap_hi"]:
            buckets["gap_day"].append(t)
        else:
            buckets["no_gap_day"].append(t)
    return buckets


# ---------------------------------------------------------------------------
# Robustness
# ---------------------------------------------------------------------------

def walk_forward(trades: list[Trade]) -> list[dict]:
    """Expanding WF: train years < Y, evaluate year Y expectancy."""
    out = []
    for y in ALL_YEARS:
        if y <= 2020:
            continue
        te = [t for t in trades if t.year == y]
        # "train" is prior years — we don't refit params here (rule-based);
        # report whether year Y alone is positive given fixed rules
        m = full_metrics(te)
        prior = [t for t in trades if t.year < y]
        pm = full_metrics(prior)
        out.append(
            dict(
                test_year=y,
                test=m,
                prior_train=pm,
                pass_bool=bool(m["expectancy_pts"] is not None and m["expectancy_pts"] > 0 and m["n"] >= 30),
            )
        )
    return out


def monte_carlo(trades: list[Trade], n_sims: int = 500, seed: int = 42) -> dict:
    if len(trades) < 20:
        return dict(n_sims=0)
    rng = np.random.default_rng(seed)
    rs = np.array([t.rs for t in trades])
    max_dds = []
    finals = []
    for _ in range(n_sims):
        shuffled = rng.permutation(rs)
        eq = np.cumsum(shuffled)
        peak = np.maximum.accumulate(eq)
        max_dds.append(float((eq - peak).min()))
        finals.append(float(eq[-1]))
    max_dds = np.array(max_dds)
    finals = np.array(finals)
    return dict(
        n_sims=n_sims,
        final_p5=round(float(np.percentile(finals, 5)), 0),
        final_p50=round(float(np.percentile(finals, 50)), 0),
        final_p95=round(float(np.percentile(finals, 95)), 0),
        maxdd_p5=round(float(np.percentile(max_dds, 5)), 0),  # more negative
        maxdd_p50=round(float(np.percentile(max_dds, 50)), 0),
        maxdd_p95=round(float(np.percentile(max_dds, 95)), 0),
        pct_final_positive=round(float((finals > 0).mean() * 100), 1),
    )


def sensitivity_donch(insts: list[Inst], exit_mode: str, ns=(10, 15, 20, 25, 30, 40), atr_mults=(1.5, 2.0, 2.5, 3.0)):
    rows = []
    if exit_mode in ("atr_trail", "chandelier", "hybrid_ema_atr"):
        for n, am in ((n, am) for n in ns for am in atr_mults):
            s = Strat(f"sens_donch{n}_{exit_mode}_a{am}", "sens", "donch_n", exit_mode, entry_n=n, atr_mult=am)
            tr = []
            for inst in insts:
                tr.extend(simulate(inst, s))
            te = [t for t in tr if t.year in TEST_YEARS]
            m = full_metrics(te)
            rows.append(dict(n=n, atr_mult=am, exit=exit_mode, test=m))
    else:
        for n in ns:
            s = Strat(f"sens_donch{n}_{exit_mode}", "sens", "donch_n", exit_mode, entry_n=n)
            tr = []
            for inst in insts:
                tr.extend(simulate(inst, s))
            te = [t for t in tr if t.year in TEST_YEARS]
            m = full_metrics(te)
            rows.append(dict(n=n, exit=exit_mode, test=m))
    return rows


# ---------------------------------------------------------------------------
# Strategy universe
# ---------------------------------------------------------------------------

def base_strategies() -> list[Strat]:
    return [
        Strat("donch20_eod", "base", "donch_n", "eod", entry_n=20, note="Donchian-20 → EOD"),
        Strat("donch20_ema", "base", "donch_n", "ema", entry_n=20, note="Donchian-20 → EMA"),
        Strat("donch20_atr_trail", "base", "donch_n", "atr_trail", entry_n=20, atr_mult=2.0, note="Donchian-20 → ATR trail"),
        Strat("donch20_swing_trail", "base", "donch_n", "swing_trail", entry_n=20, note="Donchian-20 → swing trail"),
        Strat("donch20_chandelier", "base", "donch_n", "chandelier", entry_n=20, atr_mult=2.0, note="Donchian-20 → Chandelier"),
        Strat("pdhl_break_ema", "base", "pdhl_break", "ema", bias="or_break", note="PDH/PDL break → EMA (OR-break bias)"),
        Strat("pdhl_retest_ema", "base", "pdhl_retest", "ema", bias="or_break", note="PDH/PDL retest → EMA"),
        Strat("swing5_prev_ema", "base", "swing_prev", "ema", bias="prev_day", swing_lb=5, note="Swing5 + prev-day → EMA"),
        # rejected baseline for contrast
        Strat("champion_r1_ema", "rejected", "or_swing", "r1_ema", bias="or_mid", note="Champion OR-swing 1R+EMA (rejected)"),
    ]


def exit_matrix_entries() -> list[str]:
    return ["donch_n", "pdhl_break", "pdhl_retest", "swing_prev"]


def exit_modes() -> list[str]:
    return ["eod", "ema", "atr_trail", "swing_trail", "chandelier", "donch_exit", "hybrid_ema_atr", "r1_ema"]


def discovery_strategies() -> list[Strat]:
    out = []
    # Donchian variations
    for n in (10, 15, 20, 30, 55):
        for ex in ("eod", "ema", "donch_exit", "chandelier"):
            out.append(Strat(f"disc_donch{n}_{ex}", "discovery", "donch_n", ex, entry_n=n, exit_n=max(5, n // 2), atr_mult=2.0))
    # Turtle: donch20 entry, donch10 exit
    out.append(Strat("turtle_20_10", "discovery", "turtle", "donch_exit", entry_n=20, exit_n=10, note="Turtle-style"))
    out.append(Strat("turtle_55_20", "discovery", "turtle", "donch_exit", entry_n=55, exit_n=20, note="Turtle long channel"))
    # Opening drive
    out.append(Strat("open_drive_eod", "discovery", "open_drive", "eod"))
    out.append(Strat("open_drive_ema", "discovery", "open_drive", "ema"))
    # Vol expansion breakout
    out.append(Strat("vol_expand_eod", "discovery", "vol_expand", "eod", entry_n=20))
    out.append(Strat("vol_expand_ema", "discovery", "vol_expand", "ema", entry_n=20))
    # EMA pullback with structure bias
    out.append(Strat("ema_pb_ema50_ema", "discovery", "ema_pb", "ema", bias="ema50"))
    out.append(Strat("ema_pb_prev_eod", "discovery", "ema_pb", "eod", bias="prev_day"))
    # PDHL + eod / trails
    for ex in ("eod", "atr_trail", "chandelier", "donch_exit"):
        out.append(Strat(f"pdhl_break_{ex}", "discovery", "pdhl_break", ex, bias="or_break", atr_mult=2.0, exit_n=10))
        out.append(Strat(f"pdhl_retest_{ex}", "discovery", "pdhl_retest", ex, bias="or_break", atr_mult=2.0, exit_n=10))
    # Swing variants
    out.append(Strat("swing3_prev_ema", "discovery", "swing_prev", "ema", bias="prev_day", swing_lb=3))
    out.append(Strat("swing5_prev_eod", "discovery", "swing_prev", "eod", bias="prev_day", swing_lb=5))
    out.append(Strat("swing5_ema50_ema", "discovery", "swing_prev", "ema", bias="ema50", swing_lb=5))
    # one trade/day on best-looking family
    out.append(Strat("donch20_eod_1t", "discovery", "donch_n", "eod", entry_n=20, one_trade_day=True))
    out.append(Strat("donch20_chandelier_1t", "discovery", "donch_n", "chandelier", entry_n=20, one_trade_day=True, atr_mult=2.5))
    # ATR mult variants
    for am in (1.5, 2.5, 3.0):
        out.append(Strat(f"donch20_chand_a{am}", "discovery", "donch_n", "chandelier", entry_n=20, atr_mult=am))
        out.append(Strat(f"donch20_atr_a{am}", "discovery", "donch_n", "atr_trail", entry_n=20, atr_mult=am))
    return out


def run_all(insts: list[Inst], strats: list[Strat]) -> dict[str, list[Trade]]:
    out = {}
    for i, s in enumerate(strats):
        if i % 10 == 0:
            print(f"  sim [{i}/{len(strats)}] {s.id}", flush=True)
        trades = []
        for inst in insts:
            trades.extend(simulate(inst, s))
        out[s.id] = trades
    return out


def why_it_works(trades: list[Trade], baseline: list[Trade] | None = None) -> dict:
    """Evidence-based edge attribution vs optional baseline."""
    if not trades:
        return dict(edge_sources=[], evidence={})
    pts = np.array([t.pts for t in trades])
    mfe = np.array([t.mfe for t in trades])
    mae = np.array([t.mae for t in trades])
    holds = np.array([t.hold_bars for t in trades])
    wins = pts > 0
    evidence = dict(
        avg_mfe=round(float(mfe.mean()), 3),
        avg_mae=round(float(mae.mean()), 3),
        mfe_mae_ratio=round(float(mfe.mean() / (mae.mean() + 1e-9)), 3),
        capture_ratio=round(float(pts[wins].mean() / (mfe[wins].mean() + 1e-9)), 3) if wins.any() else None,
        avg_hold_all=round(float(holds.mean()), 2),
        avg_hold_winners=round(float(holds[wins].mean()), 2) if wins.any() else None,
        avg_hold_losers=round(float(holds[~wins].mean()), 2) if (~wins).any() else None,
        pct_trend_days=None,
        winner_share_of_gross=round(float(pts[wins].sum() / (pts[wins].sum() + abs(pts[~wins].sum()) + 1e-9)), 3),
    )
    # regime: fraction on trending days (abs day_ret large vs range)
    trendish = sum(1 for t in trades if abs(t.day_ret) >= 0.4 * max(t.day_range, 1))
    evidence["pct_trendish_days"] = round(100 * trendish / len(trades), 1)

    sources = []
    if evidence["mfe_mae_ratio"] >= 1.5:
        sources.append("asymmetric_excursion_MFE_gt_MAE")
    if evidence["avg_hold_winners"] and evidence["avg_hold_losers"] and evidence["avg_hold_winners"] > evidence["avg_hold_losers"] * 1.3:
        sources.append("holding_winners_longer")
    if evidence["winner_share_of_gross"] >= 0.55:
        sources.append("large_winners_dominate_gross")
    if evidence["pct_trendish_days"] >= 40:
        sources.append("trades_cluster_on_trend_days")
    avg_loser = float(pts[~wins].mean()) if (~wins).any() else 0
    avg_winner = float(pts[wins].mean()) if wins.any() else 0
    if avg_winner > 0 and abs(avg_loser) > 0 and avg_winner / abs(avg_loser) >= 2.0:
        sources.append("payoff_ratio_ge_2")

    if baseline:
        b_pts = np.array([t.pts for t in baseline])
        b_holds = np.array([t.hold_bars for t in baseline])
        b_mfe = np.array([t.mfe for t in baseline])
        evidence["vs_baseline_expectancy_delta"] = round(float(pts.mean() - b_pts.mean()), 3)
        evidence["vs_baseline_hold_delta"] = round(float(holds.mean() - b_holds.mean()), 2)
        evidence["vs_baseline_mfe_delta"] = round(float(mfe.mean() - b_mfe.mean()), 3)
        if evidence["vs_baseline_hold_delta"] > 2:
            sources.append("better_exits_longer_holds_vs_baseline")
        if evidence["vs_baseline_mfe_delta"] > 1:
            sources.append("realizes_more_favorable_excursion_vs_baseline")

    return dict(edge_sources=sources, evidence=evidence)


def score_rank(row: dict) -> float:
    """Composite for final ranking — higher better. Reject if OOS expectancy <= 0."""
    te = row["oos"]
    al = row["all"]
    if te["expectancy_pts"] is None or te["expectancy_pts"] <= 0:
        return -1e9
    if te["n"] < 80:
        return -1e9
    # require majority of years positive
    yoy = row.get("walk_forward", [])
    wf_pass = sum(1 for x in yoy if x.get("pass_bool")) / max(len(yoy), 1)
    if wf_pass < 0.5:
        return -1e9
    return (
        0.30 * min(te["expectancy_pts"], 15)
        + 0.20 * (te["stability_score"] / 10)
        + 0.15 * min(te["recovery_factor"], 10)
        + 0.15 * min(te["profit_factor"], 3)
        + 0.10 * wf_pass * 10
        + 0.10 * min(max(te["sharpe"], 0), 2) * 5
    )


def main():
    t0 = time.time()
    print("Loading caches...", flush=True)
    nifty = load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    insts = [nifty, bank]
    inst_map = {"nifty": nifty, "bank": bank}

    bases = base_strategies()
    disc = discovery_strategies()
    # exit matrix
    exit_strats = []
    for entry, bias, en, slb in [
        ("donch_n", "none", 20, 5),
        ("pdhl_break", "or_break", 20, 5),
        ("pdhl_retest", "or_break", 20, 5),
        ("swing_prev", "prev_day", 20, 5),
    ]:
        for ex in exit_modes():
            sid = f"exitmat_{entry}_{ex}"
            exit_strats.append(
                Strat(sid, "exit_matrix", entry, ex, entry_n=en, bias=bias, swing_lb=slb, atr_mult=2.0, exit_n=10, rr=1.0)
            )

    # dedupe by id
    all_strats = []
    seen = set()
    for s in bases + exit_strats + disc:
        if s.id in seen:
            continue
        seen.add(s.id)
        all_strats.append(s)

    print(f"Running {len(all_strats)} strategies...", flush=True)
    trade_map = run_all(insts, all_strats)

    champion_trades = trade_map.get("champion_r1_ema", [])

    reports = {}
    for s in all_strats:
        trades = trade_map[s.id]
        tr, te = split_oos(trades)
        wf = walk_forward(trades)
        regimes = {k: full_metrics(v) for k, v in tag_regimes(trades, inst_map).items()}
        # OOS regimes only
        regimes_oos = {k: full_metrics(v) for k, v in tag_regimes(te, inst_map).items()}
        mc = monte_carlo(te, n_sims=400) if len(te) >= 40 else dict(n_sims=0)
        why = why_it_works(te if te else trades, baseline=[t for t in champion_trades if t.year in TEST_YEARS] or None)
        row = dict(
            id=s.id,
            family=s.family,
            note=s.note,
            config=asdict(s),
            all=full_metrics(trades),
            train=full_metrics(tr),
            oos=full_metrics(te),
            yearly=yearly_metrics(trades),
            monthly=monthly_metrics(trades),
            walk_forward=wf,
            regimes_all=regimes,
            regimes_oos=regimes_oos,
            monte_carlo_oos=mc,
            why=why,
            equity_curve_oos=equity_curve(te)[:: max(1, len(te) // 200)] if te else [],  # downsample
            nifty_oos=full_metrics([t for t in te if t.instrument == "nifty"]),
            bank_oos=full_metrics([t for t in te if t.instrument == "bank"]),
        )
        row["rank_score"] = score_rank(row)
        reports[s.id] = row

    # sensitivity on top donch exits
    print("Sensitivity...", flush=True)
    sens = {
        "donch_eod": sensitivity_donch(insts, "eod"),
        "donch_ema": sensitivity_donch(insts, "ema"),
        "donch_chandelier": sensitivity_donch(insts, "chandelier"),
    }

    # ranking
    ranked = sorted(reports.values(), key=lambda r: r["rank_score"], reverse=True)
    accepted = [r for r in ranked if r["rank_score"] > -1e8]
    rejected = [r for r in ranked if r["rank_score"] <= -1e8]

    # regime survival: OOS expectancy > 0 in key regimes
    key_regimes = ["trending", "sideways", "high_vol", "low_vol", "bull_day", "bear_day", "gap_day", "range_day_wide"]

    def regime_survival(r):
        ok = 0
        detail = {}
        for k in key_regimes:
            m = r["regimes_oos"].get(k, {})
            exp = m.get("expectancy_pts")
            detail[k] = exp
            if exp is not None and exp > 0 and m.get("n", 0) >= 20:
                ok += 1
        return ok, detail

    for r in accepted:
        ok, detail = regime_survival(r)
        r["regime_survival"] = f"{ok}/{len(key_regimes)}"
        r["regime_oos_expectancy"] = detail

    # final top table (strip heavy monthly for summary)
    def slim(r):
        return dict(
            id=r["id"],
            family=r["family"],
            note=r["note"],
            rank_score=round(r["rank_score"], 3),
            all=r["all"],
            train=r["train"],
            oos=r["oos"],
            yearly={y: dict(n=m["n"], expectancy_pts=m["expectancy_pts"], net_profit_rs=m["net_profit_rs"], win_rate=m["win_rate"]) for y, m in r["yearly"].items()},
            walk_forward=[{"year": x["test_year"], "exp": x["test"]["expectancy_pts"], "pass": x["pass_bool"]} for x in r["walk_forward"]],
            monte_carlo_oos=r["monte_carlo_oos"],
            why=r["why"],
            regime_survival=r.get("regime_survival"),
            regime_oos_expectancy=r.get("regime_oos_expectancy"),
            nifty_oos=r["nifty_oos"],
            bank_oos=r["bank_oos"],
            config=r["config"],
        )

    summary = dict(
        meta=dict(
            sample="2020-01-01..2026-07-21",
            train="2020-2023",
            oos="2024-2026",
            n_strategies=len(all_strats),
            n_accepted=len(accepted),
            elapsed_s=round(time.time() - t0, 1),
        ),
        base_comparison=[slim(reports[s.id]) for s in bases],
        exit_matrix_best=[],
        discovery_top=[],
        final_ranking=[slim(r) for r in accepted[:25]],
        rejected_count=len(rejected),
        sensitivity=sens,
        recommendation={},
    )

    # best exit per entry from exit matrix
    for entry in ["donch_n", "pdhl_break", "pdhl_retest", "swing_prev"]:
        cands = [reports[s.id] for s in exit_strats if s.entry == entry]
        cands = sorted(cands, key=lambda r: (r["oos"]["expectancy_pts"] or -999), reverse=True)
        summary["exit_matrix_best"].append(
            dict(entry=entry, ranking=[slim(c) for c in cands[:5]])
        )

    summary["discovery_top"] = [slim(r) for r in accepted if r["family"] == "discovery"][:15]

    # recommendation
    if accepted:
        best = accepted[0]
        ok, _ = regime_survival(best)
        summary["recommendation"] = dict(
            foundation_strategy=best["id"],
            note=best["note"] or best["id"],
            oos=best["oos"],
            train=best["train"],
            regime_survival=best.get("regime_survival"),
            why=best["why"],
            deploy_ready=bool(
                best["oos"]["expectancy_pts"] > 0
                and best["train"]["expectancy_pts"] > 0
                and ok >= 5
                and best["oos"]["stability_score"] >= 50
            ),
            next_steps=[
                "Paper-trade foundation on desk path with same fills assumptions",
                "Only then add filters (session/weekday) as optional overlays",
                "Do not reintroduce fixed 1R as primary exit",
            ],
        )

    # persist full + summary
    json.dump(summary, open(OUT_DIR / "summary.json", "w"), indent=2, default=str)
    # full reports without full monthly for size — keep yearly + slim monthly stats
    full_out = {}
    for sid, r in reports.items():
        full_out[sid] = {k: v for k, v in r.items() if k != "equity_curve_oos"}
        full_out[sid]["equity_curve_oos_len"] = len(r.get("equity_curve_oos") or [])
        # keep monthly
    json.dump(full_out, open(OUT_DIR / "all_strategies.json", "w"), indent=2, default=str)

    # equity curves for top 5
    for r in accepted[:5]:
        ec = equity_curve(split_oos(trade_map[r["id"]])[1])
        json.dump(ec, open(OUT_DIR / f"equity_oos_{r['id']}.json", "w"), indent=2)

    # CSV leaderboard
    rows = []
    for r in ranked:
        rows.append(
            dict(
                id=r["id"],
                family=r["family"],
                rank_score=r["rank_score"],
                oos_exp=r["oos"]["expectancy_pts"],
                oos_net=r["oos"]["net_profit_rs"],
                oos_wr=r["oos"]["win_rate"],
                oos_pf=r["oos"]["profit_factor"],
                oos_sharpe=r["oos"]["sharpe"],
                oos_rf=r["oos"]["recovery_factor"],
                oos_dd=r["oos"]["max_dd_rs"],
                oos_n=r["oos"]["n"],
                oos_stab=r["oos"]["stability_score"],
                train_exp=r["train"]["expectancy_pts"],
                years_pos=r["all"]["years_positive"],
                regime_surv=r.get("regime_survival"),
            )
        )
    pd.DataFrame(rows).to_csv(OUT_DIR / "leaderboard.csv", index=False)

    print(f"\nDone in {time.time()-t0:.1f}s → {OUT_DIR}", flush=True)
    print(f"Accepted {len(accepted)} / {len(all_strats)}", flush=True)
    print("\n=== BASE COMPARISON (OOS) ===")
    for s in bases:
        r = reports[s.id]
        o = r["oos"]
        print(
            f"{s.id:28} exp={o['expectancy_pts']} pf={o['profit_factor']} sharpe={o['sharpe']} "
            f"dd={o['max_dd_rs']} n={o['n']} stab={o['stability_score']} yrs={o['years_positive']}"
        )
    print("\n=== FINAL TOP 10 ===")
    for r in accepted[:10]:
        o = r["oos"]
        print(
            f"{r['id']:32} score={r['rank_score']:.2f} exp={o['expectancy_pts']} "
            f"pf={o['profit_factor']} rf={o['recovery_factor']} dd={o['max_dd_rs']} "
            f"surv={r.get('regime_survival')} mc_pos%={r['monte_carlo_oos'].get('pct_final_positive')}"
        )
    if summary.get("recommendation"):
        print("\n=== RECOMMENDATION ===")
        print(summary["recommendation"]["foundation_strategy"], summary["recommendation"].get("deploy_ready"))


if __name__ == "__main__":
    main()
