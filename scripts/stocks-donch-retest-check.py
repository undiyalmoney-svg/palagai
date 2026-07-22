#!/usr/bin/env python3
"""
Stocks check: does Donch Retest · OR-mid · 2R work on the treasure equity book?

Data: Yahoo Finance daily OHLC (Kite token expired in this env).
Book: APOLLOHOSP, BRITANNIA, CIPLA, HDFCLIFE, NESTLEIND, NTPC, SUNPHARMA, TATACONSUM
Capital: ₹60,000 · risk 2.5%/trade · max 3 names/day (same as GAP_FADE_500 desk)

Strategies compared (OOS 2024+):
  1) GAP_FADE_500 (baseline — known stocks DNA)
  2) Donch-20 break→retest · SMA/OR-mid bias · 2R · 1t/symbol
  3) Swing-5 retest · EMA/SMA50 bias · 2R (twin)

Daily bars approximate the S/R retest idea (true 5m DNA needs Kite refresh).
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

OUT = Path("/tmp/stocks-donch-retest")
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / "yahoo-day"
CACHE.mkdir(exist_ok=True)

BOOK = [
    "APOLLOHOSP",
    "BRITANNIA",
    "CIPLA",
    "HDFCLIFE",
    "NESTLEIND",
    "NTPC",
    "SUNPHARMA",
    "TATACONSUM",
]
CAPITAL = 60_000.0
RISK_RS = CAPITAL * 0.025
MAX_PER_DAY = 3
OOS = "2024-01-01"


@dataclass
class Bar:
    date: str
    o: float
    h: float
    l: float
    c: float


def yahoo_day(symbol: str) -> list[Bar]:
    path = CACHE / f"{symbol}.json"
    if path.exists():
        raw = json.loads(path.read_text())
    else:
        # ~6y daily
        url = (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            + urllib.parse.quote(f"{symbol}.NS")
            + "?interval=1d&range=6y"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = json.load(r)
                break
            except Exception as e:
                wait = 2 ** attempt
                print(f"  yahoo retry {symbol}: {e} sleep {wait}", flush=True)
                time.sleep(wait)
        else:
            raise RuntimeError(f"yahoo failed {symbol}")
        path.write_text(json.dumps(raw))
        time.sleep(0.4)
    result = (raw.get("chart") or {}).get("result") or []
    if not result:
        return []
    r0 = result[0]
    ts = r0.get("timestamp") or []
    q = (r0.get("indicators") or {}).get("quote") or [{}]
    q0 = q[0]
    out: list[Bar] = []
    for i, t in enumerate(ts):
        o, h, l, c = q0["open"][i], q0["high"][i], q0["low"][i], q0["close"][i]
        if None in (o, h, l, c):
            continue
        # IST calendar date from unix
        d = time.strftime("%Y-%m-%d", time.gmtime(t + 5.5 * 3600))
        out.append(Bar(d, float(o), float(h), float(l), float(c)))
    return out


def qty_for_risk(entry: float, stop: float) -> int:
    risk = abs(entry - stop)
    if risk < 0.05:
        return 0
    q = int(RISK_RS // risk)
    max_q = int((CAPITAL * 1.5) // entry)
    return max(0, min(q, max_q))


def ema(vals: np.ndarray, n: int) -> np.ndarray:
    out = np.full_like(vals, np.nan, dtype=float)
    if len(vals) < n:
        return out
    alpha = 2 / (n + 1)
    out[n - 1] = vals[:n].mean()
    for i in range(n, len(vals)):
        out[i] = alpha * vals[i] + (1 - alpha) * out[i - 1]
    return out


def simulate_gap_fade(series: dict[str, list[Bar]]) -> list[dict]:
    """GAP_FADE_500: gap-up ≥0.3% → SELL, stop 1.5%, max 3 by |gap|."""
    by_day: dict[str, list[tuple[str, float, Bar, Bar]]] = defaultdict(list)
    for sym, bars in series.items():
        for i in range(1, len(bars)):
            prev, d = bars[i - 1], bars[i]
            if d.date < OOS:
                continue
            gap = (d.o - prev.c) / prev.c
            if gap >= 0.003:
                by_day[d.date].append((sym, gap, prev, d))
    trades = []
    for day in sorted(by_day):
        ranked = sorted(by_day[day], key=lambda x: -abs(x[1]))[:MAX_PER_DAY]
        for sym, gap, prev, d in ranked:
            entry = d.o
            stop = entry * 1.015  # short
            q = qty_for_risk(entry, stop)
            if q <= 0:
                continue
            # exit: stop or EOD
            if d.h >= stop:
                exit_px = stop
            else:
                exit_px = d.c
            pnl = (entry - exit_px) * q  # short
            trades.append(dict(strategy="GAP_FADE_500", symbol=sym, date=day, pnl=pnl, dir="SELL"))
    return trades


def simulate_donch_retest(series: dict[str, list[Bar]], n: int = 20, rr: float = 2.0) -> list[dict]:
    """
    Daily Donchian-n break → retest · bias = close vs prior range mid (OR-mid proxy) · 2R.
    One trade/symbol/day; book max 3 by signal strength.
    """
    pending: dict[str, list[dict]] = defaultdict(list)  # date -> candidates
    for sym, bars in series.items():
        if len(bars) < n + 5:
            continue
        c = np.array([b.c for b in bars], float)
        h = np.array([b.h for b in bars], float)
        l = np.array([b.l for b in bars], float)
        broke_res = False
        broke_sup = False
        lvl_r = lvl_s = np.nan
        last_trade_day = None
        for i in range(n, len(bars)):
            d = bars[i]
            if d.date < OOS:
                # still update break state
                pass
            donch_h = float(h[i - n : i].max())
            donch_l = float(l[i - n : i].min())
            mid = 0.5 * (donch_h + donch_l)
            bias = "BUY" if c[i] >= mid else "SELL"

            if c[i] > donch_h:
                broke_res, lvl_r = True, donch_h
            if c[i] < donch_l:
                broke_sup, lvl_s = True, donch_l

            direction = None
            level = None
            if broke_res and lvl_r == lvl_r and l[i] <= lvl_r <= c[i]:
                direction, level = "BUY", float(lvl_r)
            elif broke_sup and lvl_s == lvl_s and h[i] >= lvl_s >= c[i]:
                direction, level = "SELL", float(lvl_s)

            if not direction or direction != bias:
                continue
            # Clear break after signal (whether OOS or not)
            if direction == "BUY":
                broke_res = False
            else:
                broke_sup = False
            if d.date < OOS or i + 1 >= len(bars):
                continue
            if last_trade_day == d.date:
                continue

            # No look-ahead: signal on day i close → enter next open
            nxt = bars[i + 1]
            entry = float(nxt.o)
            # Stop beyond retest level; floor risk at 0.3%
            if direction == "BUY":
                stop = min(float(nxt.l), level - max(0.05, entry * 0.001))
                stop = min(stop, entry - entry * 0.003)
            else:
                stop = max(float(nxt.h), level + max(0.05, entry * 0.001))
                stop = max(stop, entry + entry * 0.003)
            # Recompute stop from entry vs level (don't use next bar extreme for stop placement)
            if direction == "BUY":
                stop = min(level - max(0.05, entry * 0.001), entry - entry * 0.003)
            else:
                stop = max(level + max(0.05, entry * 0.001), entry + entry * 0.003)
            risk = abs(entry - stop)
            q = qty_for_risk(entry, stop)
            if q <= 0:
                continue
            tgt = entry + rr * risk if direction == "BUY" else entry - rr * risk

            # Resolve on entry day: stop first (conservative), else target, else EOD
            exit_px = float(nxt.c)
            if direction == "BUY":
                if nxt.l <= stop:
                    exit_px = stop
                elif nxt.h >= tgt:
                    exit_px = tgt
            else:
                if nxt.h >= stop:
                    exit_px = stop
                elif nxt.l <= tgt:
                    exit_px = tgt
            pnl = (exit_px - entry) * q if direction == "BUY" else (entry - exit_px) * q
            strength = abs(c[i] - mid) / max(donch_h - donch_l, 1e-6)
            pending[nxt.date].append(
                dict(
                    strategy="DONCH_RETEST_2R",
                    symbol=sym,
                    date=nxt.date,
                    pnl=pnl,
                    dir=direction,
                    strength=strength,
                )
            )
            last_trade_day = nxt.date

    trades = []
    for day in sorted(pending):
        ranked = sorted(pending[day], key=lambda x: -x["strength"])[:MAX_PER_DAY]
        trades.extend(ranked)
    return trades


def simulate_swing_retest(series: dict[str, list[Bar]], lb: int = 5, rr: float = 2.0) -> list[dict]:
    """Swing pivot retest · EMA50 bias · 2R."""
    pending: dict[str, list[dict]] = defaultdict(list)
    for sym, bars in series.items():
        if len(bars) < 60:
            continue
        c = np.array([b.c for b in bars], float)
        h = np.array([b.h for b in bars], float)
        l = np.array([b.l for b in bars], float)
        e50 = ema(c, 50)
        # simple swing: high is swing high if max of ±lb
        sh = np.full(len(c), np.nan)
        sl = np.full(len(c), np.nan)
        for i in range(lb, len(c) - lb):
            if h[i] == h[i - lb : i + lb + 1].max():
                sh[i] = h[i]
            if l[i] == l[i - lb : i + lb + 1].min():
                sl[i] = l[i]
        last_sh = last_sl = np.nan
        broke_res = broke_sup = False
        lvl_r = lvl_s = np.nan
        last_trade_day = None
        for i in range(60, len(bars)):
            if sh[i] == sh[i]:
                last_sh = sh[i]
            if sl[i] == sl[i]:
                last_sl = sl[i]
            if last_sh != last_sh or last_sl != last_sl or e50[i] != e50[i]:
                continue
            d = bars[i]
            bias = "BUY" if c[i] > e50[i] else "SELL"
            if c[i] > last_sh:
                broke_res, lvl_r = True, float(last_sh)
            if c[i] < last_sl:
                broke_sup, lvl_s = True, float(last_sl)
            direction = level = None
            if broke_res and l[i] <= lvl_r <= c[i]:
                direction, level = "BUY", float(lvl_r)
            elif broke_sup and h[i] >= lvl_s >= c[i]:
                direction, level = "SELL", float(lvl_s)
            if not direction or direction != bias:
                continue
            if direction == "BUY":
                broke_res = False
            else:
                broke_sup = False
            if d.date < OOS or i + 1 >= len(bars):
                continue
            if last_trade_day == d.date:
                continue
            nxt = bars[i + 1]
            entry = float(nxt.o)
            if direction == "BUY":
                stop = min(level - max(0.05, entry * 0.001), entry - entry * 0.003)
            else:
                stop = max(level + max(0.05, entry * 0.001), entry + entry * 0.003)
            risk = abs(entry - stop)
            q = qty_for_risk(entry, stop)
            if q <= 0:
                continue
            tgt = entry + rr * risk if direction == "BUY" else entry - rr * risk
            exit_px = float(nxt.c)
            if direction == "BUY":
                if nxt.l <= stop:
                    exit_px = stop
                elif nxt.h >= tgt:
                    exit_px = tgt
            else:
                if nxt.h >= stop:
                    exit_px = stop
                elif nxt.l <= tgt:
                    exit_px = tgt
            pnl = (exit_px - entry) * q if direction == "BUY" else (entry - exit_px) * q
            pending[nxt.date].append(
                dict(
                    strategy="SWING_RETEST_2R",
                    symbol=sym,
                    date=nxt.date,
                    pnl=pnl,
                    dir=direction,
                    strength=abs(c[i] - e50[i]) / max(abs(e50[i]), 1),
                )
            )
            last_trade_day = nxt.date
    trades = []
    for day in sorted(pending):
        ranked = sorted(pending[day], key=lambda x: -x["strength"])[:MAX_PER_DAY]
        trades.extend(ranked)
    return trades


def day_stats(trades: list[dict], all_days: list[str]) -> dict:
    by = defaultdict(float)
    for t in trades:
        by[t["date"]] += t["pnl"]
    arr = np.array([by.get(d, 0.0) for d in all_days], float)
    traded = np.array([d in by for d in all_days])
    tr = arr[traded]
    return dict(
        n_trades=len(trades),
        n_days=len(all_days),
        days_traded=int(traded.sum()),
        coverage_pct=round(100 * float(traded.mean()), 1),
        green_day_pct=round(100 * float((arr > 0).mean()), 1),
        green_among_traded_pct=round(100 * float((tr > 0).mean()), 1) if len(tr) else None,
        days_ge_500=int((arr >= 500).sum()),
        days_ge_500_pct=round(100 * float((arr >= 500).mean()), 1),
        avg_rs_per_day=round(float(arr.mean()), 0),
        median_rs_per_day=round(float(np.median(arr)), 0),
        avg_rs_traded_day=round(float(tr.mean()), 0) if len(tr) else None,
        median_rs_traded_day=round(float(np.median(tr)), 0) if len(tr) else None,
        worst_day_rs=round(float(arr.min()), 0) if len(arr) else 0,
        best_day_rs=round(float(arr.max()), 0) if len(arr) else 0,
        net_rs=round(float(arr.sum()), 0),
    )


def main():
    print("Fetching Yahoo daily for treasure book...", flush=True)
    series: dict[str, list[Bar]] = {}
    for sym in BOOK:
        bars = yahoo_day(sym)
        series[sym] = bars
        print(f"  {sym}: {len(bars)} days ({bars[0].date if bars else '?'} → {bars[-1].date if bars else '?'})", flush=True)

    all_days = sorted({b.date for bars in series.values() for b in bars if b.date >= OOS})
    print(f"OOS calendar days={len(all_days)}", flush=True)

    gap = simulate_gap_fade(series)
    donch = simulate_donch_retest(series)
    swing = simulate_swing_retest(series)

    report = dict(
        data="Yahoo daily OHLC (.NS) — Kite token expired; not 5m DNA",
        book=BOOK,
        capital=CAPITAL,
        risk_rs=RISK_RS,
        max_per_day=MAX_PER_DAY,
        oos_from=OOS,
        gap_fade_500=day_stats(gap, all_days),
        donch_retest_2r=day_stats(donch, all_days),
        swing_retest_2r=day_stats(swing, all_days),
    )

    # Verdict
    d = report["donch_retest_2r"]
    g = report["gap_fade_500"]
    go = (
        d["avg_rs_per_day"] > 0
        and d["green_among_traded_pct"] is not None
        and d["green_among_traded_pct"] >= 45
        and d["n_trades"] >= 80
    )
    report["verdict"] = dict(
        donch_retest_on_stocks="GO" if go else "NO_GO",
        vs_gap_fade=(
            "Donch better avg"
            if d["avg_rs_per_day"] > g["avg_rs_per_day"]
            else "GAP_FADE better avg"
        ),
        note=(
            "GO if Donch avg>0, green-among-traded≥45%, enough trades. "
            "Stocks Desk should keep GAP_FADE_500 if it remains stronger on green-day consistency. "
            "True 5m Donch DNA still needs a fresh Kite token."
        ),
        recommendation=(
            "Use Donch Retest on stocks Strategy Manager / paper only if GO; "
            "keep Stocks Desk default GAP_FADE_500 unless Donch clearly wins."
            if go
            else "Do NOT replace GAP_FADE_500 on Stocks Desk — Donch retest failed stocks daily test."
        ),
    )

    json.dump(report, open(OUT / "summary.json", "w"), indent=2)
    print("\n=== GAP_FADE_500 ===", json.dumps(report["gap_fade_500"], indent=2), flush=True)
    print("\n=== DONCH_RETEST_2R ===", json.dumps(report["donch_retest_2r"], indent=2), flush=True)
    print("\n=== SWING_RETEST_2R ===", json.dumps(report["swing_retest_2r"], indent=2), flush=True)
    print("\n=== VERDICT ===", json.dumps(report["verdict"], indent=2), flush=True)
    print(f"Wrote {OUT}/summary.json", flush=True)


if __name__ == "__main__":
    main()
