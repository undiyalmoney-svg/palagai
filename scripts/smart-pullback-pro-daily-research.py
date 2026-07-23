#!/usr/bin/env python3
"""
Smart Pullback PRO — daily ₹ research (Nifty 1 lot + Bank 1 lot).

Thesis (owner): Pine "Smart Pull back PRO" fires many BUY/SELL labels;
the edge is *which* entries + *when* to exit for ₹500–₹5000/day.

Data priority:
  1. Kite cache `reports/analyst-cache/nifty-5m-2020-2026.json` (+ bank) if present
     → OOS calendar 2024+ is the truth check (see docs/owner-private/27-*.md)
  2. Else Yahoo ^NSEI / ^NSEBANK 5m (~60d) + 60m (~2y) probe

Book: Nifty ₹65/pt · Bank ₹30/pt · day stop 60 pts/instrument.

Outputs: /tmp/smart-pb-pro/summary.json (+ /tmp/smart-pb-kite/ when using Kite).
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import numpy as np

OUT = Path("/tmp/smart-pb-pro")
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / "yahoo"
CACHE.mkdir(exist_ok=True)

# Futures point value (index research proxy used across this repo)
RS = {"nifty": 65.0, "bank": 30.0}
MAX_STOP = {"nifty": 30.0, "bank": 45.0}
DAY_STOP = 60.0
OOS_60M = "2024-01-01"


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def ema_arr(closes: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(closes), np.nan)
    if len(closes) < period:
        return out
    k = 2 / (period + 1)
    ema = float(closes[:period].mean())
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = float(closes[i]) * k + ema * (1 - k)
        out[i] = ema
    return out


def yahoo_chart(symbol: str, interval: str, range_: str) -> list[dict]:
    key = f"{symbol.replace('^', '')}_{interval}_{range_}.json"
    path = CACHE / key
    if path.exists():
        raw = json.loads(path.read_text())
    else:
        url = (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            + urllib.parse.quote(symbol)
            + f"?interval={interval}&range={range_}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = json.load(r)
                break
            except Exception as e:
                wait = 2**attempt
                print(f"  yahoo retry {symbol} {interval}: {e} sleep {wait}", flush=True)
                time.sleep(wait)
        else:
            raise RuntimeError(f"yahoo failed {symbol} {interval}")
        path.write_text(json.dumps(raw))
        time.sleep(0.35)

    result = (raw.get("chart") or {}).get("result") or []
    if not result:
        return []
    r0 = result[0]
    ts = r0.get("timestamp") or []
    q0 = ((r0.get("indicators") or {}).get("quote") or [{}])[0]
    out: list[dict] = []
    for i, t in enumerate(ts):
        o, h, l, c = q0["open"][i], q0["high"][i], q0["low"][i], q0["close"][i]
        if None in (o, h, l, c):
            continue
        # Yahoo index stamps are UTC; NSE session ≈ UTC+5:30
        ist = time.gmtime(t + int(5.5 * 3600))
        date = time.strftime("%Y-%m-%d %H:%M:%S", ist)
        out.append(
            {
                "date": date,
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
            }
        )
    return out


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
    mins: np.ndarray
    ema50: np.ndarray
    atr14: np.ndarray
    atr_sma20: np.ndarray
    body: np.ndarray
    avg_body10: np.ndarray
    day_starts: dict[str, int]


def build_inst(name: str, candles: list[dict]) -> Inst:
    o = np.array([x["open"] for x in candles], float)
    h = np.array([x["high"] for x in candles], float)
    l = np.array([x["low"] for x in candles], float)
    c = np.array([x["close"] for x in candles], float)
    dates = [x["date"] for x in candles]
    times = [d[11:16] for d in dates]
    days = [d[:10] for d in dates]
    mins = np.array([to_min(t) for t in times])
    ema50 = ema_arr(c, 50)
    body = np.abs(c - o)
    avg_body10 = np.full(len(c), np.nan)
    for i in range(9, len(c)):
        avg_body10[i] = body[i - 9 : i + 1].mean()

    # True ATR(14) then SMA(20) of ATR — Pine ta.atr / ta.sma(atr,20)
    tr = np.full(len(c), np.nan)
    for i in range(1, len(c)):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    atr14 = np.full(len(c), np.nan)
    for i in range(14, len(c)):
        atr14[i] = np.nanmean(tr[i - 13 : i + 1])
    atr_sma20 = np.full(len(c), np.nan)
    for i in range(len(c)):
        if i >= 33 and atr14[i] == atr14[i]:
            atr_sma20[i] = np.nanmean(atr14[i - 19 : i + 1])

    day_starts: dict[str, int] = {}
    for i, d in enumerate(days):
        if d not in day_starts:
            day_starts[d] = i

    print(f"  build {name} n={len(c)} days={len(day_starts)}", flush=True)
    return Inst(
        name=name,
        max_stop=MAX_STOP[name],
        rs_mult=RS[name],
        o=o,
        h=h,
        l=l,
        c=c,
        times=times,
        days=days,
        mins=mins,
        ema50=ema50,
        atr14=atr14,
        atr_sma20=atr_sma20,
        body=body,
        avg_body10=avg_body10,
        day_starts=day_starts,
    )


@dataclass(frozen=True)
class Spec:
    entry: str  # breakout | pullback | both | breakout_only_strong | pb_reject
    exit: str  # rr1 | rr1_5 | rr2 | rr2_5 | rr3 | eod | ema50 | be_1r_1_5r
    earliest: str
    latest: str
    max_trades: int
    min_gap: int
    skip_sideways: bool
    retest_tol: float
    strong_mult: float
    ema_flat: float
    atr_side_mult: float
    confirm_close: bool  # require close beyond prior H/L for pullback confirmation

    def label(self) -> str:
        return (
            f"{self.entry}|{self.exit}|{self.earliest}-{self.latest}"
            f"|mt{self.max_trades}|gap{self.min_gap}"
            f"|{'sw' if self.skip_sideways else 'nosw'}"
            f"|tol{self.retest_tol}|sm{self.strong_mult}"
            f"|flat{self.ema_flat}|atr{self.atr_side_mult}"
            f"|{'cc' if self.confirm_close else 'nocc'}"
        )


def rr_of(exit_name: str) -> float | None:
    return {
        "rr1": 1.0,
        "rr1_5": 1.5,
        "rr2": 2.0,
        "rr2_5": 2.5,
        "rr3": 3.0,
        "be_1r_1_5r": 1.5,
    }.get(exit_name)


def simulate(inst: Inst, s: Spec, oos_from: str | None = None):
    earliest_m = to_min(s.earliest)
    latest_m = to_min(s.latest)
    exit_m = to_min("15:15")
    n = len(inst.c)
    target_r = rr_of(s.exit)
    profit_protect = s.exit == "be_1r_1_5r"

    pts_l: list[float] = []
    rs_l: list[float] = []
    dates_l: list[str] = []
    reasons_l: list[str] = []
    setups_l: list[str] = []

    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    last_buy = last_sell = -10_000

    for i in range(55, n):
        d = inst.days[i]
        t = inst.times[i]
        m = int(inst.mins[i])

        if trading_date != d:
            trading_date = d
            day_net = 0.0
            trades_today = 0
            day_stopped = False
            open_t = None

        if oos_from and d < oos_from:
            continue

        # ---- manage open ----
        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            risk = open_t["risk"]
            exit_px = None
            reason = None

            if profit_protect:
                # arm at +1R → lock BE
                if direction == "BUY":
                    mfe = inst.h[i] - entry
                    if mfe >= risk:
                        stop = max(stop, entry)
                else:
                    mfe = entry - inst.l[i]
                    if mfe >= risk:
                        stop = min(stop, entry)
                open_t["stop"] = stop

            if direction == "BUY":
                if inst.l[i] <= stop:
                    exit_px, reason = stop, "SL"
            else:
                if inst.h[i] >= stop:
                    exit_px, reason = stop, "SL"

            if exit_px is None and target_r is not None:
                tgt = entry + target_r * risk if direction == "BUY" else entry - target_r * risk
                if direction == "BUY" and inst.h[i] >= tgt:
                    exit_px, reason = tgt, f"RR{target_r}"
                elif direction == "SELL" and inst.l[i] <= tgt:
                    exit_px, reason = tgt, f"RR{target_r}"

            if exit_px is None and s.exit == "ema50":
                e = inst.ema50[i]
                if e == e:
                    if direction == "BUY" and inst.c[i] < e:
                        exit_px, reason = float(inst.c[i]), "ema50"
                    if direction == "SELL" and inst.c[i] > e:
                        exit_px, reason = float(inst.c[i]), "ema50"

            if exit_px is None and m >= exit_m:
                exit_px, reason = float(inst.c[i]), "EOD"

            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                pts_l.append(float(pts))
                rs_l.append(float(pts) * inst.rs_mult)
                dates_l.append(d)
                reasons_l.append(reason or "?")
                setups_l.append(open_t["setup"])
                day_net += pts
                trades_today += 1
                if day_net <= -DAY_STOP:
                    day_stopped = True
                open_t = None
            continue

        if day_stopped or trades_today >= s.max_trades or m < earliest_m or m > latest_m:
            continue

        e50 = inst.ema50[i]
        if e50 != e50 or inst.avg_body10[i] != inst.avg_body10[i]:
            continue
        if i < 1:
            continue

        # Sideways (Pine)
        sideways = False
        if (
            inst.atr14[i] == inst.atr14[i]
            and inst.atr_sma20[i] == inst.atr_sma20[i]
            and i >= 5
            and inst.ema50[i - 5] == inst.ema50[i - 5]
        ):
            ema_drift = abs(float(e50) - float(inst.ema50[i - 5]))
            sideways = (
                float(inst.atr14[i]) < float(inst.atr_sma20[i]) * s.atr_side_mult
                and ema_drift < s.ema_flat
            )
        if s.skip_sideways and sideways:
            continue

        close = float(inst.c[i])
        open_ = float(inst.o[i])
        high = float(inst.h[i])
        low = float(inst.l[i])
        prev_h = float(inst.h[i - 1])
        prev_l = float(inst.l[i - 1])
        avg_body = float(inst.avg_body10[i])
        body = float(inst.body[i])
        strong_bull = close > open_ and body > avg_body * s.strong_mult
        strong_bear = close < open_ and body > avg_body * s.strong_mult

        bull_bo = close > prev_h and close > e50
        bear_bo = close < prev_l and close < e50
        bull_rt = low <= prev_l + s.retest_tol
        bear_rt = high >= prev_h - s.retest_tol
        breakout_buy = bull_bo and bull_rt and strong_bull
        breakout_sell = bear_bo and bear_rt and strong_bear

        pb_buy = close > e50 and close > open_ and low <= e50
        pb_sell = close < e50 and close < open_ and high >= e50
        # Stricter pullback: reject at EMA (wick through, close reclaimed)
        pb_reject_buy = (
            close > e50
            and close > open_
            and low <= e50
            and strong_bull
            and (not s.confirm_close or close > prev_h)
        )
        pb_reject_sell = (
            close < e50
            and close < open_
            and high >= e50
            and strong_bear
            and (not s.confirm_close or close < prev_l)
        )

        buy = sell = False
        setup = None
        if s.entry in ("breakout", "both", "breakout_only_strong"):
            if breakout_buy:
                buy, setup = True, "breakout"
            if breakout_sell:
                sell, setup = True, "breakout"
        if s.entry in ("pullback", "both"):
            if pb_buy and not buy:
                buy, setup = True, "pullback"
            if pb_sell and not sell:
                sell, setup = True, "pullback"
        if s.entry == "pb_reject":
            if pb_reject_buy:
                buy, setup = True, "pb_reject"
            if pb_reject_sell:
                sell, setup = True, "pb_reject"

        if buy and sell:
            # EMA tie-break (same as TS engine)
            if close >= e50:
                sell = False
            else:
                buy = False

        direction = "BUY" if buy else ("SELL" if sell else None)
        if not direction:
            continue

        if direction == "BUY" and i - last_buy <= s.min_gap:
            continue
        if direction == "SELL" and i - last_sell <= s.min_gap:
            continue

        entry = close
        stop = low if direction == "BUY" else high
        if setup in ("pullback", "pb_reject"):
            stop = min(stop, float(e50) - 1.0) if direction == "BUY" else max(stop, float(e50) + 1.0)
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if day_net - risk < -DAY_STOP:
            continue

        open_t = dict(dir=direction, entry=entry, stop=stop, risk=risk, setup=setup or "?")
        if direction == "BUY":
            last_buy = i
        else:
            last_sell = i

    return pts_l, rs_l, dates_l, reasons_l, setups_l


def day_metrics(
    nifty_rows: list[tuple[str, float]],
    bank_rows: list[tuple[str, float]],
    all_days: list[str],
    label: str,
) -> dict:
    by_day: dict[str, float] = defaultdict(float)
    trades_by_day: dict[str, int] = defaultdict(int)
    for d, rs in nifty_rows + bank_rows:
        by_day[d] += float(rs)
        trades_by_day[d] += 1
    arr = np.array([by_day.get(d, 0.0) for d in all_days], float)
    traded = np.array([trades_by_day.get(d, 0) > 0 for d in all_days])
    n = len(all_days)
    if n == 0:
        return {"label": label, "n_days": 0}
    green = float((arr > 0).mean())
    ge500 = float((arr >= 500).mean())
    ge1000 = float((arr >= 1000).mean())
    in_band = float(((arr >= 500) & (arr <= 5000)).mean())
    over5k = float((arr > 5000).mean())
    traded_arr = arr[traded]
    return {
        "label": label,
        "n_days": n,
        "coverage": float(traded.mean()),
        "green_cal": green,
        "ge500": ge500,
        "ge1000": ge1000,
        "in_500_5000": in_band,
        "over_5000": over5k,
        "avg_rs": float(arr.mean()),
        "median_rs": float(np.median(arr)),
        "avg_traded": float(traded_arr.mean()) if len(traded_arr) else 0.0,
        "median_traded": float(np.median(traded_arr)) if len(traded_arr) else 0.0,
        "best_day": float(arr.max()),
        "worst_day": float(arr.min()),
        "trades": int(sum(trades_by_day.values())),
        "pct_days_ge500_traded": float((traded_arr >= 500).mean()) if len(traded_arr) else 0.0,
    }


def score(m: dict) -> float:
    """Prefer green + ₹500 hit-rate + avg in band; penalize catastrophic days."""
    if m.get("n_days", 0) < 10:
        return -1e9
    return (
        1000 * m["ge500"]
        + 600 * m["green_cal"]
        + 400 * m["in_500_5000"]
        + 0.15 * min(m["avg_rs"], 5000)
        + 200 * m["coverage"]
        - 0.05 * abs(min(m["worst_day"], 0))
        - 300 * m["over_5000"]  # overshoot is fine but not the goal metric
    )


def grid() -> list[Spec]:
    entries = ["breakout", "pullback", "both", "pb_reject"]
    exits = ["rr1", "rr1_5", "rr2", "rr2_5", "rr3", "eod", "ema50", "be_1r_1_5r"]
    windows = [("09:45", "15:10"), ("09:45", "14:30"), ("10:15", "14:30"), ("10:15", "13:00")]
    max_trades = [1, 2, 3]
    gaps = [5, 15, 30]
    sideways = [True, False]
    # Keep grid tractable: fix some knobs, vary the money ones.
    specs: list[Spec] = []
    for entry, exit_, (earliest, latest), mt, gap, sw in product(
        entries, exits, windows, max_trades, gaps, sideways
    ):
        # Skip low-signal combos that explode the grid without value
        if entry == "pullback" and gap == 5 and not sw:
            # raw pullback every touch is noise — require sideways filter or larger gap
            pass
        specs.append(
            Spec(
                entry=entry,
                exit=exit_,
                earliest=earliest,
                latest=latest,
                max_trades=mt,
                min_gap=gap,
                skip_sideways=sw,
                retest_tol=10.0,
                strong_mult=0.6,
                ema_flat=10.0 if "nifty" else 10.0,
                atr_side_mult=0.7,
                confirm_close=entry == "pb_reject",
            )
        )
    # Extra: bank-scaled flat thresholds + tighter strong body
    extras = []
    for base in list(specs)[::17]:  # sparse sample of promising shapes
        extras.append(
            Spec(**{**base.__dict__, "ema_flat": 25.0, "retest_tol": 15.0, "strong_mult": 0.8})
        )
        extras.append(
            Spec(**{**base.__dict__, "ema_flat": 15.0, "retest_tol": 8.0, "strong_mult": 1.0})
        )
    return specs + extras


def run_universe(tag: str, nifty: Inst, bank: Inst, oos_from: str | None):
    all_days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    if oos_from:
        all_days = [d for d in all_days if d >= oos_from]
    specs = grid()
    print(f"\n=== {tag}: {len(specs)} specs · {len(all_days)} calendar days ===", flush=True)

    leaders: list[dict] = []
    for i, s in enumerate(specs):
        if i % 200 == 0:
            print(f"  … {i}/{len(specs)}", flush=True)
        _, n_rs, n_dates, _, _ = simulate(nifty, s, oos_from)
        _, b_rs, b_dates, _, _ = simulate(bank, s, oos_from)
        m = day_metrics(
            list(zip(n_dates, n_rs)),
            list(zip(b_dates, b_rs)),
            all_days,
            s.label(),
        )
        m["score"] = score(m)
        m["spec"] = s.__dict__
        leaders.append(m)

    leaders.sort(key=lambda x: x["score"], reverse=True)
    return leaders, all_days


def baseline_donch_retest(nifty: Inst, bank: Inst, oos_from: str | None) -> dict:
    """Lightweight Donch-20 retest · OR-mid · 1.5R · 3t for comparison on same sample."""

    def sim(inst: Inst):
        pts_l, rs_l, dates_l = [], [], []
        open_t = None
        trading_date = None
        day_net = trades_today = 0.0
        day_stopped = False
        broke_res = broke_sup = False
        broke_r = broke_s = np.nan
        or_cache = None
        open_m, or_end_m = to_min("09:15"), to_min("09:45")
        earliest_m, latest_m = to_min("09:45"), to_min("15:10")
        for i in range(55, len(inst.c)):
            d, m = inst.days[i], int(inst.mins[i])
            if trading_date != d:
                trading_date = d
                day_net = trades_today = 0.0
                day_stopped = False
                open_t = None
                broke_res = broke_sup = False
                broke_r = broke_s = np.nan
                or_cache = None
            if oos_from and d < oos_from:
                continue
            if open_t is not None:
                direction, entry, stop, risk = (
                    open_t["dir"],
                    open_t["entry"],
                    open_t["stop"],
                    open_t["risk"],
                )
                # BE after +1R
                if direction == "BUY" and inst.h[i] - entry >= risk:
                    stop = max(stop, entry)
                if direction == "SELL" and entry - inst.l[i] >= risk:
                    stop = min(stop, entry)
                exit_px = None
                if direction == "BUY" and inst.l[i] <= stop:
                    exit_px = stop
                if direction == "SELL" and inst.h[i] >= stop:
                    exit_px = stop
                tgt = entry + 1.5 * risk if direction == "BUY" else entry - 1.5 * risk
                if exit_px is None:
                    if direction == "BUY" and inst.h[i] >= tgt:
                        exit_px = tgt
                    if direction == "SELL" and inst.l[i] <= tgt:
                        exit_px = tgt
                if exit_px is None and m >= to_min("15:15"):
                    exit_px = float(inst.c[i])
                if exit_px is not None:
                    pts = exit_px - entry if direction == "BUY" else entry - exit_px
                    pts_l.append(pts)
                    rs_l.append(pts * inst.rs_mult)
                    dates_l.append(d)
                    day_net += pts
                    trades_today += 1
                    if day_net <= -DAY_STOP:
                        day_stopped = True
                    open_t = None
                continue
            if day_stopped or trades_today >= 3 or m < earliest_m or m > latest_m:
                continue
            if or_cache is None:
                a = inst.day_starts[d]
                hi, lo = -1e18, 1e18
                for j in range(a, i + 1):
                    if inst.mins[j] < open_m:
                        continue
                    if inst.mins[j] >= or_end_m:
                        break
                    hi = max(hi, inst.h[j])
                    lo = min(lo, inst.l[j])
                if hi > lo:
                    or_cache = (hi + lo) / 2
            if or_cache is None:
                continue
            bias = "BUY" if inst.c[i] >= or_cache else "SELL"
            if i >= 20:
                res = float(inst.h[i - 20 : i].max())
                sup = float(inst.l[i - 20 : i].min())
                close = float(inst.c[i])
                if close > res:
                    broke_res, broke_r = True, res
                if close < sup:
                    broke_sup, broke_s = True, sup
                direction = None
                if broke_res and broke_r == broke_r and inst.l[i] <= broke_r <= close:
                    direction = "BUY"
                elif broke_sup and broke_s == broke_s and inst.h[i] >= broke_s >= close:
                    direction = "SELL"
                if not direction or direction != bias:
                    continue
                entry = close
                stop = (
                    min(float(inst.l[i]), float(broke_r) - 1)
                    if direction == "BUY"
                    else max(float(inst.h[i]), float(broke_s) + 1)
                )
                risk = abs(entry - stop)
                if risk < 3:
                    continue
                if risk > inst.max_stop:
                    stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
                    risk = inst.max_stop
                if day_net - risk < -DAY_STOP:
                    continue
                open_t = dict(dir=direction, entry=entry, stop=stop, risk=risk)
                if direction == "BUY":
                    broke_res = False
                else:
                    broke_sup = False
        return list(zip(dates_l, rs_l))

    all_days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    if oos_from:
        all_days = [d for d in all_days if d >= oos_from]
    m = day_metrics(sim(nifty), sim(bank), all_days, "BASELINE donch-retest-or-mid-1.5R+BE")
    m["score"] = score(m)
    return m


def print_top(leaders: list[dict], n: int = 15):
    hdr = (
        f"{'ge500':>6} {'green':>6} {'band':>6} {'avg₹':>8} {'medT':>8} "
        f"{'best':>8} {'worst':>8} {'cov':>5} {'tr':>5}  label"
    )
    print(hdr, flush=True)
    for m in leaders[:n]:
        print(
            f"{100*m['ge500']:5.1f}% {100*m['green_cal']:5.1f}% {100*m['in_500_5000']:5.1f}% "
            f"{m['avg_rs']:8.0f} {m['median_traded']:8.0f} "
            f"{m['best_day']:8.0f} {m['worst_day']:8.0f} "
            f"{100*m['coverage']:4.0f}% {m['trades']:5d}  {m['label'][:90]}",
            flush=True,
        )


def main():
    print("Fetching Yahoo 5m (60d)…", flush=True)
    n5 = yahoo_chart("^NSEI", "5m", "60d")
    b5 = yahoo_chart("^NSEBANK", "5m", "60d")
    print("Fetching Yahoo 60m (2y)…", flush=True)
    n60 = yahoo_chart("^NSEI", "60m", "2y")
    b60 = yahoo_chart("^NSEBANK", "60m", "2y")

    nifty5 = build_inst("nifty", n5)
    bank5 = build_inst("bank", b5)
    nifty60 = build_inst("nifty", n60)
    bank60 = build_inst("bank", b60)

    leaders5, days5 = run_universe("5m-60d", nifty5, bank5, None)
    base5 = baseline_donch_retest(nifty5, bank5, None)
    leaders60, days60 = run_universe("60m-2y", nifty60, bank60, OOS_60M)
    base60 = baseline_donch_retest(nifty60, bank60, OOS_60M)

    print("\n=== BASELINE 5m ===", flush=True)
    print_top([base5], 1)
    print("\n=== TOP Smart PB 5m (recent ~60d) ===", flush=True)
    print_top(leaders5, 20)

    print("\n=== BASELINE 60m OOS 2024+ ===", flush=True)
    print_top([base60], 1)
    print("\n=== TOP Smart PB 60m OOS 2024+ ===", flush=True)
    print_top(leaders60, 20)

    # Cross-check: take top-30 from 5m, re-rank by 60m label match on entry/exit family
    def family(label: str) -> str:
        parts = label.split("|")
        return "|".join(parts[:2]) if len(parts) >= 2 else label

    fam60 = {family(m["label"]): m for m in leaders60}
    cross = []
    for m in leaders5[:40]:
        f = family(m["label"])
        m60 = fam60.get(f)
        if not m60:
            continue
        cross.append(
            {
                "family": f,
                "m5": {k: m[k] for k in m if k not in ("spec",)},
                "m60": {k: m60[k] for k in m60 if k not in ("spec",)},
                "combo_score": 0.55 * m["score"] + 0.45 * m60["score"],
                "spec": m["spec"],
            }
        )
    cross.sort(key=lambda x: x["combo_score"], reverse=True)

    print("\n=== CROSS-ROBUST (5m leaders ∩ 60m family) ===", flush=True)
    for c in cross[:12]:
        a, b = c["m5"], c["m60"]
        print(
            f"  {c['family']}\n"
            f"    5m  ge500={100*a['ge500']:.1f}% green={100*a['green_cal']:.1f}% "
            f"avg={a['avg_rs']:.0f} band={100*a['in_500_5000']:.1f}%\n"
            f"    60m ge500={100*b['ge500']:.1f}% green={100*b['green_cal']:.1f}% "
            f"avg={b['avg_rs']:.0f} band={100*b['in_500_5000']:.1f}%",
            flush=True,
        )

    winner = cross[0] if cross else {
        "spec": leaders5[0]["spec"],
        "m5": leaders5[0],
        "m60": leaders60[0],
        "family": family(leaders5[0]["label"]),
    }

    # Detail dump for winner on 5m
    wspec = Spec(**winner["spec"])
    _, n_rs, n_dates, n_reasons, n_setups = simulate(nifty5, wspec)
    _, b_rs, b_dates, b_reasons, b_setups = simulate(bank5, wspec)
    by_day: dict[str, float] = defaultdict(float)
    for d, rs in list(zip(n_dates, n_rs)) + list(zip(b_dates, b_rs)):
        by_day[d] += rs
    day_rows = [{"date": d, "rs": by_day[d]} for d in sorted(by_day)]

    summary = {
        "goal": "₹500–₹5000/day with 1 lot Nifty + 1 lot Bank via Smart Pullback PRO DNA",
        "data": {
            "nifty_5m_bars": len(n5),
            "bank_5m_bars": len(b5),
            "nifty_60m_bars": len(n60),
            "bank_60m_bars": len(b60),
            "days_5m": days5,
            "days_60m_count": len(days60),
            "note": "Yahoo index 5m limited to ~60d; 60m used for longer OOS. Not Kite futures.",
        },
        "baseline_5m": {k: base5[k] for k in base5 if k != "spec"},
        "baseline_60m": {k: base60[k] for k in base60 if k != "spec"},
        "top_5m": [{k: m[k] for k in m if k != "spec"} for m in leaders5[:30]],
        "top_60m": [{k: m[k] for k in m if k != "spec"} for m in leaders60[:30]],
        "cross_robust": cross[:15],
        "winner": {
            "family": winner.get("family"),
            "spec": winner.get("spec"),
            "m5": winner.get("m5"),
            "m60": winner.get("m60"),
        },
        "winner_5m_day_pnl": day_rows,
        "honest": {
            "cannot_promise_every_day_500": True,
            "reason": (
                "Even best grids historically leave many red/flat days; "
                "₹500–₹5000 daily is a target band for *traded* expectancy, not a guarantee."
            ),
        },
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nWrote {OUT / 'summary.json'}", flush=True)
    print("\n=== WINNER SPEC ===", flush=True)
    print(json.dumps(winner.get("spec"), indent=2), flush=True)


if __name__ == "__main__":
    main()
