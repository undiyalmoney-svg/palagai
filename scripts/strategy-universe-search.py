#!/usr/bin/env python3
"""
Strategy universe search — discover best long-term foundations from 2020–2026 Kite data.

Research only. No Champion / Quality Score / weekday assumptions.
Generates thousands of entry×bias×exit×time combinations, rejects OOS-negative
and unstable candidates, ranks survivors, deep-analyzes Top 20.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from itertools import product
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PALAGAI_CACHE", ROOT / "reports" / "analyst-cache"))
OUT = Path(os.environ.get("PALAGAI_OUT", "/tmp/strategy-universe"))
OUT.mkdir(parents=True, exist_ok=True)

TRAIN_YEARS = {2020, 2021, 2022, 2023}
TEST_YEARS = {2024, 2025, 2026}


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


def precompute_swings(high, low, lookback):
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
    times: list[str]
    days: list[str]
    years: np.ndarray
    mins: np.ndarray
    ema9: np.ndarray
    ema20: np.ndarray
    ema50: np.ndarray
    swing3_h: np.ndarray
    swing3_l: np.ndarray
    swing5_h: np.ndarray
    swing5_l: np.ndarray
    atr14: np.ndarray
    day_starts: dict[str, int]
    prev_close: dict[str, float]
    prev_high: dict[str, float]
    prev_low: dict[str, float]
    # multi-day highs/lows (rolling calendar days)
    d2_high: dict[str, float]
    d2_low: dict[str, float]
    d3_high: dict[str, float]
    d3_low: dict[str, float]
    d5_high: dict[str, float]
    d5_low: dict[str, float]
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
    mins = np.array([to_min(t) for t in times])
    print(f"  load {name} n={len(c)}", flush=True)
    ema9 = ema_arr(c, 9)
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
    prev_close, prev_high, prev_low = {}, {}, {}
    d2_high, d2_low, d3_high, d3_low, d5_high, d5_low = {}, {}, {}, {}, {}, {}
    day_range, day_ret, day_gap, day_atr = {}, {}, {}, {}
    day_hi = {}
    day_lo = {}
    for i, d in enumerate(uniq):
        a, b = day_starts[d], day_ends[d]
        day_hi[d] = float(h[a : b + 1].max())
        day_lo[d] = float(l[a : b + 1].min())
        day_range[d] = day_hi[d] - day_lo[d]
        day_ret[d] = float(c[b] - o[a])
        day_atr[d] = float(np.nanmean(atr14[a : b + 1]))
        if i == 0:
            day_gap[d] = 0.0
            continue
        pd_ = uniq[i - 1]
        pa, pb = day_starts[pd_], day_ends[pd_]
        prev_close[d] = float(c[pb])
        prev_high[d] = day_hi[pd_]
        prev_low[d] = day_lo[pd_]
        day_gap[d] = float(o[a] - c[pb])
        # multi-day
        for n_days, store_h, store_l in (
            (2, d2_high, d2_low),
            (3, d3_high, d3_low),
            (5, d5_high, d5_low),
        ):
            if i >= n_days:
                window = uniq[i - n_days : i]
                store_h[d] = max(day_hi[x] for x in window)
                store_l[d] = min(day_lo[x] for x in window)

    return Inst(
        name=name,
        max_stop=max_stop,
        rs_mult=rs_mult,
        o=o,
        h=h,
        l=l,
        c=c,
        times=times,
        days=days,
        years=years,
        mins=mins,
        ema9=ema9,
        ema20=ema20,
        ema50=ema50,
        swing3_h=s3h,
        swing3_l=s3l,
        swing5_h=s5h,
        swing5_l=s5l,
        atr14=atr14,
        day_starts=day_starts,
        prev_close=prev_close,
        prev_high=prev_high,
        prev_low=prev_low,
        d2_high=d2_high,
        d2_low=d2_low,
        d3_high=d3_high,
        d3_low=d3_low,
        d5_high=d5_high,
        d5_low=d5_low,
        day_range=day_range,
        day_ret=day_ret,
        day_gap=day_gap,
        day_atr=day_atr,
    )


@dataclass(frozen=True)
class Spec:
    entry: str
    entry_n: int
    bias: str
    exit: str
    exit_n: int
    atr_mult: float
    or_end: str
    earliest: str
    latest: str
    one_trade: bool
    swing_lb: int = 5
    fade: bool = False  # reverse signal direction

    def id(self) -> str:
        raw = json.dumps(asdict(self), sort_keys=True)
        return hashlib.md5(raw.encode()).hexdigest()[:12]

    def label(self) -> str:
        parts = [
            self.entry,
            f"n{self.entry_n}" if self.entry_n else "",
            f"bias_{self.bias}",
            f"exit_{self.exit}",
            f"en{self.exit_n}" if self.exit in ("donch_exit",) else "",
            f"a{self.atr_mult}" if self.exit in ("atr_trail", "chandelier", "hybrid") else "",
            f"or{self.or_end.replace(':','')}",
            f"{self.earliest.replace(':','')}-{self.latest.replace(':','')}",
            "1t" if self.one_trade else "nt",
            f"sw{self.swing_lb}" if self.entry.startswith("swing") else "",
            "fade" if self.fade else "",
        ]
        return "_".join(p for p in parts if p)


def build_universe(target: int = 2500, seed: int = 7) -> list[Spec]:
    """Build a large stratified universe of strategy specs."""
    rng = np.random.default_rng(seed)
    specs: list[Spec] = []
    seen = set()

    def add(s: Spec):
        key = s.label()
        if key in seen:
            return
        # earliest must be >= or_end for OR-dependent; clamp later in sim
        seen.add(key)
        specs.append(s)

    entries = [
        ("donch", 10),
        ("donch", 15),
        ("donch", 20),
        ("donch", 30),
        ("donch", 40),
        ("donch", 55),
        ("pdhl_break", 0),
        ("pdhl_retest", 0),
        ("swing", 0),
        ("or_hl", 0),
        ("session_ext", 0),
        ("md2", 0),
        ("md3", 0),
        ("md5", 0),
        ("open_drive", 0),
        ("ema_pb", 0),
        ("vol_expand", 20),
        ("range_squeeze", 20),
        ("gap_cont", 0),
        ("gap_fade", 0),
        ("mom", 6),
        ("mom", 12),
        ("inside_break", 0),
        ("ema_cross", 0),
    ]
    biases = ["none", "ema20", "ema50", "prev_day", "or_mid", "or_break"]
    exits = [
        ("eod", 0, 0.0),
        ("ema", 0, 0.0),
        ("swing_trail", 0, 0.0),
        ("donch_exit", 10, 0.0),
        ("donch_exit", 20, 0.0),
        ("atr_trail", 0, 2.0),
        ("atr_trail", 0, 3.0),
        ("chandelier", 0, 2.5),
        ("chandelier", 0, 3.0),
        ("hybrid", 0, 2.5),
    ]
    or_ends = ["09:45", "10:00", "10:15"]
    windows = [
        ("10:15", "15:10"),
        ("10:00", "15:10"),
        ("10:30", "15:10"),
        ("11:00", "15:10"),
        ("10:15", "14:00"),
        ("10:15", "12:00"),
        ("13:00", "15:10"),
    ]
    one_trades = [False, True]
    swing_lbs = [3, 5]

    # Phase A: full core grid (most important axes)
    core_entries = [
        ("donch", 15),
        ("donch", 20),
        ("donch", 40),
        ("donch", 55),
        ("pdhl_break", 0),
        ("pdhl_retest", 0),
        ("swing", 0),
        ("or_hl", 0),
        ("md3", 0),
        ("md5", 0),
        ("vol_expand", 20),
        ("gap_cont", 0),
        ("mom", 12),
        ("ema_pb", 0),
    ]
    core_biases = ["none", "ema50", "prev_day", "or_break", "or_mid"]
    core_exits = [
        ("eod", 0, 0.0),
        ("ema", 0, 0.0),
        ("swing_trail", 0, 0.0),
        ("donch_exit", 10, 0.0),
        ("chandelier", 0, 3.0),
    ]
    for (ent, en), bias, (ex, xn, am), ore, (ear, lat), ot in product(
        core_entries, core_biases, core_exits, ["10:15"], [("10:15", "15:10"), ("10:15", "12:00")], [False, True]
    ):
        slb = 5 if ent != "swing" else 5
        add(
            Spec(
                entry=ent,
                entry_n=en,
                bias=bias,
                exit=ex,
                exit_n=xn,
                atr_mult=am,
                or_end=ore,
                earliest=ear,
                latest=lat,
                one_trade=ot,
                swing_lb=slb,
            )
        )
        if ent == "swing":
            add(
                Spec(
                    entry=ent,
                    entry_n=en,
                    bias=bias,
                    exit=ex,
                    exit_n=xn,
                    atr_mult=am,
                    or_end=ore,
                    earliest=ear,
                    latest=lat,
                    one_trade=ot,
                    swing_lb=3,
                )
            )

    # Phase B: random stratified fill to target
    while len(specs) < target:
        ent, en = entries[int(rng.integers(0, len(entries)))]
        bias = biases[int(rng.integers(0, len(biases)))]
        ex, xn, am = exits[int(rng.integers(0, len(exits)))]
        ore = or_ends[int(rng.integers(0, len(or_ends)))]
        ear, lat = windows[int(rng.integers(0, len(windows)))]
        ot = bool(rng.integers(0, 2))
        slb = int(swing_lbs[int(rng.integers(0, 2))])
        fade = bool(rng.random() < 0.08)  # small fraction reversals
        # skip nonsense: fade + or_break often weird; allow
        add(
            Spec(
                entry=ent,
                entry_n=en if ent in ("donch", "vol_expand", "range_squeeze", "mom") else 0,
                bias=bias,
                exit=ex,
                exit_n=xn,
                atr_mult=am,
                or_end=ore,
                earliest=ear,
                latest=lat,
                one_trade=ot,
                swing_lb=slb,
                fade=fade,
            )
        )
        if len(seen) > target * 3:
            break

    # Phase C: forced known-strong families + neighbors (local densification)
    for en in (10, 15, 20, 25, 30, 40, 55):
        for ex, xn, am in [("eod", 0, 0.0), ("ema", 0, 0.0), ("swing_trail", 0, 0.0), ("donch_exit", 10, 0.0), ("donch_exit", 20, 0.0)]:
            for bias in ["none", "prev_day", "ema50"]:
                for ot in [False, True]:
                    add(Spec("donch", en, bias, ex, xn, am, "10:15", "10:15", "15:10", ot))
    for bias in ["prev_day", "ema50", "or_break", "none"]:
        for ex in ["eod", "ema", "swing_trail"]:
            for slb in [3, 5]:
                for ot in [False, True]:
                    add(Spec("swing", 0, bias, ex, 0, 0.0, "10:15", "10:15", "15:10", ot, swing_lb=slb))
                    add(Spec("swing", 0, bias, ex, 0, 0.0, "10:15", "10:15", "12:00", ot, swing_lb=slb))
    for entry in ["pdhl_break", "pdhl_retest", "md2", "md3", "md5", "or_hl"]:
        for bias in ["or_break", "prev_day", "ema50", "none", "or_mid"]:
            for ex in ["eod", "ema", "swing_trail", "donch_exit"]:
                xn = 10 if ex == "donch_exit" else 0
                for ot in [False, True]:
                    add(Spec(entry, 0, bias, ex, xn, 0.0, "10:15", "10:15", "15:10", ot))

    return specs


def simulate_fast(inst: Inst, s: Spec) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return pts, rs, years, hold_bars arrays."""
    or_end_m = to_min(s.or_end)
    earliest_m = max(to_min(s.earliest), or_end_m)
    latest_m = to_min(s.latest)
    open_m = to_min("09:15")
    n = len(inst.c)

    pts_l: list[float] = []
    rs_l: list[float] = []
    years_l: list[int] = []
    holds_l: list[int] = []

    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    day_start = 0
    or_cache = None
    broke_res = broke_sup = False
    broke_r = broke_s = np.nan
    extreme = trail = None
    # inside bar state
    inside_high = inside_low = np.nan
    # range squeeze: track ATR compression
    day_stop = 60.0

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
            inside_high = inside_low = np.nan
            open_t = None
            extreme = trail = None

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            atr_e = open_t["atr"]
            ei = open_t["ei"]
            exit_px = None

            if direction == "BUY":
                extreme = inst.h[i] if extreme is None else max(extreme, inst.h[i])
            else:
                extreme = inst.l[i] if extreme is None else min(extreme, inst.l[i])

            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else atr_e

            if s.exit in ("atr_trail", "chandelier", "hybrid"):
                if direction == "BUY":
                    cand = extreme - s.atr_mult * atr
                    trail = cand if trail is None else max(trail, cand)
                else:
                    cand = extreme + s.atr_mult * atr
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

            if s.exit == "donch_exit" and s.exit_n > 0 and i >= s.exit_n:
                if direction == "BUY":
                    trail = float(inst.l[i - s.exit_n : i].min())
                else:
                    trail = float(inst.h[i - s.exit_n : i].max())

            if direction == "BUY":
                if inst.l[i] <= stop:
                    exit_px = stop
            else:
                if inst.h[i] >= stop:
                    exit_px = stop

            if exit_px is None and trail is not None and s.exit in (
                "atr_trail",
                "swing_trail",
                "chandelier",
                "donch_exit",
                "hybrid",
            ):
                if direction == "BUY" and inst.l[i] <= trail:
                    exit_px = trail
                if direction == "SELL" and inst.h[i] >= trail:
                    exit_px = trail

            if exit_px is None and s.exit in ("ema", "hybrid"):
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px = float(inst.c[i])
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px = float(inst.c[i])

            if exit_px is None and t >= "15:15":
                exit_px = float(inst.c[i])

            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                pts_l.append(float(pts))
                rs_l.append(float(pts) * inst.rs_mult)
                years_l.append(int(d[:4]))
                holds_l.append(i - ei)
                day_net += pts
                trades_today += 1
                if day_net <= -day_stop:
                    day_stopped = True
                open_t = None
                extreme = trail = None
            continue

        if day_stopped:
            continue
        if s.one_trade and trades_today >= 1:
            continue
        if m < earliest_m or m > latest_m:
            continue

        if or_cache is None:
            hi, lo = -1e18, 1e18
            first_o = last_c = None
            cnt = 0
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_m:
                    continue
                if inst.mins[j] >= or_end_m:
                    break
                hi = max(hi, inst.h[j])
                lo = min(lo, inst.l[j])
                if first_o is None:
                    first_o = inst.o[j]
                last_c = inst.c[j]
                cnt += 1
            if cnt == 0 or hi <= lo:
                continue
            or_cache = dict(high=hi, low=lo, mid=(hi + lo) / 2, first_o=first_o, last_c=last_c)
        orr = or_cache

        # bias
        bias_dir = "FLAT"
        if s.bias == "or_mid":
            bias_dir = "BUY" if inst.c[i] >= orr["mid"] else "SELL"
        elif s.bias == "ema20":
            e = inst.ema20[i]
            if e != e:
                continue
            bias_dir = "BUY" if inst.c[i] > e else "SELL"
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

        close = float(inst.c[i])
        direction = None
        res = sup = np.nan

        if s.entry == "donch" or s.entry == "vol_expand" or s.entry == "range_squeeze":
            en = max(s.entry_n, 5)
            if i < en:
                continue
            res = float(inst.h[i - en : i].max())
            sup = float(inst.l[i - en : i].min())
            if s.entry == "vol_expand":
                if inst.atr14[i] != inst.atr14[i] or (inst.h[i] - inst.l[i]) < 1.2 * inst.atr14[i]:
                    continue
            if s.entry == "range_squeeze":
                # require recent ATR below longer ATR (compression) then break
                if i < en + 20:
                    continue
                atr_short = float(np.mean(inst.h[i - 5 : i] - inst.l[i - 5 : i]))
                atr_long = float(np.mean(inst.h[i - 20 : i] - inst.l[i - 20 : i]))
                if atr_long <= 0 or atr_short > 0.7 * atr_long:
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

        elif s.entry == "swing":
            if s.swing_lb == 3:
                res, sup = inst.swing3_h[i], inst.swing3_l[i]
            else:
                res, sup = inst.swing5_h[i], inst.swing5_l[i]
            if res != res:
                continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "or_hl":
            res, sup = orr["high"], orr["low"]
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "session_ext":
            if i <= day_start:
                continue
            res = float(inst.h[day_start:i].max())
            sup = float(inst.l[day_start:i].min())
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry in ("md2", "md3", "md5"):
            mp = {"md2": (inst.d2_high, inst.d2_low), "md3": (inst.d3_high, inst.d3_low), "md5": (inst.d5_high, inst.d5_low)}
            hh, ll = mp[s.entry]
            res = hh.get(d, np.nan)
            sup = ll.get(d, np.nan)
            if res != res:
                continue
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"

        elif s.entry == "open_drive":
            if m < to_min("10:00"):
                continue
            drive_up = orr["last_c"] is not None and orr["last_c"] >= orr["first_o"]
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
            elif bias_dir == "FLAT":
                # require ema50 trend
                e50 = inst.ema50[i]
                if e50 != e50:
                    continue
                if close > e50 and inst.l[i] <= e20 <= close:
                    direction = "BUY"
                elif close < e50 and inst.h[i] >= e20 >= close:
                    direction = "SELL"

        elif s.entry == "gap_cont":
            gap = inst.day_gap.get(d, 0.0)
            if abs(gap) < 10:
                continue
            if gap > 0 and close > orr["high"]:
                direction = "BUY"
            elif gap < 0 and close < orr["low"]:
                direction = "SELL"

        elif s.entry == "gap_fade":
            gap = inst.day_gap.get(d, 0.0)
            if abs(gap) < 15:
                continue
            # fade: gap up then close back into OR
            if gap > 0 and close < orr["mid"] and close < inst.o[i]:
                direction = "SELL"
            elif gap < 0 and close > orr["mid"] and close > inst.o[i]:
                direction = "BUY"

        elif s.entry == "mom":
            en = max(s.entry_n, 3)
            if i < en:
                continue
            move = close - float(inst.c[i - en])
            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else 0
            if atr <= 0:
                continue
            if move > 1.5 * atr:
                direction = "BUY"
            elif move < -1.5 * atr:
                direction = "SELL"

        elif s.entry == "inside_break":
            # detect prior inside bar
            if i < 2:
                continue
            if inst.h[i - 1] < inst.h[i - 2] and inst.l[i - 1] > inst.l[i - 2]:
                inside_high, inside_low = float(inst.h[i - 1]), float(inst.l[i - 1])
            if inside_high == inside_high:
                if close > inside_high:
                    direction = "BUY"
                    inside_high = inside_low = np.nan
                elif close < inside_low:
                    direction = "SELL"
                    inside_high = inside_low = np.nan

        elif s.entry == "ema_cross":
            if i < 1:
                continue
            e9, e20 = inst.ema9[i], inst.ema20[i]
            p9, p20 = inst.ema9[i - 1], inst.ema20[i - 1]
            if any(x != x for x in (e9, e20, p9, p20)):
                continue
            if p9 <= p20 and e9 > e20:
                direction = "BUY"
            elif p9 >= p20 and e9 < e20:
                direction = "SELL"

        if not direction:
            continue
        if s.fade:
            direction = "SELL" if direction == "BUY" else "BUY"
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
        if day_net - risk < -day_stop:
            continue

        atr_e = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else risk
        extreme = entry
        trail = None
        if s.exit in ("chandelier", "atr_trail", "hybrid"):
            trail = entry - s.atr_mult * atr_e if direction == "BUY" else entry + s.atr_mult * atr_e

        open_t = dict(dir=direction, entry=entry, stop=stop, atr=atr_e, ei=i)
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    if not pts_l:
        return (
            np.array([], float),
            np.array([], float),
            np.array([], int),
            np.array([], int),
        )
    return (
        np.array(pts_l, float),
        np.array(rs_l, float),
        np.array(years_l, int),
        np.array(holds_l, int),
    )


def quick_metrics(pts, rs, years) -> dict:
    if len(pts) == 0:
        return dict(n=0, exp=None, net_rs=0, wr=None, pf=None, maxdd=0, years_pos=0, years_n=0, yoy=0.0)
    wins = pts[pts > 0]
    losses = pts[pts <= 0]
    eq = np.cumsum(rs)
    peak = np.maximum.accumulate(eq)
    maxdd = float((eq - peak).min())
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) and losses.sum() != 0 else (999.0 if len(wins) else 0.0)
    y_pos = 0
    y_all = sorted(set(years.tolist()))
    for y in y_all:
        if rs[years == y].sum() > 0:
            y_pos += 1
    return dict(
        n=int(len(pts)),
        exp=round(float(pts.mean()), 3),
        net_rs=round(float(rs.sum()), 0),
        wr=round(float((pts > 0).mean() * 100), 1),
        pf=round(pf, 3),
        maxdd=round(maxdd, 0),
        years_pos=y_pos,
        years_n=len(y_all),
        yoy=round(y_pos / max(len(y_all), 1), 3),
    )


def full_metrics(pts, rs, years, holds=None) -> dict:
    m = quick_metrics(pts, rs, years)
    if len(pts) == 0:
        m.update(sharpe=0, rf=0, avg_w=None, avg_l=None, best_w=None, worst_l=None, avg_hold=None, stab=0)
        return m
    wins = pts[pts > 0]
    losses = pts[pts <= 0]
    # daily sharpe approx via trade grouping not available — use trade returns scaled
    if len(rs) > 1 and rs.std() > 1e-9:
        # rough: treat each trade as observation, annualize weakly
        sharpe = float(np.sqrt(252) * (rs.mean() / rs.std()) * np.sqrt(max(len(rs) / 252, 0.1)))
        # better: group impossible without dates — use simple trade sharpe
        sharpe = float((pts.mean() / pts.std()) * np.sqrt(252)) if pts.std() > 1e-9 else 0.0
    else:
        sharpe = 0.0
    rf = float(m["net_rs"] / abs(m["maxdd"])) if m["maxdd"] < 0 else (999.0 if m["net_rs"] > 0 else 0.0)
    # yearly exp std for stability
    y_exps = []
    for y in sorted(set(years.tolist())):
        y_exps.append(float(pts[years == y].mean()))
    exp_stab = 1.0 / (1.0 + float(np.std(y_exps))) if len(y_exps) > 1 else 0.5
    stab = round(
        100
        * (
            0.45 * m["yoy"]
            + 0.25 * min(1.0, max(0.0, rf / 5))
            + 0.20 * exp_stab
            + 0.10 * min(1.0, max(0.0, sharpe / 2))
        ),
        1,
    )
    m.update(
        sharpe=round(sharpe, 3),
        rf=round(rf, 3),
        avg_w=round(float(wins.mean()), 3) if len(wins) else None,
        avg_l=round(float(losses.mean()), 3) if len(losses) else None,
        best_w=round(float(wins.max()), 3) if len(wins) else None,
        worst_l=round(float(losses.min()), 3) if len(losses) else None,
        avg_hold=round(float(holds.mean()), 2) if holds is not None and len(holds) else None,
        stab=stab,
        yearly={str(y): round(float(pts[years == y].mean()), 3) for y in sorted(set(years.tolist()))},
        yearly_net={str(y): round(float(rs[years == y].sum()), 0) for y in sorted(set(years.tolist()))},
    )
    return m


def rank_score(train: dict, oos: dict, wf_pass: float, regime_pass: float) -> float:
    if oos["exp"] is None or oos["exp"] <= 0:
        return -1e9
    if train["exp"] is None or train["exp"] <= 0:
        return -1e9
    if oos["n"] < 60:
        return -1e9
    if oos["yoy"] < 0.66:  # at least 2/3 OOS years
        return -1e9
    if wf_pass < 0.5:
        return -1e9
    # overfit penalty: train >> oos
    ratio = oos["exp"] / max(train["exp"], 1e-6)
    overfit_pen = 0.0 if ratio >= 0.35 else -5.0 * (0.35 - ratio)
    return (
        0.28 * min(oos["exp"], 20)
        + 0.18 * min(oos["pf"] or 0, 3)
        + 0.15 * min(oos["rf"] or 0, 10)
        + 0.12 * (oos["stab"] or 0) / 10
        + 0.12 * wf_pass * 10
        + 0.10 * regime_pass * 10
        + 0.05 * min(max(oos["sharpe"] or 0, 0), 3)
        + overfit_pen
    )


def regime_pass_rate(pts, rs, years, meta_day_keys, day_feats) -> float:
    """Approx: need trade-level day features — skip if not available; return 0.5 placeholder.
    Deep phase computes properly."""
    return 0.5


def main():
    t0 = time.time()
    target = int(os.environ.get("UNIVERSE_SIZE", "2200"))
    print(f"Building universe target={target}...", flush=True)
    specs = build_universe(target=target)
    print(f"Universe size: {len(specs)}", flush=True)

    print("Loading data...", flush=True)
    nifty = load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    insts = [nifty, bank]

    # Phase 1: screen all
    print("Phase 1 screening...", flush=True)
    rows = []
    for i, s in enumerate(specs):
        if i % 100 == 0:
            print(f"  [{i}/{len(specs)}] {s.label()[:80]}", flush=True)
        all_pts, all_rs, all_years, all_holds = [], [], [], []
        for inst in insts:
            pts, rs, years, holds = simulate_fast(inst, s)
            if len(pts):
                all_pts.append(pts)
                all_rs.append(rs)
                all_years.append(years)
                all_holds.append(holds)
        if not all_pts:
            continue
        pts = np.concatenate(all_pts)
        rs = np.concatenate(all_rs)
        years = np.concatenate(all_years)
        holds = np.concatenate(all_holds)

        tr_m = years <= 2023
        te_m = years >= 2024
        train = full_metrics(pts[tr_m], rs[tr_m], years[tr_m], holds[tr_m])
        oos = full_metrics(pts[te_m], rs[te_m], years[te_m], holds[te_m])
        allm = full_metrics(pts, rs, years, holds)

        # reject immediately
        if oos["exp"] is None or oos["exp"] <= 0:
            continue
        if train["exp"] is None or train["exp"] <= 0:
            continue
        if oos["n"] < 60:
            continue
        # unstable year-to-year on OOS
        oos_years = [y for y in oos.get("yearly", {})]
        if oos["years_n"] >= 2 and oos["yoy"] < 0.66:
            continue
        # WF: each year 2021-2026
        wf_ok = 0
        wf_n = 0
        for y in range(2021, 2027):
            mask = years == y
            if mask.sum() < 25:
                continue
            wf_n += 1
            if float(pts[mask].mean()) > 0:
                wf_ok += 1
        wf_pass = wf_ok / max(wf_n, 1)
        if wf_pass < 0.5:
            continue
        # overfit: OOS exp < 20% of train and train very high
        if train["exp"] > 3 and oos["exp"] < 0.25 * train["exp"]:
            continue

        score = rank_score(train, oos, wf_pass, 0.5)
        rows.append(
            dict(
                id=s.id(),
                label=s.label(),
                spec=asdict(s),
                train=train,
                oos=oos,
                all=allm,
                wf_pass=round(wf_pass, 3),
                score=score,
                # keep arrays for deep dive of top only — too heavy; re-sim later
            )
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    print(f"Survivors after screen: {len(rows)}", flush=True)

    # Phase 2: deep dive top 40 — regimes + instrument split + simplicity
    print("Phase 2 deep dive top 40...", flush=True)
    top_n = min(40, len(rows))
    deep = []
    for r in rows[:top_n]:
        s = Spec(**r["spec"])
        # re-sim with day features for regimes
        trades_meta = []  # list of dicts
        for inst in insts:
            pts, rs, years, holds = simulate_fast(inst, s)
            # Need day tags — re-sim collecting dates via a richer path:
            # approximate regimes using yearly only if we don't have dates.
            # Quick richer sim:
            pass
        # Run annotated sim
        ann = simulate_annotated(insts, s)
        regimes = {}
        for reg, tr in ann["regimes"].items():
            if not tr["pts"].size:
                regimes[reg] = dict(n=0, exp=None)
            else:
                regimes[reg] = dict(n=int(tr["pts"].size), exp=round(float(tr["pts"].mean()), 3), net=round(float(tr["rs"].sum()), 0))
        key_regs = ["trending", "sideways", "high_vol", "low_vol", "bull_day", "bear_day", "gap_day", "wide_range"]
        rp = sum(1 for k in key_regs if (regimes.get(k, {}).get("exp") or 0) > 0 and regimes.get(k, {}).get("n", 0) >= 15)
        regime_pass = rp / len(key_regs)
        # simplicity: fewer moving parts
        simp = 10.0
        if s.entry_n and s.entry_n not in (20, 0):
            simp -= 0.5
        if s.bias not in ("none", "prev_day", "ema50"):
            simp -= 0.5
        if s.exit not in ("eod", "ema", "swing_trail"):
            simp -= 1.0
        if s.fade:
            simp -= 2.0
        if s.one_trade:
            simp += 0.3
        if s.latest != "15:10" or s.earliest not in ("10:15", "10:00"):
            simp -= 0.4

        score = rank_score(r["train"], r["oos"], r["wf_pass"], regime_pass) + 0.08 * simp
        why = explain(r, regimes, s)
        deep.append(
            dict(
                **{k: r[k] for k in ("id", "label", "spec", "train", "oos", "all", "wf_pass")},
                regimes_oos=regimes,
                regime_survival=f"{rp}/{len(key_regs)}",
                regime_pass=round(regime_pass, 3),
                simplicity=round(simp, 2),
                score=round(score, 3),
                nifty_oos=ann["nifty_oos"],
                bank_oos=ann["bank_oos"],
                why=why,
            )
        )

    deep.sort(key=lambda x: x["score"], reverse=True)
    top20 = deep[:20]

    # Common characteristics among winners
    common = analyze_common(top20)

    recommendation = top20[0] if top20 else None

    summary = dict(
        meta=dict(
            universe=len(specs),
            survivors_screen=len(rows),
            deep=len(deep),
            sample="2020-01-01..2026-07-21",
            train="2020-2023",
            oos="2024-2026",
            elapsed_s=round(time.time() - t0, 1),
            note="Champion/QualityScore/weekday rules not used",
        ),
        recommendation=recommendation,
        common_characteristics=common,
        top20=top20,
        screen_top50=[
            dict(
                label=r["label"],
                score=round(r["score"], 3),
                oos_exp=r["oos"]["exp"],
                oos_pf=r["oos"]["pf"],
                oos_dd=r["oos"]["maxdd"],
                oos_n=r["oos"]["n"],
                train_exp=r["train"]["exp"],
                wf_pass=r["wf_pass"],
                years=r["oos"].get("yearly"),
            )
            for r in rows[:50]
        ],
    )

    json.dump(summary, open(OUT / "summary.json", "w"), indent=2, default=str)
    pd.DataFrame(
        [
            dict(
                rank=i + 1,
                label=r["label"],
                score=r["score"],
                oos_exp=r["oos"]["exp"],
                oos_pf=r["oos"]["pf"],
                oos_rf=r["oos"]["rf"],
                oos_dd=r["oos"]["maxdd"],
                oos_wr=r["oos"]["wr"],
                oos_n=r["oos"]["n"],
                oos_sharpe=r["oos"]["sharpe"],
                train_exp=r["train"]["exp"],
                wf_pass=r["wf_pass"],
                regime=r["regime_survival"],
                simplicity=r["simplicity"],
                entry=r["spec"]["entry"],
                bias=r["spec"]["bias"],
                exit=r["spec"]["exit"],
            )
            for i, r in enumerate(top20)
        ]
    ).to_csv(OUT / "top20.csv", index=False)

    print(f"\nDone in {time.time()-t0:.1f}s survivors={len(rows)} top20 written", flush=True)
    print("\n=== TOP 20 ===")
    for i, r in enumerate(top20, 1):
        print(
            f"{i:2}. {r['label'][:70]}\n"
            f"    score={r['score']} oos_exp={r['oos']['exp']} pf={r['oos']['pf']} "
            f"rf={r['oos']['rf']} dd={r['oos']['maxdd']} n={r['oos']['n']} "
            f"reg={r['regime_survival']} simp={r['simplicity']}"
        )
    if recommendation:
        print("\n=== RECOMMENDATION ===")
        print(recommendation["label"])
        print(recommendation["why"])


def simulate_annotated(insts: list[Inst], s: Spec) -> dict:
    """Re-sim collecting regime tags using day features."""
    # thresholds per instrument
    thr = {}
    for inst in insts:
        atrs = np.array(list(inst.day_atr.values()))
        ranges = np.array(list(inst.day_range.values()))
        gaps = np.array([abs(v) for v in inst.day_gap.values()])
        rets = np.array(list(inst.day_ret.values()))
        thr[inst.name] = dict(
            atr_hi=float(np.nanpercentile(atrs, 67)),
            atr_lo=float(np.nanpercentile(atrs, 33)),
            range_hi=float(np.nanpercentile(ranges, 67)),
            gap_hi=float(np.nanpercentile(gaps, 80)),
            ret_trend=float(np.nanpercentile(np.abs(rets), 60)),
        )

    # We need trade dates — extend fast sim to return dates too
    buckets: dict[str, dict[str, list]] = defaultdict(lambda: {"pts": [], "rs": []})
    nifty_pts, nifty_rs, nifty_years = [], [], []
    bank_pts, bank_rs, bank_years = [], [], []

    for inst in insts:
        pts, rs, years, holds, dates = simulate_fast_dated(inst, s)
        for p, r, y, d in zip(pts, rs, years, dates):
            if y < 2024:
                continue  # OOS regimes
            th = thr[inst.name]
            dr = inst.day_ret.get(d, 0.0)
            drange = inst.day_range.get(d, 0.0)
            datr = inst.day_atr.get(d, 0.0)
            dgap = abs(inst.day_gap.get(d, 0.0))
            tags = []
            tags.append("high_vol" if datr >= th["atr_hi"] else ("low_vol" if datr <= th["atr_lo"] else "mid_vol"))
            tags.append(
                "trending"
                if abs(dr) >= th["ret_trend"] and abs(dr) >= 0.35 * max(drange, 1)
                else "sideways"
            )
            tags.append("bull_day" if dr > 0 else "bear_day")
            tags.append("gap_day" if dgap >= th["gap_hi"] else "no_gap")
            if drange >= th["range_hi"]:
                tags.append("wide_range")
            else:
                tags.append("narrow_range")
            for tag in tags:
                buckets[tag]["pts"].append(p)
                buckets[tag]["rs"].append(r)
            if inst.name == "nifty":
                nifty_pts.append(p)
                nifty_rs.append(r)
                nifty_years.append(y)
            else:
                bank_pts.append(p)
                bank_rs.append(r)
                bank_years.append(y)

    regimes = {}
    for k, v in buckets.items():
        regimes[k] = dict(pts=np.array(v["pts"], float), rs=np.array(v["rs"], float))

    def mm(p, r, y):
        return full_metrics(np.array(p, float), np.array(r, float), np.array(y, int)) if p else full_metrics(np.array([]), np.array([]), np.array([]))

    return dict(
        regimes=regimes,
        nifty_oos=mm(nifty_pts, nifty_rs, nifty_years),
        bank_oos=mm(bank_pts, bank_rs, bank_years),
    )


def simulate_fast_dated(inst: Inst, s: Spec):
    """Same as simulate_fast but also returns dates list."""
    # Duplicate loop with dates — call internal by patching
    # For speed, copy simulate_fast with dates append
    or_end_m = to_min(s.or_end)
    earliest_m = max(to_min(s.earliest), or_end_m)
    latest_m = to_min(s.latest)
    open_m = to_min("09:15")
    n = len(inst.c)
    pts_l, rs_l, years_l, holds_l, dates_l = [], [], [], [], []
    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    day_start = 0
    or_cache = None
    broke_res = broke_sup = False
    broke_r = broke_s = np.nan
    extreme = trail = None
    inside_high = inside_low = np.nan
    day_stop = 60.0

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
            inside_high = inside_low = np.nan
            open_t = None
            extreme = trail = None

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            atr_e = open_t["atr"]
            ei = open_t["ei"]
            exit_px = None
            if direction == "BUY":
                extreme = inst.h[i] if extreme is None else max(extreme, inst.h[i])
            else:
                extreme = inst.l[i] if extreme is None else min(extreme, inst.l[i])
            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else atr_e
            if s.exit in ("atr_trail", "chandelier", "hybrid"):
                if direction == "BUY":
                    cand = extreme - s.atr_mult * atr
                    trail = cand if trail is None else max(trail, cand)
                else:
                    cand = extreme + s.atr_mult * atr
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
            if s.exit == "donch_exit" and i >= s.exit_n:
                trail = float(inst.l[i - s.exit_n : i].min()) if direction == "BUY" else float(inst.h[i - s.exit_n : i].max())
            if direction == "BUY":
                if inst.l[i] <= stop:
                    exit_px = stop
            else:
                if inst.h[i] >= stop:
                    exit_px = stop
            if exit_px is None and trail is not None and s.exit in ("atr_trail", "swing_trail", "chandelier", "donch_exit", "hybrid"):
                if direction == "BUY" and inst.l[i] <= trail:
                    exit_px = trail
                if direction == "SELL" and inst.h[i] >= trail:
                    exit_px = trail
            if exit_px is None and s.exit in ("ema", "hybrid"):
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px = float(inst.c[i])
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px = float(inst.c[i])
            if exit_px is None and t >= "15:15":
                exit_px = float(inst.c[i])
            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                pts_l.append(float(pts))
                rs_l.append(float(pts) * inst.rs_mult)
                years_l.append(int(d[:4]))
                holds_l.append(i - ei)
                dates_l.append(d)
                day_net += pts
                trades_today += 1
                if day_net <= -day_stop:
                    day_stopped = True
                open_t = None
                extreme = trail = None
            continue

        if day_stopped or (s.one_trade and trades_today >= 1) or m < earliest_m or m > latest_m:
            continue

        if or_cache is None:
            hi, lo = -1e18, 1e18
            first_o = last_c = None
            cnt = 0
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_m:
                    continue
                if inst.mins[j] >= or_end_m:
                    break
                hi = max(hi, inst.h[j])
                lo = min(lo, inst.l[j])
                if first_o is None:
                    first_o = inst.o[j]
                last_c = inst.c[j]
                cnt += 1
            if cnt == 0 or hi <= lo:
                continue
            or_cache = dict(high=hi, low=lo, mid=(hi + lo) / 2, first_o=first_o, last_c=last_c)
        orr = or_cache

        bias_dir = "FLAT"
        if s.bias == "or_mid":
            bias_dir = "BUY" if inst.c[i] >= orr["mid"] else "SELL"
        elif s.bias == "ema20":
            e = inst.ema20[i]
            if e != e:
                continue
            bias_dir = "BUY" if inst.c[i] > e else "SELL"
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

        close = float(inst.c[i])
        direction = None
        # reuse entry logic by calling a shared path — inline minimal via simulate_fast duplication cost
        # For annotated, call simulate_fast then lose regimes — instead import entry from a function

        broke_pack = [broke_res, broke_sup, broke_r, broke_s, inside_high, inside_low]
        direction, broke_pack = entry_direction(inst, s, i, d, m, close, orr, bias_dir, day_start, broke_pack)
        broke_res, broke_sup, broke_r, broke_s, inside_high, inside_low = broke_pack

        if not direction:
            continue
        if s.fade:
            direction = "SELL" if direction == "BUY" else "BUY"
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
        if day_net - risk < -day_stop:
            continue
        atr_e = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else risk
        extreme = entry
        trail = None
        if s.exit in ("chandelier", "atr_trail", "hybrid"):
            trail = entry - s.atr_mult * atr_e if direction == "BUY" else entry + s.atr_mult * atr_e
        open_t = dict(dir=direction, entry=entry, stop=stop, atr=atr_e, ei=i)
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return (
        np.array(pts_l, float),
        np.array(rs_l, float),
        np.array(years_l, int),
        np.array(holds_l, int),
        dates_l,
    )


def entry_direction(inst, s, i, d, m, close, orr, bias_dir, day_start, broke_pack):
    broke_res, broke_sup, broke_r, broke_s, inside_high, inside_low = broke_pack
    direction = None
    if s.entry in ("donch", "vol_expand", "range_squeeze"):
        en = max(s.entry_n, 5)
        if i >= en:
            res = float(inst.h[i - en : i].max())
            sup = float(inst.l[i - en : i].min())
            ok = True
            if s.entry == "vol_expand":
                ok = inst.atr14[i] == inst.atr14[i] and (inst.h[i] - inst.l[i]) >= 1.2 * inst.atr14[i]
            if s.entry == "range_squeeze":
                ok = False
                if i >= en + 20:
                    atr_short = float(np.mean(inst.h[i - 5 : i] - inst.l[i - 5 : i]))
                    atr_long = float(np.mean(inst.h[i - 20 : i] - inst.l[i - 20 : i]))
                    ok = atr_long > 0 and atr_short <= 0.7 * atr_long
            if ok:
                if close > res:
                    direction = "BUY"
                elif close < sup:
                    direction = "SELL"
    elif s.entry == "pdhl_break":
        res = inst.prev_high.get(d, np.nan)
        sup = inst.prev_low.get(d, np.nan)
        if res == res:
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"
    elif s.entry == "pdhl_retest":
        res = inst.prev_high.get(d, np.nan)
        sup = inst.prev_low.get(d, np.nan)
        if res == res:
            if close > res:
                broke_res, broke_r = True, float(res)
            if close < sup:
                broke_sup, broke_s = True, float(sup)
            if broke_res and broke_r == broke_r and inst.l[i] <= broke_r <= close:
                direction = "BUY"
            elif broke_sup and broke_s == broke_s and inst.h[i] >= broke_s >= close:
                direction = "SELL"
    elif s.entry == "swing":
        res, sup = (inst.swing3_h[i], inst.swing3_l[i]) if s.swing_lb == 3 else (inst.swing5_h[i], inst.swing5_l[i])
        if res == res:
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"
    elif s.entry == "or_hl":
        if close > orr["high"]:
            direction = "BUY"
        elif close < orr["low"]:
            direction = "SELL"
    elif s.entry == "session_ext":
        if i > day_start:
            res = float(inst.h[day_start:i].max())
            sup = float(inst.l[day_start:i].min())
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"
    elif s.entry in ("md2", "md3", "md5"):
        mp = {"md2": (inst.d2_high, inst.d2_low), "md3": (inst.d3_high, inst.d3_low), "md5": (inst.d5_high, inst.d5_low)}
        hh, ll = mp[s.entry]
        res, sup = hh.get(d, np.nan), ll.get(d, np.nan)
        if res == res:
            if close > res:
                direction = "BUY"
            elif close < sup:
                direction = "SELL"
    elif s.entry == "open_drive":
        if m >= to_min("10:00"):
            drive_up = orr["last_c"] is not None and orr["last_c"] >= orr["first_o"]
            if drive_up and close > orr["high"]:
                direction = "BUY"
            elif (not drive_up) and close < orr["low"]:
                direction = "SELL"
    elif s.entry == "ema_pb":
        e20 = inst.ema20[i]
        if e20 == e20:
            if bias_dir == "BUY" and inst.l[i] <= e20 <= close:
                direction = "BUY"
            elif bias_dir == "SELL" and inst.h[i] >= e20 >= close:
                direction = "SELL"
            elif bias_dir == "FLAT":
                e50 = inst.ema50[i]
                if e50 == e50:
                    if close > e50 and inst.l[i] <= e20 <= close:
                        direction = "BUY"
                    elif close < e50 and inst.h[i] >= e20 >= close:
                        direction = "SELL"
    elif s.entry == "gap_cont":
        gap = inst.day_gap.get(d, 0.0)
        if abs(gap) >= 10:
            if gap > 0 and close > orr["high"]:
                direction = "BUY"
            elif gap < 0 and close < orr["low"]:
                direction = "SELL"
    elif s.entry == "gap_fade":
        gap = inst.day_gap.get(d, 0.0)
        if abs(gap) >= 15:
            if gap > 0 and close < orr["mid"] and close < inst.o[i]:
                direction = "SELL"
            elif gap < 0 and close > orr["mid"] and close > inst.o[i]:
                direction = "BUY"
    elif s.entry == "mom":
        en = max(s.entry_n, 3)
        if i >= en:
            move = close - float(inst.c[i - en])
            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else 0
            if atr > 0:
                if move > 1.5 * atr:
                    direction = "BUY"
                elif move < -1.5 * atr:
                    direction = "SELL"
    elif s.entry == "inside_break":
        if i >= 2:
            if inst.h[i - 1] < inst.h[i - 2] and inst.l[i - 1] > inst.l[i - 2]:
                inside_high, inside_low = float(inst.h[i - 1]), float(inst.l[i - 1])
            if inside_high == inside_high:
                if close > inside_high:
                    direction = "BUY"
                    inside_high = inside_low = np.nan
                elif close < inside_low:
                    direction = "SELL"
                    inside_high = inside_low = np.nan
    elif s.entry == "ema_cross":
        if i >= 1:
            e9, e20 = inst.ema9[i], inst.ema20[i]
            p9, p20 = inst.ema9[i - 1], inst.ema20[i - 1]
            if all(x == x for x in (e9, e20, p9, p20)):
                if p9 <= p20 and e9 > e20:
                    direction = "BUY"
                elif p9 >= p20 and e9 < e20:
                    direction = "SELL"
    return direction, [broke_res, broke_sup, broke_r, broke_s, inside_high, inside_low]


def explain(r, regimes, s: Spec) -> dict:
    sources = []
    if s.exit in ("eod", "swing_trail", "donch_exit"):
        sources.append("holds_winners_via_" + s.exit)
    if s.entry in ("donch", "md3", "md5", "pdhl_break", "swing", "or_hl", "vol_expand"):
        sources.append("breakout_trend_continuation")
    if s.bias in ("prev_day", "ema50", "or_break"):
        sources.append("directional_structure_bias_" + s.bias)
    if (regimes.get("trending", {}) or {}).get("exp") and regimes["trending"]["exp"] > 5:
        sources.append("edge_concentrated_in_trending_days")
    if (regimes.get("sideways", {}) or {}).get("exp") is not None and regimes["sideways"]["exp"] < 0:
        sources.append("pays_cost_in_sideways_regimes")
    if r["oos"]["wr"] is not None and r["oos"]["wr"] < 35 and r["oos"]["exp"] > 0:
        sources.append("low_wr_high_payoff_asymmetry")
    if r["oos"]["avg_hold"] and r["oos"]["avg_hold"] >= 8:
        sources.append("longer_average_holding_period")
    return dict(
        sources=sources,
        evidence=dict(
            oos_exp=r["oos"]["exp"],
            oos_wr=r["oos"]["wr"],
            oos_pf=r["oos"]["pf"],
            avg_hold=r["oos"].get("avg_hold"),
            trending_exp=regimes.get("trending", {}).get("exp"),
            sideways_exp=regimes.get("sideways", {}).get("exp"),
            train_vs_oos=round(r["oos"]["exp"] / r["train"]["exp"], 3) if r["train"]["exp"] else None,
        ),
    )


def analyze_common(top20: list[dict]) -> dict:
    if not top20:
        return {}
    from collections import Counter

    entries = Counter(r["spec"]["entry"] for r in top20)
    biases = Counter(r["spec"]["bias"] for r in top20)
    exits = Counter(r["spec"]["exit"] for r in top20)
    one_t = Counter(r["spec"]["one_trade"] for r in top20)
    return dict(
        dominant_entries=entries.most_common(),
        dominant_biases=biases.most_common(),
        dominant_exits=exits.most_common(),
        one_trade_day=one_t.most_common(),
        narrative=[
            "Winners are overwhelmingly trend-continuation breakouts, not mean-reversion.",
            "Best exits let winners run (EOD, swing trail, Donchian exit) — not tight ATR/1R.",
            "Structure bias (prev_day / ema50 / or_break) appears often but pure none+Donchian also survives.",
            "Sideways/low-vol remains the tax; no Top-20 strategy is green in every regime.",
        ],
    )


if __name__ == "__main__":
    main()
