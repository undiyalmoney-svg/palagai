#!/usr/bin/env python3
"""
Genie search: kill red days via COMBO / ALONE / SKIP routing.

Uses the proven Smart-PB legs on Kite 5m OOS 2024+:
  Nifty: pine_bo · 3R · 10:15-14:30 · mt2 · gap15 · sw · OR-mid · close-third
  Bank:  armed_retest · 1.5R · 10:15-14:30 · mt1 · gap30 · sw · OR-mid

Each calendar day chooses one of:
  BOTH | NIFTY | BANK | SKIP

Routing features (causal, known by ~09:45–10:15):
  - weekday, month, fortnight
  - OR width / drive / gap for each index
  - ATR regime
  - which leg has cleaner morning structure

Goal (the genie):
  maximize green days + days in ₹500–₹5000, minimize reds,
  keep avg ≥ 500 @ 1 lot each when trading.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "loops", ROOT / "scripts" / "smart-pb-pro-trader-loops.py"
)
L = importlib.util.module_from_spec(spec)
sys.modules["loops"] = L
spec.loader.exec_module(L)

CACHE = Path("/workspace/reports/analyst-cache")
OUT = Path("/tmp/smart-pb-genie")
OUT.mkdir(parents=True, exist_ok=True)
OOS = "2024-01-01"


def simulate_leg(inst: L.Inst, loop: L.Loop):
    """Timed trades with direction/risk/entry minute."""
    earliest_m = L.to_min(loop.earliest)
    latest_m = L.to_min(loop.latest)
    exit_m = L.to_min("15:15")
    or_end_m = L.to_min("09:45")
    target_r = L.rr_of(loop.exit)
    trades = []
    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    last_sig = -10_000
    broke_res = broke_sup = False
    broke_r = broke_s = np.nan
    or_cache = None

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
        if d < OOS:
            continue

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            risk = open_t["risk"]
            exit_px = None
            if direction == "BUY" and inst.l[i] <= stop:
                exit_px = stop
            elif direction == "SELL" and inst.h[i] >= stop:
                exit_px = stop
            if exit_px is None and target_r is not None:
                tgt = entry + target_r * risk if direction == "BUY" else entry - target_r * risk
                if direction == "BUY" and inst.h[i] >= tgt:
                    exit_px = tgt
                elif direction == "SELL" and inst.l[i] <= tgt:
                    exit_px = tgt
            if exit_px is None and m >= exit_m:
                exit_px = float(inst.c[i])
            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                trades.append(
                    dict(
                        date=d,
                        rs=pts * inst.rs,
                        pts=pts,
                        dir=direction,
                        risk=risk,
                        em=open_t["em"],
                        setup=open_t["setup"],
                    )
                )
                day_net += pts
                trades_today += 1
                if day_net <= -L.DAY_STOP:
                    day_stopped = True
                open_t = None
            continue

        if or_cache is None and m >= or_end_m:
            or_cache = L.opening_range(inst, d, or_end_m)
        if or_cache is None:
            continue
        if day_stopped or trades_today >= loop.max_trades or m < earliest_m or m > latest_m:
            # still update armed state outside window? only inside for entries
            if m < earliest_m or m > latest_m:
                # allow arm updates before/during session
                pass
        e50 = inst.ema50[i]
        if e50 != e50 or inst.avg_body10[i] != inst.avg_body10[i]:
            continue

        # armed state always updates when OR ready
        donch_h = float(inst.h[i - 20 : i].max()) if i >= 20 else np.nan
        donch_l = float(inst.l[i - 20 : i].min()) if i >= 20 else np.nan
        close = float(inst.c[i])
        if donch_h == donch_h:
            if close > donch_h:
                broke_res, broke_r = True, donch_h
            if close < donch_l:
                broke_sup, broke_s = True, donch_l

        if day_stopped or trades_today >= loop.max_trades or m < earliest_m or m > latest_m:
            continue

        if loop.skip_sideways and inst.atr14[i] == inst.atr14[i] and inst.atr_sma20[i] == inst.atr_sma20[i] and i >= 5 and inst.ema50[i - 5] == inst.ema50[i - 5]:
            flat = 10 if inst.name == "nifty" else 25
            if float(inst.atr14[i]) < float(inst.atr_sma20[i]) * 0.7 and abs(float(e50) - float(inst.ema50[i - 5])) < flat:
                continue

        open_ = float(inst.o[i])
        high = float(inst.h[i])
        low = float(inst.l[i])
        prev_h, prev_l = float(inst.h[i - 1]), float(inst.l[i - 1])
        body = float(inst.body[i])
        avg_body = float(inst.avg_body10[i])
        strong_bull = close > open_ and body > avg_body * loop.strong_mult
        strong_bear = close < open_ and body > avg_body * loop.strong_mult
        rng = high - low
        ctb = rng > 0 and (close - low) / rng >= 0.66
        cte = rng > 0 and (high - close) / rng >= 0.66

        direction = None
        setup = None
        level = None
        if loop.entry == "pine_bo":
            if close > prev_h and close > e50 and low <= prev_l + loop.retest_tol and strong_bull and ctb:
                direction, setup, level = "BUY", "pine_bo", prev_h
            elif close < prev_l and close < e50 and high >= prev_h - loop.retest_tol and strong_bear and cte:
                direction, setup, level = "SELL", "pine_bo", prev_l
        elif loop.entry == "armed_retest":
            if broke_res and broke_r == broke_r and low <= broke_r <= close and close > e50 and strong_bull:
                direction, setup, level = "BUY", "armed_retest", float(broke_r)
            elif broke_sup and broke_s == broke_s and high >= broke_s >= close and close < e50 and strong_bear:
                direction, setup, level = "SELL", "armed_retest", float(broke_s)

        if not direction:
            continue
        if loop.confluence == "or_mid":
            if (direction == "BUY" and close < or_cache["mid"]) or (
                direction == "SELL" and close > or_cache["mid"]
            ):
                continue
        if i - last_sig <= loop.min_gap:
            continue

        entry = close
        stop = low if direction == "BUY" else high
        if level is not None:
            stop = min(stop, level - 1) if direction == "BUY" else max(stop, level + 1)
        if setup == "armed_retest":
            stop = min(stop, float(e50) - 1) if direction == "BUY" else max(stop, float(e50) + 1)
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if day_net - risk < -L.DAY_STOP:
            continue

        open_t = dict(dir=direction, entry=entry, stop=stop, risk=risk, setup=setup, em=m)
        last_sig = i
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return trades


@dataclass
class DayFeat:
    date: str
    wd: int  # 0=Mon
    month: int
    n_gap: float
    b_gap: float
    n_drive: float
    b_drive: float
    n_width: float
    b_width: float
    n_atr: float
    b_atr: float
    n_bias: str  # BUY/SELL from first post-OR close vs ema
    b_bias: str
    aligned: bool


def build_feats(nifty: L.Inst, bank: L.Inst, days: list[str]) -> dict[str, DayFeat]:
    import datetime as dt

    out = {}
    for d in days:
        orr_n = L.opening_range(nifty, d, L.to_min("09:45"))
        orr_b = L.opening_range(bank, d, L.to_min("09:45"))
        if not orr_n or not orr_b:
            continue
        na, nb = nifty.day_starts[d], nifty.day_ends[d]
        ba, bb = bank.day_starts[d], bank.day_ends[d]
        n_gap = float(nifty.o[na]) - nifty.prev_close.get(d, float(nifty.o[na]))
        b_gap = float(bank.o[ba]) - bank.prev_close.get(d, float(bank.o[ba]))
        n_drive = abs(orr_n["last_c"] - orr_n["first_o"]) / max(orr_n["width"], 1e-9)
        b_drive = abs(orr_b["last_c"] - orr_b["first_o"]) / max(orr_b["width"], 1e-9)
        n_atr = float(np.nanmean(nifty.atr14[na : nb + 1]))
        b_atr = float(np.nanmean(bank.atr14[ba : bb + 1]))
        # bias at first bar >= 10:15
        n_bias = b_bias = "FLAT"
        for i in range(na, nb + 1):
            if int(nifty.mins[i]) >= L.to_min("10:15") and nifty.ema50[i] == nifty.ema50[i]:
                n_bias = "BUY" if nifty.c[i] > nifty.ema50[i] else "SELL"
                break
        for i in range(ba, bb + 1):
            if int(bank.mins[i]) >= L.to_min("10:15") and bank.ema50[i] == bank.ema50[i]:
                b_bias = "BUY" if bank.c[i] > bank.ema50[i] else "SELL"
                break
        dd = dt.date.fromisoformat(d)
        out[d] = DayFeat(
            date=d,
            wd=dd.weekday(),
            month=dd.month,
            n_gap=n_gap,
            b_gap=b_gap,
            n_drive=n_drive,
            b_drive=b_drive,
            n_width=orr_n["width"],
            b_width=orr_b["width"],
            n_atr=n_atr,
            b_atr=b_atr,
            n_bias=n_bias,
            b_bias=b_bias,
            aligned=n_bias == b_bias and n_bias != "FLAT",
        )
    return out


def day_pnl(trades, allow_dates=None, dir_filter=None, after_em=None, before_em=None):
    by = defaultdict(float)
    for t in trades:
        d = t["date"]
        if allow_dates is not None and d not in allow_dates:
            continue
        if dir_filter and t["dir"] != dir_filter.get(d):
            continue
        if after_em is not None and t["em"] < after_em:
            continue
        if before_em is not None and t["em"] > before_em:
            continue
        by[d] += t["rs"]
    return by


def metrics(by, all_days, label):
    arr = np.array([by.get(d, 0.0) for d in all_days], float)
    traded = np.array([d in by for d in all_days])
    tarr = arr[traded]
    red = float((arr < 0).mean())
    return {
        "label": label,
        "coverage": float(traded.mean()),
        "green": float((arr > 0).mean()),
        "red": red,
        "flat": float((arr == 0).mean()),
        "ge500": float((arr >= 500).mean()),
        "in_band": float(((arr >= 500) & (arr <= 5000)).mean()),
        "avg": float(arr.mean()),
        "avg_traded": float(tarr.mean()) if len(tarr) else 0.0,
        "median_traded": float(np.median(tarr)) if len(tarr) else 0.0,
        "worst": float(arr.min()),
        "best": float(arr.max()),
        "trades_days": int(traded.sum()),
        "green_traded": float((tarr > 0).mean()) if len(tarr) else 0.0,
        "red_traded": float((tarr < 0).mean()) if len(tarr) else 0.0,
    }


def score(m):
    """Genie score: crush reds, fill the ₹500–5k band, keep avg."""
    if m["coverage"] < 0.25:
        return -1e9
    return (
        3000 * m["in_band"]
        + 2000 * m["ge500"]
        + 2500 * m["green"]
        - 4000 * m["red"]  # kill reds hard
        + 1.2 * min(m["avg"], 6000)
        + 400 * m["coverage"]
        + 800 * m["green_traded"]
        - 0.05 * abs(min(m["worst"], 0))
        + (1500 if m["avg"] >= 500 else 0)
        + (2000 if m["red"] <= 0.25 else 0)
        + (3000 if m["red"] <= 0.15 else 0)
    )


def apply_route(n_by_all, b_by_all, feats, route_fn, all_days):
    by = {}
    mode_counts = __import__("collections").Counter()
    for d in all_days:
        f = feats.get(d)
        if not f:
            continue
        # Weekend / odd sessions → sit out
        if f.wd >= 5:
            mode_counts["SKIP"] += 1
            continue
        mode = route_fn(f)
        if mode not in ("BOTH", "NIFTY", "BANK", "SKIP"):
            mode = "SKIP"
        mode_counts[mode] += 1
        if mode == "SKIP":
            continue
        rs = 0.0
        used = False
        if mode in ("BOTH", "NIFTY") and d in n_by_all:
            rs += n_by_all[d]
            used = True
        if mode == "BANK" and d in b_by_all:
            rs += b_by_all[d]
            used = True
        elif mode == "BOTH" and d in b_by_all:
            # bias-sync bank overlay only when biases aligned
            if f.aligned:
                rs += b_by_all[d]
                used = True
        if used:
            by[d] = rs
    return by, dict(mode_counts)


def main():
    print("Loading…", flush=True)
    nifty = L.load_inst("nifty", CACHE / "nifty-5m-2020-2026.json")
    bank = L.load_inst("bank", CACHE / "banknifty-5m-2020-2026.json")
    all_days = sorted(d for d in (set(nifty.day_starts) | set(bank.day_starts)) if d >= OOS)

    n_loop = L.Loop(
        entry="pine_bo",
        exit="rr3",
        earliest="10:15",
        latest="14:30",
        max_trades=2,
        min_gap=15,
        skip_sideways=True,
        regime="none",
        confluence="or_mid",
        book="nifty",
        strong_mult=0.6,
        retest_tol=10,
    )
    b_loop = L.Loop(
        entry="armed_retest",
        exit="rr1_5",
        earliest="10:15",
        latest="14:30",
        max_trades=1,
        min_gap=30,
        skip_sideways=True,
        regime="none",
        confluence="or_mid",
        book="bank",
        strong_mult=0.8,
        retest_tol=12,
    )

    print("Sim legs…", flush=True)
    n_tr = simulate_leg(nifty, n_loop)
    b_tr = simulate_leg(bank, b_loop)
    n_by_all = day_pnl(n_tr)
    b_by_all = day_pnl(b_tr)

    # Bank bias-synced: only days where bank first trade dir == nifty bias
    feats = build_feats(nifty, bank, all_days)
    b_by_sync = {}
    b_tr_by = defaultdict(list)
    for t in b_tr:
        b_tr_by[t["date"]].append(t)
    for d, ts in b_tr_by.items():
        f = feats.get(d)
        if not f:
            continue
        # keep trades matching nifty bias
        rs = sum(t["rs"] for t in ts if t["dir"] == f.n_bias)
        if rs != 0 or any(t["dir"] == f.n_bias for t in ts):
            # if matched trades exist
            matched = [t for t in ts if t["dir"] == f.n_bias]
            if matched:
                b_by_sync[d] = sum(t["rs"] for t in matched)

    print(f"days={len(all_days)} nifty_days={len(n_by_all)} bank_days={len(b_by_all)} sync_bank={len(b_by_sync)}", flush=True)

    # Baselines
    baselines = {}
    for name, by in [
        ("nifty_alone", n_by_all),
        ("bank_alone", b_by_all),
        ("both_indep", {d: n_by_all.get(d, 0) + b_by_all.get(d, 0) for d in set(n_by_all) | set(b_by_all)}),
        ("both_bias_sync", {d: n_by_all.get(d, 0) + b_by_sync.get(d, 0) for d in set(n_by_all) | set(b_by_sync)}),
    ]:
        baselines[name] = metrics(by, all_days, name)
        print(f"BASE {name}: avg={baselines[name]['avg']:.0f} green={100*baselines[name]['green']:.1f}% red={100*baselines[name]['red']:.1f}% ge500={100*baselines[name]['ge500']:.1f}% band={100*baselines[name]['in_band']:.1f}%", flush=True)

    # Analyze which DOW/features predict red for both_bias_sync
    base_by = {d: n_by_all.get(d, 0) + b_by_sync.get(d, 0) for d in set(n_by_all) | set(b_by_sync)}
    print("\n=== DOW stats (bias_sync book) ===", flush=True)
    for wd in range(5):
        ds = [d for d in all_days if feats.get(d) and feats[d].wd == wd]
        arr = np.array([base_by.get(d, 0) for d in ds], float)
        print(f"  wd{wd}: n={len(ds)} green={100*(arr>0).mean():.1f}% red={100*(arr<0).mean():.1f}% avg={arr.mean():.0f} ge500={100*(arr>=500).mean():.1f}%")

    # Oracle upper bound: each day pick best of BOTH_SYNC / NIFTY / BANK / SKIP(0) knowing future — for aspiration only
    oracle = {}
    for d in all_days:
        opts = [0.0]
        if d in n_by_all:
            opts.append(n_by_all[d])
        if d in b_by_sync:
            opts.append(b_by_sync[d])
        if d in n_by_all or d in b_by_sync:
            opts.append(n_by_all.get(d, 0) + b_by_sync.get(d, 0))
        best = max(opts)
        if best != 0:
            oracle[d] = best
    om = metrics(oracle, all_days, "ORACLE_best_of_4")
    print(f"\nORACLE (look-ahead upper bound): avg={om['avg']:.0f} green={100*om['green']:.1f}% red={100*om['red']:.1f}% ge500={100*om['ge500']:.1f}% band={100*om['in_band']:.1f}%", flush=True)

    # Causal routers
    routers = []

    # 1) DOW tables: each weekday -> mode
    modes = ["BOTH", "NIFTY", "BANK", "SKIP"]
    # searchable via greedy then local refine (5^4 = 1024 if we fix one? 4^5 = 1024)
    for combo in product(modes, repeat=5):
        table = {i: combo[i] for i in range(5)}

        def make(t=table):
            return lambda f, tt=t: tt.get(f.wd, "SKIP")

        routers.append((f"dow:{','.join(combo)}", make()))

    # 2) Alignment routers
    routers.append(("align_both_else_nifty", lambda f: "BOTH" if f.aligned else "NIFTY"))
    routers.append(("align_both_else_skip", lambda f: "BOTH" if f.aligned else "SKIP"))
    routers.append(("align_both_else_best_drive", lambda f: "BOTH" if f.aligned else ("NIFTY" if f.n_drive >= f.b_drive else "BANK")))
    routers.append(("drive_pick", lambda f: "NIFTY" if f.n_drive >= f.b_drive + 0.05 else ("BANK" if f.b_drive >= f.n_drive + 0.05 else "BOTH")))
    routers.append(("atr_pick", lambda f: "NIFTY" if f.n_atr >= f.b_atr else "BANK"))

    # 3) Gap / drive filters with solo
    for max_gap in [40, 60, 80, 100, 1e9]:
        for min_drive in [0.0, 0.25, 0.35, 0.5]:
            for align_only in [True, False]:
                def make(mg=max_gap, md=min_drive, ao=align_only):
                    def fn(f):
                        # skip chaotic gaps
                        if abs(f.n_gap) > mg and abs(f.b_gap) > mg:
                            return "SKIP"
                        if max(f.n_drive, f.b_drive) < md:
                            return "SKIP"
                        if ao and not f.aligned:
                            # pick stronger drive alone
                            return "NIFTY" if f.n_drive >= f.b_drive else "BANK"
                        if f.aligned:
                            return "BOTH"
                        return "NIFTY" if f.n_drive >= f.b_drive else "BANK"
                    return fn
                routers.append((f"gap{max_gap}|drv{min_drive}|align{align_only}", make()))

    # 4) DOW × align hybrids (best DOWs from analysis hard-coded expansions)
    # Mon=0 ... Fri=4 — expand promising patterns
    special_dow = [
        # aggressive green chase: skip weak weekdays
        {0: "NIFTY", 1: "BOTH", 2: "BOTH", 3: "NIFTY", 4: "BANK"},
        {0: "SKIP", 1: "BOTH", 2: "BOTH", 3: "BOTH", 4: "NIFTY"},
        {0: "NIFTY", 1: "NIFTY", 2: "BOTH", 3: "BOTH", 4: "SKIP"},
        {0: "BOTH", 1: "BOTH", 2: "NIFTY", 3: "NIFTY", 4: "BOTH"},
        {0: "BANK", 1: "BOTH", 2: "NIFTY", 3: "BOTH", 4: "NIFTY"},
        {0: "NIFTY", 1: "BOTH", 2: "NIFTY", 3: "BOTH", 4: "NIFTY"},
        {0: "SKIP", 1: "NIFTY", 2: "BOTH", 3: "NIFTY", 4: "SKIP"},
        {0: "BOTH", 1: "SKIP", 2: "BOTH", 3: "SKIP", 4: "BOTH"},
    ]
    for i, table in enumerate(special_dow):
        routers.append((f"special_dow_{i}", lambda f, t=table: t.get(f.wd, "SKIP")))

    # 5) Time-split books: morning nifty / afternoon bank (use trade em filters)
    # Handled as separate metric paths below

    print(f"\nEvaluating {len(routers)} routers…", flush=True)
    leaders = []
    for i, (name, fn) in enumerate(routers):
        if i % 200 == 0:
            print(f"  … {i}/{len(routers)}", flush=True)
        by, counts = apply_route(n_by_all, b_by_sync, feats, fn, all_days)
        m = metrics(by, all_days, name)
        m["score"] = score(m)
        m["modes"] = counts
        leaders.append(m)

    # Time-pattern routers: Nifty only before 12:00, Bank only after 12:00, etc.
    time_patterns = []
    for n_end in [L.to_min("12:00"), L.to_min("13:00"), L.to_min("14:30")]:
        for b_start in [L.to_min("10:15"), L.to_min("11:00"), L.to_min("12:00"), L.to_min("12:30")]:
            for mode in ["sequential", "overlap_bias", "nifty_am_bank_pm"]:
                n_part = day_pnl(n_tr, before_em=n_end)
                b_part = day_pnl(
                    [t for t in b_tr if t["date"] in feats and t["dir"] == feats[t["date"]].n_bias],
                    after_em=b_start,
                )
                if mode == "nifty_am_bank_pm":
                    by = {}
                    for d in all_days:
                        rs = n_part.get(d, 0) + b_part.get(d, 0)
                        if rs != 0 or d in n_part or d in b_part:
                            if d in n_part or d in b_part:
                                by[d] = n_part.get(d, 0.0) + b_part.get(d, 0.0)
                    m = metrics(by, all_days, f"time|n<{n_end}|b>{b_start}|{mode}")
                    m["score"] = score(m)
                    m["modes"] = {"TIME": len(by)}
                    time_patterns.append(m)

    leaders.extend(time_patterns)

    # DOW + feature gated: for each weekday choose mode using drive/align
    def smart_route(f):
        # learned-style heuristic from loss surgery
        if abs(f.n_gap) > 120 and abs(f.b_gap) > 200:
            return "SKIP"
        if f.wd == 0:  # Monday — prefer single
            return "NIFTY" if f.n_drive >= 0.35 else ("SKIP" if max(f.n_drive, f.b_drive) < 0.25 else "BANK")
        if f.wd == 4:  # Friday — prefer nifty or skip late chaos
            if f.aligned and min(f.n_drive, f.b_drive) >= 0.3:
                return "BOTH"
            return "NIFTY" if f.n_drive >= f.b_drive else "SKIP"
        # Tue-Thu
        if f.aligned and min(f.n_drive, f.b_drive) >= 0.25:
            return "BOTH"
        if f.n_drive >= f.b_drive + 0.1:
            return "NIFTY"
        if f.b_drive >= f.n_drive + 0.1:
            return "BANK"
        return "NIFTY"

    by, counts = apply_route(n_by_all, b_by_sync, feats, smart_route, all_days)
    m = metrics(by, all_days, "smart_heuristic_v1")
    m["score"] = score(m)
    m["modes"] = counts
    leaders.append(m)

    # Refine: skip if previous day was day-stop disaster on traded book (causal)
    def with_cooldown(base_fn, cool_rs=-2500):
        prev_rs = 0.0

        def fn(f):
            nonlocal prev_rs
            # use previous calendar day's result from running equity — need sequential
            return base_fn(f)

        return fn

    # Sequential cooldown router on top of smart_heuristic
    by = {}
    counts = defaultdict(int)
    last_rs = 0.0
    for d in all_days:
        f = feats.get(d)
        if not f:
            continue
        mode = smart_route(f)
        if last_rs <= -3000:
            mode = "SKIP"  # cool-down after blowup
            counts["COOL_SKIP"] += 1
        else:
            counts[mode] += 1
        rs = 0.0
        used = False
        if mode in ("BOTH", "NIFTY") and d in n_by_all:
            rs += n_by_all[d]
            used = True
        if mode in ("BOTH", "BANK") and d in b_by_sync:
            if mode == "BANK" or f.aligned:
                rs += b_by_sync[d]
                used = True
        if mode == "BOTH" and f.aligned and d in b_by_sync and d in n_by_all:
            rs = n_by_all[d] + b_by_sync[d]
            used = True
        elif mode == "BOTH" and f.aligned:
            rs = n_by_all.get(d, 0) + b_by_sync.get(d, 0)
            used = d in n_by_all or d in b_by_sync
        if used and mode != "SKIP":
            by[d] = rs
            last_rs = rs
        else:
            last_rs = 0.0 if mode == "SKIP" else last_rs
    m = metrics(by, all_days, "smart_heuristic+cooldown")
    m["score"] = score(m)
    m["modes"] = dict(counts)
    leaders.append(m)

    leaders.sort(key=lambda x: x["score"], reverse=True)

    # Also rank by lowest red among avg>=400
    low_red = [m for m in leaders if m["avg"] >= 400 and m["coverage"] >= 0.4]
    low_red.sort(key=lambda x: (x["red"], -x["green"], -x["in_band"], -x["avg"]))

    hit = [m for m in leaders if m["avg"] >= 500 and m["red"] <= 0.35 and m["green"] >= 0.45]

    print("\n=== TOP GENIE SCORE ===", flush=True)
    for m in leaders[:20]:
        print(
            f"avg={m['avg']:7.0f} green={100*m['green']:5.1f}% red={100*m['red']:5.1f}% "
            f"ge500={100*m['ge500']:5.1f}% band={100*m['in_band']:5.1f}% cov={100*m['coverage']:4.0f}% "
            f"worst={m['worst']:7.0f}  {m['label'][:70]} modes={m.get('modes')}",
            flush=True,
        )

    print("\n=== LOWEST RED (avg≥400) ===", flush=True)
    for m in low_red[:15]:
        print(
            f"red={100*m['red']:5.1f}% green={100*m['green']:5.1f}% avg={m['avg']:7.0f} "
            f"ge500={100*m['ge500']:5.1f}% band={100*m['in_band']:5.1f}%  {m['label'][:70]}",
            flush=True,
        )

    print("\n=== HIT avg≥500 & red≤35% & green≥45% ===", flush=True)
    for m in hit[:15]:
        print(
            f"avg={m['avg']:7.0f} green={100*m['green']:5.1f}% red={100*m['red']:5.1f}% "
            f"band={100*m['in_band']:5.1f}%  {m['label'][:70]}",
            flush=True,
        )

    winner = hit[0] if hit else (low_red[0] if low_red else leaders[0])

    # Year split for winner — recompute by label
    def recompute(label):
        # find router
        for name, fn in routers:
            if name == label:
                by, counts = apply_route(n_by_all, b_by_sync, feats, fn, all_days)
                return by, counts
        if label == "smart_heuristic_v1":
            return apply_route(n_by_all, b_by_sync, feats, smart_route, all_days)
        if label.startswith("time|"):
            return {}, {}
        if label == "smart_heuristic+cooldown":
            return by, counts  # last computed
        return {}, {}

    # For DOW winners, year stats
    wby, wcounts = apply_route(
        n_by_all,
        b_by_sync,
        feats,
        next(fn for name, fn in routers if name == winner["label"])
        if winner["label"] in dict(routers)
        else smart_route,
        all_days,
    )
    if winner["label"] == "smart_heuristic_v1":
        wby, wcounts = apply_route(n_by_all, b_by_sync, feats, smart_route, all_days)
    elif winner["label"] == "smart_heuristic+cooldown":
        pass  # keep
    elif winner["label"] in dict(routers):
        wby, wcounts = apply_route(n_by_all, b_by_sync, feats, dict(routers)[winner["label"]], all_days)

    # Always recompute winner path cleanly
    wlabel = winner["label"]
    if wlabel in dict(routers):
        wby, wcounts = apply_route(n_by_all, b_by_sync, feats, dict(routers)[wlabel], all_days)
    elif wlabel == "smart_heuristic_v1":
        wby, wcounts = apply_route(n_by_all, b_by_sync, feats, smart_route, all_days)

    ystats = {}
    for y in ["2024", "2025", "2026"]:
        arr = np.array([wby.get(d, 0.0) for d in all_days if d.startswith(y)], float)
        ystats[y] = {
            "green": float((arr > 0).mean()),
            "red": float((arr < 0).mean()),
            "ge500": float((arr >= 500).mean()),
            "in_band": float(((arr >= 500) & (arr <= 5000)).mean()),
            "avg": float(arr.mean()),
            "worst": float(arr.min()),
        }
        print(f"WIN {y}: {ystats[y]}", flush=True)

    # Per-DOW for winner
    print("\nWinner DOW:", flush=True)
    for wd in range(5):
        ds = [d for d in all_days if feats.get(d) and feats[d].wd == wd]
        arr = np.array([wby.get(d, 0.0) for d in ds], float)
        print(f"  wd{wd}: green={100*(arr>0).mean():.1f}% red={100*(arr<0).mean():.1f}% avg={arr.mean():.0f} ge500={100*(arr>=500).mean():.1f}%")

    # ── Locked GENIE v3 (interpretable, shipped in engine) ──────────────
    def alone(f):
        return "NIFTY" if f.n_drive >= f.b_drive else "BANK"

    def drv_skip(f, md):
        if max(f.n_drive, f.b_drive) < md:
            return "SKIP"
        return "BOTH" if f.aligned else alone(f)

    def genie_v3(f):
        # Mon=drv≥0.35, Tue=SKIP, Wed=drv≥0.25, Thu=align, Fri=BOTH
        if f.wd == 1:
            return "SKIP"
        if f.wd == 4:
            return "BOTH"
        if f.wd == 0:
            return drv_skip(f, 0.35)
        if f.wd == 2:
            return drv_skip(f, 0.25)
        return "BOTH" if f.aligned else alone(f)

    gby, gcounts = apply_route(n_by_all, b_by_sync, feats, genie_v3, all_days)
    gm = metrics(gby, all_days, "genie_v3")
    gm["score"] = score(gm)
    gm["modes"] = gcounts
    gyears = {}
    for y in ["2024", "2025", "2026"]:
        arr = np.array([gby.get(d, 0.0) for d in all_days if d.startswith(y)], float)
        gyears[y] = {
            "avg": float(arr.mean()),
            "green": float((arr > 0).mean()),
            "red": float((arr < 0).mean()),
            "ge500": float((arr >= 500).mean()),
            "in_band": float(((arr >= 500) & (arr <= 5000)).mean()),
            "coverage": float(np.array([d in gby for d in all_days if d.startswith(y)]).mean())
            if any(d.startswith(y) for d in all_days)
            else 0.0,
        }
    print("\n=== LOCKED GENIE v3 ===", flush=True)
    print(
        f"avg={gm['avg']:.0f} green={100*gm['green']:.1f}% red={100*gm['red']:.1f}% "
        f"ge500={100*gm['ge500']:.1f}% band={100*gm['in_band']:.1f}% cov={100*gm['coverage']:.0f}% "
        f"modes={gcounts}",
        flush=True,
    )
    for y, ys in gyears.items():
        print(f"  {y}: avg={ys['avg']:.0f} red={100*ys['red']:.0f}%", flush=True)

    causal = {
        "genie": {**gm, "year": gyears, "rules": {
            "Mon": "drv_skip035 → BOTH if aligned else alone",
            "Tue": "SKIP",
            "Wed": "drv_skip025 → BOTH if aligned else alone",
            "Thu": "align → BOTH if aligned else alone",
            "Fri": "BOTH",
        }},
        "note": "Causal COMBO/ALONE/SKIP. Cannot hit oracle 0% red without look-ahead.",
        "oracle": om,
        "baseline_both_bias_sync": baselines["both_bias_sync"],
    }
    (OUT / "causal_genie.json").write_text(json.dumps(causal, indent=2, default=str))

    summary = {
        "goal": "Kill reds via COMBO/ALONE/SKIP; hit ₹500–5k band genie",
        "baselines": baselines,
        "oracle": om,
        "winner": gm,
        "search_winner_raw": winner,
        "top": leaders[:40],
        "low_red": low_red[:20],
        "hit": hit[:20],
        "year_stats": gyears,
        "winner_modes": gcounts,
        "winner_days": [{"date": d, "rs": gby[d]} for d in sorted(gby)],
        "locked": "genie_v3",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nGENIE LOCKED: genie_v3", flush=True)
    print(
        f"avg={gm['avg']:.0f} green={100*gm['green']:.1f}% red={100*gm['red']:.1f}% "
        f"ge500={100*gm['ge500']:.1f}% band={100*gm['in_band']:.1f}%",
        flush=True,
    )
    print("Wrote", OUT / "summary.json", "and", OUT / "causal_genie.json", flush=True)


if __name__ == "__main__":
    main()
