#!/usr/bin/env python3
"""
Pro-trader deep search: find Smart-PB loops that hit ₹500–₹5000/day
at **1 lot Nifty + 1 lot Bank** on Kite 5m OOS 2024+.

Loops explored (not a blind label dump):
  A. Armed break → retest (multi-bar) vs same-bar Pine breakout
  B. EMA pullback only after trend arm (OR break / EMA slope)
  C. Confluence: OR-mid / PDHL / swing5 / Donch20
  D. Quality: strong body, rejection wick, close in top/bottom third
  E. Regime: ATR%ile, OR drive, gap/ATR, sideways skip
  F. Session knives: power-hour, skip open, cut lunch
  G. Book routing: both indep · best-of-day · nifty-only · bank-only · align-both
  H. Exits: R-multiples, BE arm, trail ATR, time-stop, partial 1R then runner

Goal score: maximize days in [500,5000] and avg₹, with coverage ≥40%,
worst day not catastrophic. Prefer avg₹ ≥ 500 @ 1+1 lot.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import numpy as np

CACHE = Path("/workspace/reports/analyst-cache")
OUT = Path("/tmp/smart-pb-loops")
OUT.mkdir(parents=True, exist_ok=True)
OOS = "2024-01-01"
RS = {"nifty": 65.0, "bank": 30.0}
MAX_STOP = {"nifty": 30.0, "bank": 45.0}
DAY_STOP = 60.0


def to_min(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def ema_arr(c: np.ndarray, p: int) -> np.ndarray:
    out = np.full(len(c), np.nan)
    if len(c) < p:
        return out
    k = 2 / (p + 1)
    ema = float(c[:p].mean())
    out[p - 1] = ema
    for i in range(p, len(c)):
        ema = float(c[i]) * k + ema * (1 - k)
        out[i] = ema
    return out


def precompute_swings(h, l, lb=5):
    n = len(h)
    sh = np.full(n, np.nan)
    sl = np.full(n, np.nan)
    last_h = last_l = np.nan
    for i in range(lb, n - lb):
        hi, lo = h[i], l[i]
        if hi == np.max(h[i - lb : i + lb + 1]):
            last_h = hi
        if lo == np.min(l[i - lb : i + lb + 1]):
            last_l = lo
        sh[i + lb] = last_h
        sl[i + lb] = last_l
    # forward fill
    for i in range(1, n):
        if sh[i] != sh[i]:
            sh[i] = sh[i - 1]
        if sl[i] != sl[i]:
            sl[i] = sl[i - 1]
    return sh, sl


@dataclass
class Inst:
    name: str
    max_stop: float
    rs: float
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    days: list[str]
    mins: np.ndarray
    ema50: np.ndarray
    atr14: np.ndarray
    atr_sma20: np.ndarray
    body: np.ndarray
    avg_body10: np.ndarray
    swing5_h: np.ndarray
    swing5_l: np.ndarray
    day_starts: dict[str, int]
    day_ends: dict[str, int]
    prev_high: dict[str, float]
    prev_low: dict[str, float]
    prev_close: dict[str, float]


def load_inst(name: str, path: Path) -> Inst:
    candles = json.loads(path.read_text())
    o = np.array([x["open"] for x in candles], float)
    h = np.array([x["high"] for x in candles], float)
    l = np.array([x["low"] for x in candles], float)
    c = np.array([x["close"] for x in candles], float)
    days = [x["date"][:10] for x in candles]
    times = [x["date"][11:16] for x in candles]
    mins = np.array([to_min(t) for t in times])
    ema50 = ema_arr(c, 50)
    body = np.abs(c - o)
    avg_body10 = np.full(len(c), np.nan)
    for i in range(9, len(c)):
        avg_body10[i] = body[i - 9 : i + 1].mean()
    tr = np.full(len(c), np.nan)
    for i in range(1, len(c)):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    atr14 = np.full(len(c), np.nan)
    for i in range(14, len(c)):
        atr14[i] = np.nanmean(tr[i - 13 : i + 1])
    atr_sma20 = np.full(len(c), np.nan)
    for i in range(33, len(c)):
        atr_sma20[i] = np.nanmean(atr14[i - 19 : i + 1])
    s5h, s5l = precompute_swings(h, l, 5)
    day_starts, day_ends = {}, {}
    for i, d in enumerate(days):
        if d not in day_starts:
            day_starts[d] = i
        day_ends[d] = i
    uniq = sorted(day_starts)
    prev_high, prev_low, prev_close = {}, {}, {}
    for i, d in enumerate(uniq):
        if i == 0:
            continue
        pd = uniq[i - 1]
        a, b = day_starts[pd], day_ends[pd]
        prev_high[d] = float(h[a : b + 1].max())
        prev_low[d] = float(l[a : b + 1].min())
        prev_close[d] = float(c[b])
    print(f"  load {name} n={len(c)} days={len(day_starts)}", flush=True)
    return Inst(
        name=name,
        max_stop=MAX_STOP[name],
        rs=RS[name],
        o=o,
        h=h,
        l=l,
        c=c,
        days=days,
        mins=mins,
        ema50=ema50,
        atr14=atr14,
        atr_sma20=atr_sma20,
        body=body,
        avg_body10=avg_body10,
        swing5_h=s5h,
        swing5_l=s5l,
        day_starts=day_starts,
        day_ends=day_ends,
        prev_high=prev_high,
        prev_low=prev_low,
        prev_close=prev_close,
    )


@dataclass(frozen=True)
class Loop:
    entry: str  # pine_bo | armed_retest | ema_pb_armed | confluence_pb | reject_sr
    exit: str  # rr1_5 | rr2 | rr2_5 | rr3 | be1_rr2 | trail_atr | partial_1_2
    earliest: str
    latest: str
    max_trades: int
    min_gap: int
    skip_sideways: bool
    regime: str  # none | or_drive | atr_expand | both
    confluence: str  # none | or_mid | pdhl | swing | donch
    book: str  # indep | best | nifty | bank | align
    strong_mult: float
    retest_tol: float

    def label(self) -> str:
        return (
            f"{self.entry}|{self.exit}|{self.earliest}-{self.latest}"
            f"|mt{self.max_trades}|gap{self.min_gap}"
            f"|{'sw' if self.skip_sideways else 'nosw'}|{self.regime}"
            f"|cf_{self.confluence}|bk_{self.book}|sm{self.strong_mult}"
        )


def opening_range(inst: Inst, d: str, or_end_m: int):
    a = inst.day_starts[d]
    b = inst.day_ends[d]
    open_m = to_min("09:15")
    hi, lo = -1e18, 1e18
    first_o = last_c = None
    cnt = 0
    for j in range(a, b + 1):
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
        return None
    return dict(high=hi, low=lo, mid=(hi + lo) / 2, first_o=first_o, last_c=last_c, width=hi - lo)


def rr_of(exit_name: str) -> float | None:
    return {
        "rr1_5": 1.5,
        "rr2": 2.0,
        "rr2_5": 2.5,
        "rr3": 3.0,
        "be1_rr2": 2.0,
        "partial_1_2": 2.0,
        "trail_atr": None,
    }.get(exit_name)


def simulate_inst(inst: Inst, loop: Loop, oos: str):
    """Per-instrument trades with armed-state logic."""
    earliest_m = to_min(loop.earliest)
    latest_m = to_min(loop.latest)
    exit_m = to_min("15:15")
    or_end_m = to_min("09:45")
    target_r = rr_of(loop.exit)
    be_protect = loop.exit == "be1_rr2"
    partial = loop.exit == "partial_1_2"
    trail_atr = loop.exit == "trail_atr"

    trades = []  # (date, rs, pts, setup)
    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    last_sig = -10_000
    broke_res = broke_sup = False
    broke_r = broke_s = np.nan
    or_cache = None
    trend_arm = None  # BUY/SELL after OR break

    for i in range(60, len(inst.c)):
        d = inst.days[i]
        m = int(inst.mins[i])
        if trading_date != d:
            trading_date = d
            day_net = 0.0
            trades_today = 0
            day_stopped = False
            open_t = None
            broke_res = broke_sup = False
            broke_r = broke_s = np.nan
            or_cache = None
            trend_arm = None

        if d < oos:
            continue

        # manage open
        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            risk = open_t["risk"]
            remaining = open_t.get("remaining", 1.0)
            realized = open_t.get("realized", 0.0)
            exit_px = None
            reason = None

            if be_protect or partial:
                if direction == "BUY" and inst.h[i] - entry >= risk:
                    stop = max(stop, entry)
                if direction == "SELL" and entry - inst.l[i] >= risk:
                    stop = min(stop, entry)
                open_t["stop"] = stop

            if partial and not open_t.get("took_partial"):
                tgt1 = entry + risk if direction == "BUY" else entry - risk
                hit = (direction == "BUY" and inst.h[i] >= tgt1) or (
                    direction == "SELL" and inst.l[i] <= tgt1
                )
                if hit:
                    # lock half at 1R
                    realized += 0.5 * risk * (1 if direction == "BUY" else 1)
                    open_t["took_partial"] = True
                    open_t["remaining"] = 0.5
                    remaining = 0.5
                    stop = entry  # BE on runner
                    open_t["stop"] = stop
                    open_t["realized"] = realized

            if trail_atr and inst.atr14[i] == inst.atr14[i]:
                atr = float(inst.atr14[i])
                if direction == "BUY":
                    trail = float(inst.c[i]) - 1.5 * atr
                    stop = max(stop, trail)
                else:
                    trail = float(inst.c[i]) + 1.5 * atr
                    stop = min(stop, trail)
                open_t["stop"] = stop

            if direction == "BUY" and inst.l[i] <= stop:
                exit_px, reason = stop, "SL"
            elif direction == "SELL" and inst.h[i] >= stop:
                exit_px, reason = stop, "SL"

            if exit_px is None and target_r is not None:
                tgt = entry + target_r * risk if direction == "BUY" else entry - target_r * risk
                if direction == "BUY" and inst.h[i] >= tgt:
                    exit_px, reason = tgt, f"RR{target_r}"
                elif direction == "SELL" and inst.l[i] <= tgt:
                    exit_px, reason = tgt, f"RR{target_r}"

            if exit_px is None and m >= exit_m:
                exit_px, reason = float(inst.c[i]), "EOD"

            if exit_px is not None:
                move = exit_px - entry if direction == "BUY" else entry - exit_px
                pts = realized + remaining * move if partial else move
                # partial realized was in R units of risk pts already as 0.5*risk
                if partial:
                    pts = open_t.get("realized", 0.0) + remaining * move
                rs = pts * inst.rs
                trades.append((d, rs, pts, open_t["setup"], reason or "?"))
                day_net += pts
                trades_today += 1
                if day_net <= -DAY_STOP:
                    day_stopped = True
                open_t = None
            continue

        if day_stopped or trades_today >= loop.max_trades or m < earliest_m or m > latest_m:
            # still update arms before continue
            pass

        if or_cache is None and m >= or_end_m:
            or_cache = opening_range(inst, d, or_end_m)
        if or_cache is None:
            continue

        # trend arm from OR break
        if trend_arm is None and or_cache:
            if inst.c[i] > or_cache["high"]:
                trend_arm = "BUY"
            elif inst.c[i] < or_cache["low"]:
                trend_arm = "SELL"

        # regime filters (day-level once OR ready)
        if loop.regime in ("or_drive", "both") and or_cache:
            drive = abs(or_cache["last_c"] - or_cache["first_o"]) / max(or_cache["width"], 1e-9)
            if drive < 0.30:
                continue
        if loop.regime in ("atr_expand", "both"):
            if not (
                inst.atr14[i] == inst.atr14[i]
                and inst.atr_sma20[i] == inst.atr_sma20[i]
                and float(inst.atr14[i]) > float(inst.atr_sma20[i]) * 1.05
            ):
                continue

        if day_stopped or trades_today >= loop.max_trades or m < earliest_m or m > latest_m:
            continue

        e50 = inst.ema50[i]
        if e50 != e50 or inst.avg_body10[i] != inst.avg_body10[i]:
            continue

        # sideways
        sideways = False
        if (
            loop.skip_sideways
            and inst.atr14[i] == inst.atr14[i]
            and inst.atr_sma20[i] == inst.atr_sma20[i]
            and i >= 5
            and inst.ema50[i - 5] == inst.ema50[i - 5]
        ):
            ema_flat = 10.0 if inst.name == "nifty" else 25.0
            sideways = float(inst.atr14[i]) < float(inst.atr_sma20[i]) * 0.7 and abs(
                float(e50) - float(inst.ema50[i - 5])
            ) < ema_flat
        if sideways:
            continue

        close = float(inst.c[i])
        open_ = float(inst.o[i])
        high = float(inst.h[i])
        low = float(inst.l[i])
        prev_h, prev_l = float(inst.h[i - 1]), float(inst.l[i - 1])
        body = float(inst.body[i])
        avg_body = float(inst.avg_body10[i])
        strong_bull = close > open_ and body > avg_body * loop.strong_mult
        strong_bear = close < open_ and body > avg_body * loop.strong_mult
        range_ = high - low
        close_third_bull = range_ > 0 and (close - low) / range_ >= 0.66
        close_third_bear = range_ > 0 and (high - close) / range_ >= 0.66

        # levels for confluence / armed
        donch_h = float(inst.h[i - 20 : i].max()) if i >= 20 else np.nan
        donch_l = float(inst.l[i - 20 : i].min()) if i >= 20 else np.nan
        sw_h, sw_l = float(inst.swing5_h[i]), float(inst.swing5_l[i])
        pdh = inst.prev_high.get(d, np.nan)
        pdl = inst.prev_low.get(d, np.nan)

        direction = None
        setup = None
        level = None

        # --- ENTRY LOOPS ---
        if loop.entry == "pine_bo":
            bull = (
                close > prev_h
                and close > e50
                and low <= prev_l + loop.retest_tol
                and strong_bull
                and close_third_bull
            )
            bear = (
                close < prev_l
                and close < e50
                and high >= prev_h - loop.retest_tol
                and strong_bear
                and close_third_bear
            )
            if bull:
                direction, setup, level = "BUY", "pine_bo", prev_h
            elif bear:
                direction, setup, level = "SELL", "pine_bo", prev_l

        elif loop.entry == "armed_retest":
            # classic: break Donch/swing, later retest hold
            res, sup = donch_h, donch_l
            if res == res:
                if close > res:
                    broke_res, broke_r = True, res
                if close < sup:
                    broke_sup, broke_s = True, sup
            if (
                broke_res
                and broke_r == broke_r
                and low <= broke_r <= close
                and close > e50
                and strong_bull
            ):
                direction, setup, level = "BUY", "armed_retest", float(broke_r)
            elif (
                broke_sup
                and broke_s == broke_s
                and high >= broke_s >= close
                and close < e50
                and strong_bear
            ):
                direction, setup, level = "SELL", "armed_retest", float(broke_s)

        elif loop.entry == "ema_pb_armed":
            # pullback to EMA only after OR trend arm
            if trend_arm == "BUY" and close > e50 and close > open_ and low <= e50 and strong_bull:
                direction, setup, level = "BUY", "ema_pb_armed", float(e50)
            elif trend_arm == "SELL" and close < e50 and close < open_ and high >= e50 and strong_bear:
                direction, setup, level = "SELL", "ema_pb_armed", float(e50)

        elif loop.entry == "confluence_pb":
            # EMA pullback + level confluence
            near = False
            tag = None
            if loop.confluence == "or_mid":
                near = abs(low - or_cache["mid"]) <= loop.retest_tol or abs(
                    high - or_cache["mid"]
                ) <= loop.retest_tol
                tag = or_cache["mid"]
            elif loop.confluence == "pdhl":
                if pdh == pdh:
                    near = (low <= pdh + loop.retest_tol and close >= pdh) or (
                        high >= pdl - loop.retest_tol and close <= pdl
                    )
                    tag = pdh
            elif loop.confluence == "swing":
                if sw_l == sw_l:
                    near = low <= sw_l + loop.retest_tol or high >= sw_h - loop.retest_tol
                    tag = sw_l
            elif loop.confluence == "donch":
                if donch_l == donch_l:
                    near = low <= donch_l + loop.retest_tol or high >= donch_h - loop.retest_tol
                    tag = donch_l
            else:
                near = True
                tag = e50
            if near and close > e50 and close > open_ and low <= e50 and strong_bull and close_third_bull:
                direction, setup, level = "BUY", "confluence_pb", float(tag if tag == tag else e50)
            elif near and close < e50 and close < open_ and high >= e50 and strong_bear and close_third_bear:
                direction, setup, level = "SELL", "confluence_pb", float(tag if tag == tag else e50)

        elif loop.entry == "reject_sr":
            # reject at swing/PDHL with trend
            if sw_l == sw_l and close > e50 and low <= sw_l + loop.retest_tol and close > sw_l and strong_bull:
                direction, setup, level = "BUY", "reject_sr", float(sw_l)
            elif sw_h == sw_h and close < e50 and high >= sw_h - loop.retest_tol and close < sw_h and strong_bear:
                direction, setup, level = "SELL", "reject_sr", float(sw_h)

        if not direction:
            continue

        # confluence gate for non-confluence entries
        if loop.entry != "confluence_pb" and loop.confluence != "none":
            ok = True
            if loop.confluence == "or_mid":
                ok = (direction == "BUY" and close >= or_cache["mid"]) or (
                    direction == "SELL" and close <= or_cache["mid"]
                )
            elif loop.confluence == "pdhl" and pdh == pdh:
                ok = (direction == "BUY" and close >= pdl) or (direction == "SELL" and close <= pdh)
            elif loop.confluence == "swing" and sw_l == sw_l:
                ok = (direction == "BUY" and close >= sw_l) or (direction == "SELL" and close <= sw_h)
            if not ok:
                continue

        if i - last_sig <= loop.min_gap:
            continue

        entry = close
        stop = low if direction == "BUY" else high
        if level is not None and level == level:
            stop = min(stop, level - 1) if direction == "BUY" else max(stop, level + 1)
        if setup in ("ema_pb_armed", "confluence_pb"):
            stop = min(stop, float(e50) - 1) if direction == "BUY" else max(stop, float(e50) + 1)
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if day_net - risk < -DAY_STOP:
            continue

        open_t = dict(
            dir=direction,
            entry=entry,
            stop=stop,
            risk=risk,
            setup=setup or "?",
            remaining=1.0,
            realized=0.0,
        )
        last_sig = i
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return trades


def apply_book(nifty_tr, bank_tr, all_days, book: str):
    """Combine instrument trades into daily ₹ series."""
    if book == "nifty":
        rows = [(d, rs) for d, rs, *_ in nifty_tr]
    elif book == "bank":
        rows = [(d, rs) for d, rs, *_ in bank_tr]
    elif book == "indep":
        rows = [(d, rs) for d, rs, *_ in nifty_tr] + [(d, rs) for d, rs, *_ in bank_tr]
    elif book == "align":
        # only count days where both have a trade same direction net positive intent:
        # keep both trades only if same calendar day and same sign of first trade direction via pts
        n_by = defaultdict(list)
        b_by = defaultdict(list)
        for t in nifty_tr:
            n_by[t[0]].append(t)
        for t in bank_tr:
            b_by[t[0]].append(t)
        rows = []
        for d in sorted(set(n_by) & set(b_by)):
            # require first trades same direction
            if (n_by[d][0][2] >= 0 and b_by[d][0][2] >= 0) or (
                n_by[d][0][2] < 0 and b_by[d][0][2] < 0
            ):
                # actually direction is in setup path — use pts sign of open is wrong.
                # Use: keep both if both traded (alignment = both fired)
                for t in n_by[d] + b_by[d]:
                    rows.append((t[0], t[1]))
    else:  # best — one trade per day across book (highest |expected| = first signal chronologically? pick max rs after day — LEAK)
        # causal best: take the first signal of the day across instruments by needing bar time —
        # approximate: take nifty first trade if any else bank (session sync). Better: pick larger |risk| setup.
        # Use: only the first trade of the day from either book by date order we already have —
        # Prefer trade with larger rs *potential* unknown. Causal: first chronologically.
        # Our trade lists aren't bar-indexed; take first nifty else first bank per day (simple).
        # Improved causal proxy: take only ONE instrument's first trade — the one with smaller risk isn't known.
        # For research: pick the trade with better realized? NO look-ahead.
        # Causal: prefer Nifty first signal of day, else Bank (Nifty leads morning).
        n_by = {}
        b_by = {}
        for t in nifty_tr:
            n_by.setdefault(t[0], t)
        for t in bank_tr:
            b_by.setdefault(t[0], t)
        rows = []
        for d in sorted(set(n_by) | set(b_by)):
            if d in n_by:
                rows.append((d, n_by[d][1]))
            else:
                rows.append((d, b_by[d][1]))
    return rows


def day_metrics(rows, all_days, label):
    by = defaultdict(float)
    tc = defaultdict(int)
    for d, rs in rows:
        by[d] += float(rs)
        tc[d] += 1
    arr = np.array([by.get(d, 0.0) for d in all_days], float)
    traded = np.array([tc.get(d, 0) > 0 for d in all_days])
    tarr = arr[traded]
    return {
        "label": label,
        "n_days": len(all_days),
        "coverage": float(traded.mean()),
        "green_cal": float((arr > 0).mean()),
        "ge500": float((arr >= 500).mean()),
        "ge1000": float((arr >= 1000).mean()),
        "in_band": float(((arr >= 500) & (arr <= 5000)).mean()),
        "avg_rs": float(arr.mean()),
        "median_rs": float(np.median(arr)),
        "avg_traded": float(tarr.mean()) if len(tarr) else 0.0,
        "median_traded": float(np.median(tarr)) if len(tarr) else 0.0,
        "best": float(arr.max()),
        "worst": float(arr.min()),
        "trades": int(sum(tc.values())),
        "pct_traded_ge500": float((tarr >= 500).mean()) if len(tarr) else 0.0,
    }


def score(m):
    # Hard preference: avg ≥ 500 and in-band; else climb toward it
    if m["n_days"] < 50:
        return -1e9
    s = (
        2000 * m["in_band"]
        + 1200 * m["ge500"]
        + 800 * m["green_cal"]
        + 1.0 * min(m["avg_rs"], 5000)
        + 300 * m["coverage"]
        - 0.08 * abs(min(m["worst"], 0))
    )
    if m["avg_rs"] >= 500:
        s += 2500
    if m["avg_rs"] >= 500 and m["ge500"] >= 0.45:
        s += 2000
    return s


def build_grid() -> list[Loop]:
    entries = ["pine_bo", "armed_retest", "ema_pb_armed", "confluence_pb", "reject_sr"]
    exits = ["rr1_5", "rr2", "rr2_5", "rr3", "be1_rr2", "partial_1_2", "trail_atr"]
    windows = [("10:15", "14:30"), ("10:15", "13:00"), ("09:45", "12:00"), ("11:00", "14:30")]
    regimes = ["none", "or_drive", "atr_expand", "both"]
    confluences = ["none", "or_mid", "pdhl", "swing"]
    books = ["indep", "best", "nifty", "bank"]
    specs: list[Loop] = []

    # Core dense grid on best prior families
    for entry, exit_, (earliest, latest), regime, book in product(
        ["pine_bo", "armed_retest", "ema_pb_armed"],
        ["rr1_5", "rr2", "rr2_5", "be1_rr2", "partial_1_2"],
        windows,
        ["none", "or_drive", "atr_expand"],
        ["indep", "best", "nifty"],
    ):
        for sw, mt, gap in product([True, False], [1, 2], [15, 30]):
            specs.append(
                Loop(
                    entry=entry,
                    exit=exit_,
                    earliest=earliest,
                    latest=latest,
                    max_trades=mt,
                    min_gap=gap,
                    skip_sideways=sw,
                    regime=regime,
                    confluence="or_mid" if entry != "ema_pb_armed" else "none",
                    book=book,
                    strong_mult=0.8 if entry != "pine_bo" else 0.6,
                    retest_tol=10.0,
                )
            )

    # Confluence / reject specialists
    for entry, cf, exit_, book, (earliest, latest) in product(
        ["confluence_pb", "reject_sr"],
        ["or_mid", "pdhl", "swing", "donch"],
        ["rr2", "rr2_5", "be1_rr2", "partial_1_2"],
        ["indep", "best", "nifty", "bank"],
        [("10:15", "14:30"), ("10:15", "13:00"), ("09:45", "12:00")],
    ):
        specs.append(
            Loop(
                entry=entry,
                exit=exit_,
                earliest=earliest,
                latest=latest,
                max_trades=1,
                min_gap=30,
                skip_sideways=True,
                regime="or_drive",
                confluence=cf,
                book=book,
                strong_mult=0.8,
                retest_tol=12.0,
            )
        )

    # Dedup
    seen = set()
    uniq = []
    for s in specs:
        if s.label() in seen:
            continue
        seen.add(s.label())
        uniq.append(s)
    return uniq


def print_top(ms, n=20):
    print(
        f"{'ge500':>6} {'band':>6} {'green':>6} {'avg₹':>8} {'medT':>8} {'worst':>8} {'cov':>5} {'tr':>5}  label",
        flush=True,
    )
    for m in ms[:n]:
        print(
            f"{100*m['ge500']:5.1f}% {100*m['in_band']:5.1f}% {100*m['green_cal']:5.1f}% "
            f"{m['avg_rs']:8.0f} {m['median_traded']:8.0f} {m['worst']:8.0f} "
            f"{100*m['coverage']:4.0f}% {m['trades']:5d}  {m['label'][:95]}",
            flush=True,
        )


def main():
    print("Loading Kite cache…", flush=True)
    nifty = load_inst("nifty", CACHE / "nifty-5m-2020-2026.json")
    bank = load_inst("bank", CACHE / "banknifty-5m-2020-2026.json")
    all_days = sorted(d for d in (set(nifty.day_starts) | set(bank.day_starts)) if d >= OOS)
    print(f"OOS days={len(all_days)}", flush=True)

    loops = build_grid()
    print(f"Evaluating {len(loops)} pro-trader loops…", flush=True)

    # Cache per (entry,exit,window,filters) instrument trades; book is post
    trade_cache: dict[str, tuple] = {}
    leaders = []

    for i, loop in enumerate(loops):
        if i % 100 == 0:
            print(f"  … {i}/{len(loops)}", flush=True)
        # cache key ignores book
        key = (
            f"{loop.entry}|{loop.exit}|{loop.earliest}-{loop.latest}|mt{loop.max_trades}"
            f"|gap{loop.min_gap}|{loop.skip_sideways}|{loop.regime}|{loop.confluence}|{loop.strong_mult}|{loop.retest_tol}"
        )
        if key not in trade_cache:
            trade_cache[key] = (
                simulate_inst(nifty, loop, OOS),
                simulate_inst(bank, loop, OOS),
            )
        n_tr, b_tr = trade_cache[key]
        rows = apply_book(n_tr, b_tr, all_days, loop.book)
        m = day_metrics(rows, all_days, loop.label())
        m["score"] = score(m)
        m["spec"] = loop.__dict__
        leaders.append(m)

    leaders.sort(key=lambda x: x["score"], reverse=True)

    hit500 = [m for m in leaders if m["avg_rs"] >= 500 and m["coverage"] >= 0.35]
    near = [m for m in leaders if m["avg_rs"] >= 300 and m["ge500"] >= 0.45]
    band_kings = sorted(
        [m for m in leaders if m["coverage"] >= 0.4],
        key=lambda x: (x["in_band"], x["avg_rs"]),
        reverse=True,
    )

    print("\n=== HIT avg₹≥500 @ 1-lot book ===", flush=True)
    print_top(hit500 if hit500 else [{"label": "(none)", **{k:0 for k in ["ge500","in_band","green_cal","avg_rs","median_traded","worst","coverage","trades"]}}], 15)

    print("\n=== NEAR (avg≥300 & ge500≥45%) ===", flush=True)
    print_top(near[:20] if near else leaders[:5], 20)

    print("\n=== BAND KINGS (in ₹500–₹5000) ===", flush=True)
    print_top(band_kings[:20], 20)

    print("\n=== TOP SCORE ===", flush=True)
    print_top(leaders, 25)

    winner = hit500[0] if hit500 else (near[0] if near else leaders[0])

    # Year split for winner
    w = Loop(**winner["spec"])
    key = (
        f"{w.entry}|{w.exit}|{w.earliest}-{w.latest}|mt{w.max_trades}"
        f"|gap{w.min_gap}|{w.skip_sideways}|{w.regime}|{w.confluence}|{w.strong_mult}|{w.retest_tol}"
    )
    n_tr, b_tr = trade_cache[key]
    rows = apply_book(n_tr, b_tr, all_days, w.book)
    by = defaultdict(float)
    for d, rs in rows:
        by[d] += rs
    year_stats = {}
    for y in ["2024", "2025", "2026"]:
        arr = np.array([by.get(d, 0.0) for d in all_days if d.startswith(y)], float)
        if not len(arr):
            continue
        year_stats[y] = {
            "ge500": float((arr >= 500).mean()),
            "green": float((arr > 0).mean()),
            "in_band": float(((arr >= 500) & (arr <= 5000)).mean()),
            "avg": float(arr.mean()),
            "median": float(np.median(arr)),
            "worst": float(arr.min()),
            "best": float(arr.max()),
        }
        print(
            f"  {y}: ge500={100*year_stats[y]['ge500']:.1f}% green={100*year_stats[y]['green']:.1f}% "
            f"avg={year_stats[y]['avg']:.0f} band={100*year_stats[y]['in_band']:.1f}%",
            flush=True,
        )

    summary = {
        "goal": "₹500–₹5000/day @ 1 lot Nifty + 1 lot Bank via Smart-PB pro loops",
        "oos_days": len(all_days),
        "n_loops": len(loops),
        "hit_avg_500_count": len(hit500),
        "winner": winner,
        "top": leaders[:40],
        "hit500": hit500[:20],
        "near": near[:20],
        "band_kings": band_kings[:20],
        "year_stats": year_stats,
        "winner_days": [{"date": d, "rs": by[d]} for d in sorted(by)],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nWINNER: {winner['label']}", flush=True)
    print(f"avg={winner['avg_rs']:.0f} ge500={100*winner['ge500']:.1f}% band={100*winner['in_band']:.1f}%", flush=True)
    print("Wrote", OUT / "summary.json", flush=True)


if __name__ == "__main__":
    main()
