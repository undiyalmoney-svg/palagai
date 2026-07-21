#!/usr/bin/env python3
"""
Entry expectancy discovery — multi-year, pre-filter.

Question: which entry+structure+exit concepts have positive expectancy
on long history BEFORE any quality score / weekday overlay?

Uses Kite 5m caches. Research only — does not change live DNA.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass
from itertools import product
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PALAGAI_CACHE", ROOT / "reports" / "analyst-cache"))
OUT_JSON = Path(os.environ.get("PALAGAI_OUT_JSON", "/tmp/entry-expectancy-discovery.json"))
OUT_CSV = Path(os.environ.get("PALAGAI_OUT_CSV", "/tmp/entry-expectancy-discovery.csv"))
REPORT_MD = ROOT / "docs" / "owner-private" / "13-ENTRY-EXPECTANCY-DISCOVERY.md"

TRAIN_YEARS = {2020, 2021, 2022, 2023}
TEST_YEARS = {2024, 2025, 2026}


def hhmm(iso: str) -> str:
    return iso[11:16]


def day(iso: str) -> str:
    return iso[:10]


def to_minutes(hh: str) -> int:
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
    cur_h = np.nan
    cur_l = np.nan
    max_confirm = n - lookback
    for i in range(lookback, max_confirm):
        h = high[i]
        l = low[i]
        is_h = True
        is_l = True
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


@dataclass(frozen=True)
class Concept:
    name: str
    family: str
    or_end: str  # HH:MM exclusive end of opening range
    bias: str  # or_mid | ema50 | prev_day | none | or_break
    trigger: str  # swing3|swing5|or_hl|pdhl|donch20|session_ext
    entry: str  # breakout|retest|ema20_pb|fade_or
    exit_mode: str  # champ|r15_eod|r2_eod|ema_only|eod_only|trail_swing
    earliest: str = "10:15"  # or after OR
    latest: str = "15:10"
    day_stop: float | None = 60.0
    one_trade_day: bool = False


@dataclass
class InstData:
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
    mins: np.ndarray
    ema20: np.ndarray
    ema50: np.ndarray
    swing3_h: np.ndarray
    swing3_l: np.ndarray
    swing5_h: np.ndarray
    swing5_l: np.ndarray
    atr14: np.ndarray
    # day index boundaries
    day_starts: dict[str, int]
    day_ends: dict[str, int]
    prev_day_close: dict[str, float]
    prev_day_high: dict[str, float]
    prev_day_low: dict[str, float]


def load_inst(path: Path, name: str, max_stop: float, rs_mult: float) -> InstData:
    candles = json.load(open(path))
    o = np.array([x["open"] for x in candles], float)
    h = np.array([x["high"] for x in candles], float)
    l = np.array([x["low"] for x in candles], float)
    c = np.array([x["close"] for x in candles], float)
    dates = [x["date"] for x in candles]
    times = [hhmm(d) for d in dates]
    days = [day(d) for d in dates]
    years = np.array([int(d[:4]) for d in days])
    mins = np.array([to_minutes(t) for t in times])
    print(f"  indicators {name} n={len(c)}...", flush=True)
    ema20 = ema_arr(c, 20)
    ema50 = ema_arr(c, 50)
    swing3_h, swing3_l = precompute_swings(h, l, 3)
    swing5_h, swing5_l = precompute_swings(h, l, 5)
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

    uniq_days = sorted(day_starts.keys())
    prev_close: dict[str, float] = {}
    prev_high: dict[str, float] = {}
    prev_low: dict[str, float] = {}
    for i, d in enumerate(uniq_days):
        if i == 0:
            continue
        pd_ = uniq_days[i - 1]
        a, b = day_starts[pd_], day_ends[pd_]
        prev_close[d] = float(c[b])
        prev_high[d] = float(h[a : b + 1].max())
        prev_low[d] = float(l[a : b + 1].min())

    return InstData(
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
        mins=mins,
        ema20=ema20,
        ema50=ema50,
        swing3_h=swing3_h,
        swing3_l=swing3_l,
        swing5_h=swing5_h,
        swing5_l=swing5_l,
        atr14=atr14,
        day_starts=day_starts,
        day_ends=day_ends,
        prev_day_close=prev_close,
        prev_day_high=prev_high,
        prev_day_low=prev_low,
    )


def path_metrics(pts: list[float], rs: list[float]) -> dict:
    if not pts:
        return dict(n=0, wr=None, avg=None, net_pts=None, net_rs=None, maxdd_rs=None, expectancy=None)
    p = np.array(pts)
    r = np.array(rs)
    eq = np.cumsum(r)
    peak = np.maximum.accumulate(eq)
    dd = float((eq - peak).min())
    return dict(
        n=int(len(p)),
        wr=round(float((p > 0).mean() * 100), 1),
        avg=round(float(p.mean()), 3),
        net_pts=round(float(p.sum()), 1),
        net_rs=round(float(r.sum()), 0),
        maxdd_rs=round(dd, 0),
        expectancy=round(float(p.mean()), 3),
    )


def simulate(inst: InstData, concept: Concept) -> tuple[list[float], list[float], list[int]]:
    """Return pts, rs, years for each closed trade."""
    or_end_m = to_minutes(concept.or_end)
    # earliest: max(concept.earliest, or_end)
    earliest_m = max(to_minutes(concept.earliest), or_end_m)
    latest_m = to_minutes(concept.latest)
    open_start_m = to_minutes("09:15")

    pts_out: list[float] = []
    rs_out: list[float] = []
    years_out: list[int] = []

    n = len(inst.c)
    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    day_start = 0
    or_cache = None
    # retest state: level broken then waiting for retest
    broke_res = False
    broke_sup = False
    broke_level_r = np.nan
    broke_level_s = np.nan
    # trail
    trail_stop = None

    for i in range(80, n):
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
            broke_level_r = broke_level_s = np.nan
            # if somehow overnight open (shouldn't), clear
            if open_t is not None:
                # force flat at prior close already handled by EOD
                open_t = None
            trail_stop = None

        # --- manage open ---
        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t.get("target")
            exit_px = None
            reason = ""

            if concept.exit_mode == "trail_swing":
                # update trail
                if direction == "BUY":
                    sh = inst.swing3_l[i]
                    if sh == sh:
                        trail_stop = max(stop if trail_stop is None else trail_stop, float(sh))
                    stop_use = trail_stop if trail_stop is not None else stop
                    if inst.l[i] <= stop_use:
                        exit_px, reason = stop_use, "TRAIL"
                    elif target is not None and inst.h[i] >= target:
                        exit_px, reason = target, "TP"
                else:
                    sh = inst.swing3_h[i]
                    if sh == sh:
                        trail_stop = min(stop if trail_stop is None else trail_stop, float(sh))
                    stop_use = trail_stop if trail_stop is not None else stop
                    if inst.h[i] >= stop_use:
                        exit_px, reason = stop_use, "TRAIL"
                    elif target is not None and inst.l[i] <= target:
                        exit_px, reason = target, "TP"
            else:
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

            if exit_px is None and concept.exit_mode in ("champ", "ema_only"):
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px, reason = float(inst.c[i]), "EMA20"
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px, reason = float(inst.c[i]), "EMA20"

            if exit_px is None and t >= "15:15":
                exit_px, reason = float(inst.c[i]), "CLOSE"

            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                pts_out.append(float(pts))
                rs_out.append(float(pts) * inst.rs_mult)
                years_out.append(int(d[:4]))
                day_net += pts
                trades_today += 1
                if concept.day_stop is not None and day_net <= -concept.day_stop:
                    day_stopped = True
                open_t = None
                trail_stop = None
            continue

        if day_stopped:
            continue
        if concept.one_trade_day and trades_today >= 1:
            continue
        if m < earliest_m or m > latest_m:
            continue

        # opening range
        if or_cache is None:
            hi, lo = -1e18, 1e18
            first_o = last_c = None
            cnt = 0
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_start_m:
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
            or_cache = dict(high=hi, low=lo, mid=(hi + lo) / 2, width=hi - lo, close=last_c)
        orr = or_cache

        # levels by trigger
        if concept.trigger == "swing3":
            res, sup = inst.swing3_h[i], inst.swing3_l[i]
        elif concept.trigger == "swing5":
            res, sup = inst.swing5_h[i], inst.swing5_l[i]
        elif concept.trigger == "or_hl":
            res, sup = orr["high"], orr["low"]
        elif concept.trigger == "pdhl":
            res = inst.prev_day_high.get(d, np.nan)
            sup = inst.prev_day_low.get(d, np.nan)
        elif concept.trigger == "donch20":
            if i < 20:
                continue
            res = float(inst.h[i - 20 : i].max())
            sup = float(inst.l[i - 20 : i].min())
        elif concept.trigger == "session_ext":
            # running session high/low excluding current bar
            res = float(inst.h[day_start:i].max()) if i > day_start else np.nan
            sup = float(inst.l[day_start:i].min()) if i > day_start else np.nan
        else:
            continue
        if res != res or sup != sup:
            continue

        # bias
        bias_dir = None
        if concept.bias == "or_mid":
            bias_dir = "BUY" if inst.c[i] >= orr["mid"] else "SELL"
        elif concept.bias == "ema50":
            e = inst.ema50[i]
            if e != e:
                continue
            bias_dir = "BUY" if inst.c[i] > e else "SELL"
        elif concept.bias == "prev_day":
            pc = inst.prev_day_close.get(d)
            if pc is None:
                continue
            bias_dir = "BUY" if inst.c[i] >= pc else "SELL"
        elif concept.bias == "or_break":
            # only trade in direction of OR break already happened
            if inst.c[i] > orr["high"]:
                bias_dir = "BUY"
            elif inst.c[i] < orr["low"]:
                bias_dir = "SELL"
            else:
                continue
        elif concept.bias == "none":
            bias_dir = "FLAT"
        else:
            continue

        close = float(inst.c[i])
        direction = None

        if concept.entry == "breakout":
            if bias_dir in ("BUY", "FLAT") and close > res:
                direction = "BUY"
            elif bias_dir in ("SELL", "FLAT") and close < sup:
                direction = "SELL"
        elif concept.entry == "retest":
            # mark break, enter on reclaim after touch
            if close > res:
                broke_res, broke_level_r = True, float(res)
            if close < sup:
                broke_sup, broke_level_s = True, float(sup)
            if bias_dir in ("BUY", "FLAT") and broke_res and broke_level_r == broke_level_r:
                if inst.l[i] <= broke_level_r <= close:
                    direction = "BUY"
            if direction is None and bias_dir in ("SELL", "FLAT") and broke_sup and broke_level_s == broke_level_s:
                if inst.h[i] >= broke_level_s >= close:
                    direction = "SELL"
        elif concept.entry == "ema20_pb":
            e20 = inst.ema20[i]
            if e20 != e20:
                continue
            if bias_dir == "BUY" and inst.l[i] <= e20 <= close:
                direction = "BUY"
            elif bias_dir == "SELL" and inst.h[i] >= e20 >= close:
                direction = "SELL"
        elif concept.entry == "fade_or":
            # mean reversion: fade OR extreme back to mid
            if close > orr["high"] and close < inst.o[i]:  # rejection above OR
                direction = "SELL"
            elif close < orr["low"] and close > inst.o[i]:
                direction = "BUY"
            if concept.bias == "or_mid":
                # only fade against stretch from mid
                pass
            elif concept.bias not in ("none", "FLAT") and bias_dir not in ("FLAT", None):
                # if directional bias set, require fade with bias (continuation fade weird) — skip mismatch
                if direction and direction != bias_dir and concept.bias != "none":
                    # for fade, ignore trend bias mismatch unless none
                    if concept.bias != "none":
                        direction = None
        else:
            continue

        if not direction:
            continue
        # enforce bias unless none/flat
        if bias_dir in ("BUY", "SELL") and direction != bias_dir and concept.entry != "fade_or":
            continue

        entry = close
        stop = float(inst.l[i] if direction == "BUY" else inst.h[i])
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if concept.day_stop is not None and day_net - risk < -concept.day_stop:
            continue

        # targets by exit mode
        target = None
        rr = None
        if concept.exit_mode == "champ":
            rr = 1.0
        elif concept.exit_mode == "r15_eod":
            rr = 1.5
        elif concept.exit_mode == "r2_eod":
            rr = 2.0
        elif concept.exit_mode == "trail_swing":
            rr = 2.0  # soft ceiling
        elif concept.exit_mode in ("ema_only", "eod_only"):
            rr = None
        if rr is not None:
            target = entry + risk * rr if direction == "BUY" else entry - risk * rr

        open_t = dict(dir=direction, entry=entry, stop=stop, target=target)
        trail_stop = stop if concept.exit_mode == "trail_swing" else None
        # consume break flags on entry
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return pts_out, rs_out, years_out


def split_metrics(pts, rs, years):
    tr_p, tr_r, te_p, te_r = [], [], [], []
    for p, r, y in zip(pts, rs, years):
        if y in TRAIN_YEARS:
            tr_p.append(p)
            tr_r.append(r)
        elif y in TEST_YEARS:
            te_p.append(p)
            te_r.append(r)
    return path_metrics(tr_p, tr_r), path_metrics(te_p, te_r), path_metrics(pts, rs)


def build_concepts() -> list[Concept]:
    concepts: list[Concept] = []

    # --- A. Champion baseline (no weekday delay) ---
    concepts.append(
        Concept(
            "champion_or_swing3_break_champ_exit",
            "baseline",
            "10:15",
            "or_mid",
            "swing3",
            "breakout",
            "champ",
        )
    )

    # --- B. Structure / bias variants (champion trigger+exit) ---
    for bias in ["or_mid", "ema50", "prev_day", "or_break", "none"]:
        concepts.append(
            Concept(
                f"bias_{bias}__swing3_break_champ",
                "structure",
                "10:15",
                bias,
                "swing3",
                "breakout",
                "champ",
            )
        )

    # --- C. Breakout definitions ---
    for trig in ["swing3", "swing5", "or_hl", "pdhl", "donch20", "session_ext"]:
        concepts.append(
            Concept(
                f"trig_{trig}__or_mid_break_champ",
                "breakout_def",
                "10:15",
                "or_mid",
                trig,
                "breakout",
                "champ",
            )
        )

    # --- D. OR window length ---
    for or_end, earliest in [("09:45", "09:45"), ("10:00", "10:00"), ("10:15", "10:15"), ("10:45", "10:45")]:
        concepts.append(
            Concept(
                f"or_end_{or_end.replace(':','')}__swing3_break_champ",
                "or_window",
                or_end,
                "or_mid",
                "swing3",
                "breakout",
                "champ",
                earliest=earliest,
            )
        )

    # --- E. Entry styles ---
    for entry in ["breakout", "retest", "ema20_pb", "fade_or"]:
        for bias in ["or_mid", "ema50", "none"]:
            concepts.append(
                Concept(
                    f"entry_{entry}__bias_{bias}_swing3_champ",
                    "entry_style",
                    "10:15",
                    bias if entry != "fade_or" else "none",
                    "swing3" if entry != "fade_or" else "or_hl",
                    entry,
                    "champ",
                )
            )

    # --- F. Exit logic (champion entry) ---
    for ex in ["champ", "r15_eod", "r2_eod", "ema_only", "eod_only", "trail_swing"]:
        concepts.append(
            Concept(
                f"exit_{ex}__or_swing3_break",
                "exit",
                "10:15",
                "or_mid",
                "swing3",
                "breakout",
                ex,
            )
        )

    # --- G. Coherent new concepts (stories) ---
    stories = [
        Concept("story_or_break_then_ema_pb", "story", "10:15", "or_break", "or_hl", "ema20_pb", "champ"),
        Concept("story_or_hl_break_champ", "story", "10:15", "or_mid", "or_hl", "breakout", "champ"),
        Concept("story_or_hl_retest_champ", "story", "10:15", "or_break", "or_hl", "retest", "champ"),
        Concept("story_pdhl_break_ema50", "story", "10:15", "ema50", "pdhl", "breakout", "champ"),
        Concept("story_donch20_ema50_r15", "story", "10:00", "ema50", "donch20", "breakout", "r15_eod"),
        Concept("story_swing5_prevday_ema", "story", "10:15", "prev_day", "swing5", "breakout", "ema_only"),
        Concept("story_session_ext_or_break_trail", "story", "10:15", "or_break", "session_ext", "breakout", "trail_swing"),
        Concept("story_fade_or_eod", "story", "10:15", "none", "or_hl", "fade_or", "eod_only"),
        Concept("story_fade_or_champ", "story", "10:15", "none", "or_hl", "fade_or", "champ"),
        Concept("story_ema50_ema_pb_champ", "story", "10:15", "ema50", "swing3", "ema20_pb", "champ"),
        Concept("story_or45_swing_break_champ", "story", "10:00", "or_mid", "swing3", "breakout", "champ", earliest="10:00"),
        Concept("story_or30_orhl_break_r2", "story", "09:45", "or_mid", "or_hl", "breakout", "r2_eod", earliest="09:45"),
        Concept("story_one_trade_or_swing_champ", "story", "10:15", "or_mid", "swing3", "breakout", "champ", one_trade_day=True),
        Concept("story_no_daystop_or_swing_champ", "story", "10:15", "or_mid", "swing3", "breakout", "champ", day_stop=None),
        Concept("story_late_only_1300_or_swing", "story", "10:15", "or_mid", "swing3", "breakout", "champ", earliest="13:00"),
        Concept("story_morning_only_1015_1200", "story", "10:15", "or_mid", "swing3", "breakout", "champ", earliest="10:15", latest="12:00"),
        Concept("story_pdhl_retest_prevday", "story", "10:15", "prev_day", "pdhl", "retest", "champ"),
        Concept("story_donch20_none_eod", "story", "10:15", "none", "donch20", "breakout", "eod_only"),
        Concept("story_swing3_none_trail", "story", "10:15", "none", "swing3", "breakout", "trail_swing"),
        Concept("story_or_break_swing_retest_r15", "story", "10:15", "or_break", "swing3", "retest", "r15_eod"),
    ]
    concepts.extend(stories)

    # --- H. Cross product of promising axes (bounded) ---
    for bias, trig, entry, ex in product(
        ["or_mid", "ema50", "or_break"],
        ["swing3", "or_hl", "pdhl"],
        ["breakout", "retest"],
        ["champ", "ema_only", "r15_eod"],
    ):
        name = f"cross_{bias}_{trig}_{entry}_{ex}"
        concepts.append(Concept(name, "cross", "10:15", bias, trig, entry, ex))

    # dedupe by name
    seen = set()
    uniq = []
    for c in concepts:
        if c.name in seen:
            continue
        seen.add(c.name)
        uniq.append(c)
    return uniq


def rank_key(row: dict) -> tuple:
    """Prefer positive OOS expectancy, then stability, then sample size."""
    te = row["test"]
    tr = row["train"]
    te_avg = te["avg"] if te["avg"] is not None else -999
    tr_avg = tr["avg"] if tr["avg"] is not None else -999
    te_n = te["n"]
    both_pos = 1 if te_avg > 0 and tr_avg > 0 else 0
    return (both_pos, te_avg, tr_avg, te_n)


def main():
    t0 = time.time()
    print("Loading instruments...", flush=True)
    nifty = load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    concepts = build_concepts()
    print(f"Concepts to test: {len(concepts)}", flush=True)

    rows = []
    for i, concept in enumerate(concepts):
        if i % 20 == 0:
            print(f"  [{i}/{len(concepts)}] {concept.name}", flush=True)
        # per instrument + combined
        inst_results = {}
        all_pts, all_rs, all_years = [], [], []
        for inst in (nifty, bank):
            pts, rs, years = simulate(inst, concept)
            tr, te, al = split_metrics(pts, rs, years)
            inst_results[inst.name] = dict(train=tr, test=te, all=al)
            all_pts.extend(pts)
            all_rs.extend(rs)
            all_years.extend(years)
        tr, te, al = split_metrics(all_pts, all_rs, all_years)
        row = dict(
            name=concept.name,
            family=concept.family,
            concept=asdict(concept),
            combined=dict(train=tr, test=te, all=al),
            nifty=inst_results["nifty"],
            bank=inst_results["bank"],
        )
        # flags
        te_avg = te["avg"] if te["avg"] is not None else None
        tr_avg = tr["avg"] if tr["avg"] is not None else None
        row["flags"] = dict(
            test_pos=bool(te_avg is not None and te_avg > 0),
            train_pos=bool(tr_avg is not None and tr_avg > 0),
            both_pos=bool(te_avg is not None and tr_avg is not None and te_avg > 0 and tr_avg > 0),
            test_n_ok=bool(te["n"] >= 80),
            nifty_test_pos=bool(
                inst_results["nifty"]["test"]["avg"] is not None
                and inst_results["nifty"]["test"]["avg"] > 0
            ),
            bank_test_pos=bool(
                inst_results["bank"]["test"]["avg"] is not None
                and inst_results["bank"]["test"]["avg"] > 0
            ),
        )
        rows.append(row)

    rows_sorted = sorted(rows, key=lambda r: rank_key({**r, "test": r["combined"]["test"], "train": r["combined"]["train"]}), reverse=True)

    both = [r for r in rows_sorted if r["flags"]["both_pos"] and r["flags"]["test_n_ok"]]
    test_only = [r for r in rows_sorted if r["flags"]["test_pos"] and r["flags"]["test_n_ok"]]
    baseline = next(r for r in rows if r["name"].startswith("champion_"))

    summary = dict(
        sample="2020-01-01..2026-07-21 Kite 5m",
        train="2020-2023",
        test="2024-2026",
        n_concepts=len(concepts),
        n_both_pos_oos=len(both),
        n_test_pos=len(test_only),
        baseline=dict(
            name=baseline["name"],
            train=baseline["combined"]["train"],
            test=baseline["combined"]["test"],
        ),
        top_both_pos=[
            dict(
                name=r["name"],
                family=r["family"],
                train=r["combined"]["train"],
                test=r["combined"]["test"],
                nifty_test=r["nifty"]["test"],
                bank_test=r["bank"]["test"],
                concept=r["concept"],
            )
            for r in both[:25]
        ],
        top_test_pos=[
            dict(
                name=r["name"],
                family=r["family"],
                train=r["combined"]["train"],
                test=r["combined"]["test"],
                flags=r["flags"],
            )
            for r in test_only[:25]
        ],
        best_by_family={},
        elapsed_s=round(time.time() - t0, 1),
    )

    for fam in sorted(set(r["family"] for r in rows)):
        cand = [r for r in rows if r["family"] == fam and r["combined"]["test"]["n"] >= 50]
        if not cand:
            continue
        best = max(cand, key=lambda r: (r["combined"]["test"]["avg"] or -999))
        summary["best_by_family"][fam] = dict(
            name=best["name"],
            train=best["combined"]["train"],
            test=best["combined"]["test"],
            concept=best["concept"],
        )

    # instrument-specific both-pos
    for inst_key in ("nifty", "bank"):
        hits = []
        for r in rows:
            tr = r[inst_key]["train"]
            te = r[inst_key]["test"]
            if (
                te["avg"] is not None
                and tr["avg"] is not None
                and te["avg"] > 0
                and tr["avg"] > 0
                and te["n"] >= 40
            ):
                hits.append(
                    dict(
                        name=r["name"],
                        family=r["family"],
                        train=tr,
                        test=te,
                        concept=r["concept"],
                    )
                )
        hits.sort(key=lambda x: x["test"]["avg"], reverse=True)
        summary[f"top_both_pos_{inst_key}"] = hits[:15]

    json.dump(dict(summary=summary, all_rows=rows_sorted), open(OUT_JSON, "w"), indent=2, default=str)

    # CSV flat
    flat = []
    for r in rows_sorted:
        flat.append(
            dict(
                name=r["name"],
                family=r["family"],
                train_n=r["combined"]["train"]["n"],
                train_avg=r["combined"]["train"]["avg"],
                train_wr=r["combined"]["train"]["wr"],
                train_net_rs=r["combined"]["train"]["net_rs"],
                test_n=r["combined"]["test"]["n"],
                test_avg=r["combined"]["test"]["avg"],
                test_wr=r["combined"]["test"]["wr"],
                test_net_rs=r["combined"]["test"]["net_rs"],
                test_dd=r["combined"]["test"]["maxdd_rs"],
                both_pos=r["flags"]["both_pos"],
                nifty_test_avg=r["nifty"]["test"]["avg"],
                bank_test_avg=r["bank"]["test"]["avg"],
                bias=r["concept"]["bias"],
                trigger=r["concept"]["trigger"],
                entry=r["concept"]["entry"],
                exit_mode=r["concept"]["exit_mode"],
                or_end=r["concept"]["or_end"],
            )
        )
    pd.DataFrame(flat).to_csv(OUT_CSV, index=False)

    print(f"\nWrote {OUT_JSON} and {OUT_CSV} in {time.time()-t0:.1f}s", flush=True)
    print(f"Both-pos (train+test, n_test>=80): {len(both)}", flush=True)
    print(f"Test-pos only: {len(test_only)}", flush=True)
    print("\n=== BASELINE ===", baseline["name"], baseline["combined"]["train"], baseline["combined"]["test"])
    print("\n=== TOP BOTH-POS ===")
    for r in both[:15]:
        print(
            r["name"],
            "train",
            r["combined"]["train"]["avg"],
            r["combined"]["train"]["n"],
            "test",
            r["combined"]["test"]["avg"],
            r["combined"]["test"]["n"],
            r["combined"]["test"]["net_rs"],
        )
    print("\n=== BEST BY FAMILY ===")
    for fam, b in summary["best_by_family"].items():
        print(fam, b["name"], "test_avg", b["test"]["avg"], "n", b["test"]["n"])
    print("\n=== TOP NIFTY BOTH-POS ===")
    for r in summary["top_both_pos_nifty"][:8]:
        print(r["name"], r["test"]["avg"], r["test"]["n"], r["test"]["net_rs"])
    print("\n=== TOP BANK BOTH-POS ===")
    for r in summary["top_both_pos_bank"][:8]:
        print(r["name"], r["test"]["avg"], r["test"]["n"], r["test"]["net_rs"])


if __name__ == "__main__":
    main()
