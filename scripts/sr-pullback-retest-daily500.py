#!/usr/bin/env python3
"""
Focused daily-₹500 search: Support/Resistance + Pullback + Retest entries.

Thesis: breakout chasing is skewed; S/R retests and EMA pullbacks should lift
green-day rate toward a consistent ~₹500/day (Nifty ₹65 + Bank ₹30, 1 lot).

Entries:
  - pdhl_retest / or_retest / swing_retest / donch_retest / md_retest
  - ema_pb (EMA20 pullback in trend)
  - sr_bounce (reject at swing S/R with trend bias)
  - swing / or_hl / pdhl_break (S/R break baselines)

Exits:
  - eod, ema, swing_trail
  - rr1 / rr1.5 / rr2 (take-profit at R-multiple — classic daily-profit exits)

OOS: calendar days 2024+.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = Path("/tmp/sr-pullback-retest")
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("uni", ROOT / "scripts" / "strategy-universe-search.py")
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)


@dataclass(frozen=True)
class SRSpec:
    entry: str
    entry_n: int
    bias: str
    exit: str  # eod | ema | swing_trail | rr1 | rr1_5 | rr2
    or_end: str
    earliest: str
    latest: str
    one_trade: bool
    swing_lb: int = 5

    def label(self) -> str:
        return (
            f"{self.entry}_n{self.entry_n}_bias_{self.bias}_exit_{self.exit}"
            f"_or{self.or_end.replace(':','')}_{self.earliest.replace(':','')}-{self.latest.replace(':','')}"
            f"_{'1t' if self.one_trade else 'nt'}_sw{self.swing_lb}"
        )


def rr_mult(exit_name: str) -> float | None:
    return {"rr1": 1.0, "rr1_5": 1.5, "rr2": 2.0}.get(exit_name)


def simulate(inst: uni.Inst, s: SRSpec):
    """Dated simulator for S/R / pullback / retest families."""
    or_end_m = uni.to_min(s.or_end)
    earliest_m = max(uni.to_min(s.earliest), or_end_m)
    latest_m = uni.to_min(s.latest)
    open_m = uni.to_min("09:15")
    n = len(inst.c)
    day_stop = 60.0
    target_r = rr_mult(s.exit)

    pts_l: list[float] = []
    rs_l: list[float] = []
    years_l: list[int] = []
    dates_l: list[str] = []

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
            open_t = None
            extreme = trail = None

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            risk = open_t["risk"]
            ei = open_t["ei"]
            exit_px = None
            reason = None

            if direction == "BUY":
                extreme = inst.h[i] if extreme is None else max(extreme, inst.h[i])
            else:
                extreme = inst.l[i] if extreme is None else min(extreme, inst.l[i])

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

            if exit_px is None and s.exit == "swing_trail":
                if direction == "BUY":
                    sl = inst.swing3_l[i]
                    if sl == sl:
                        trail = float(sl) if trail is None else max(trail, float(sl))
                        if inst.l[i] <= trail:
                            exit_px, reason = trail, "swing_trail"
                else:
                    sh = inst.swing3_h[i]
                    if sh == sh:
                        trail = float(sh) if trail is None else min(trail, float(sh))
                        if inst.h[i] >= trail:
                            exit_px, reason = trail, "swing_trail"

            if exit_px is None and s.exit == "ema":
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px, reason = float(inst.c[i]), "ema"
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px, reason = float(inst.c[i]), "ema"

            if exit_px is None and t >= "15:15":
                exit_px, reason = float(inst.c[i]), "EOD"

            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                pts_l.append(float(pts))
                rs_l.append(float(pts) * inst.rs_mult)
                years_l.append(int(d[:4]))
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

        def swing_levels():
            if s.swing_lb == 3:
                return inst.swing3_h[i], inst.swing3_l[i]
            return inst.swing5_h[i], inst.swing5_l[i]

        def mark_break(res, sup):
            nonlocal broke_res, broke_sup, broke_r, broke_s
            if res == res and close > res:
                broke_res, broke_r = True, float(res)
            if sup == sup and close < sup:
                broke_sup, broke_s = True, float(sup)

        def retest_dir():
            if broke_res and broke_r == broke_r and inst.l[i] <= broke_r <= close:
                return "BUY"
            if broke_sup and broke_s == broke_s and inst.h[i] >= broke_s >= close:
                return "SELL"
            return None

        if s.entry == "pdhl_break":
            res, sup = inst.prev_high.get(d, np.nan), inst.prev_low.get(d, np.nan)
            if res == res:
                if close > res:
                    direction = "BUY"
                elif close < sup:
                    direction = "SELL"

        elif s.entry == "pdhl_retest":
            res, sup = inst.prev_high.get(d, np.nan), inst.prev_low.get(d, np.nan)
            if res == res:
                mark_break(res, sup)
                direction = retest_dir()

        elif s.entry == "or_hl":
            if close > orr["high"]:
                direction = "BUY"
            elif close < orr["low"]:
                direction = "SELL"

        elif s.entry == "or_retest":
            mark_break(orr["high"], orr["low"])
            direction = retest_dir()

        elif s.entry == "swing":
            res, sup = swing_levels()
            if res == res:
                if close > res:
                    direction = "BUY"
                elif close < sup:
                    direction = "SELL"

        elif s.entry == "swing_retest":
            res, sup = swing_levels()
            if res == res:
                mark_break(res, sup)
                direction = retest_dir()

        elif s.entry == "donch_retest":
            en = max(s.entry_n, 5)
            if i >= en:
                res = float(inst.h[i - en : i].max())
                sup = float(inst.l[i - en : i].min())
                mark_break(res, sup)
                direction = retest_dir()

        elif s.entry == "md_retest":
            # multi-day S/R retest (3-day high/low)
            res = inst.d3_high.get(d, np.nan)
            sup = inst.d3_low.get(d, np.nan)
            if res == res:
                mark_break(res, sup)
                direction = retest_dir()

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

        elif s.entry == "sr_bounce":
            # Reject at swing S/R with trend: touch support → long, resistance → short
            res, sup = swing_levels()
            e50 = inst.ema50[i]
            if res == res and e50 == e50:
                if close > e50 and inst.l[i] <= float(sup) <= close:
                    direction = "BUY"
                elif close < e50 and inst.h[i] >= float(res) >= close:
                    direction = "SELL"

        elif s.entry == "or_pb":
            # Pullback to OR mid after OR break (bias = or_break typically)
            if bias_dir == "BUY" and inst.l[i] <= orr["mid"] <= close and close > orr["high"]:
                # already above OR high but dipped to mid — rare; use: was above, touch mid
                direction = "BUY"
            # cleaner: after break held, pullback into OR range toward mid
            if broke_res is False and broke_sup is False:
                mark_break(orr["high"], orr["low"])
            if broke_res and inst.l[i] <= orr["mid"] <= close and close >= orr["low"]:
                direction = "BUY"
            elif broke_sup and inst.h[i] >= orr["mid"] >= close and close <= orr["high"]:
                direction = "SELL"

        if not direction:
            continue
        if bias_dir in ("BUY", "SELL") and direction != bias_dir:
            continue

        entry = close
        stop = float(inst.l[i] if direction == "BUY" else inst.h[i])
        # For retests/bounces, stop beyond the S/R level when available
        if s.entry in ("pdhl_retest", "or_retest", "swing_retest", "donch_retest", "md_retest", "sr_bounce", "or_pb"):
            if direction == "BUY" and broke_r == broke_r:
                stop = min(stop, float(broke_r) - 1.0) if s.entry != "sr_bounce" else stop
            if direction == "SELL" and broke_s == broke_s:
                stop = max(stop, float(broke_s) + 1.0) if s.entry != "sr_bounce" else stop
            if s.entry == "sr_bounce":
                res, sup = swing_levels()
                if direction == "BUY" and sup == sup:
                    stop = min(stop, float(sup) - 1.0)
                if direction == "SELL" and res == res:
                    stop = max(stop, float(res) + 1.0)
            if s.entry == "or_pb":
                if direction == "BUY":
                    stop = min(stop, float(orr["low"]) - 1.0)
                else:
                    stop = max(stop, float(orr["high"]) + 1.0)

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
        open_t = dict(dir=direction, entry=entry, stop=stop, risk=risk, atr=atr_e, ei=i)
        if direction == "BUY":
            broke_res = False
        else:
            broke_sup = False

    return (
        np.array(pts_l, float),
        np.array(rs_l, float),
        np.array(years_l, int),
        dates_l,
    )


def day_metrics(rows: list[tuple[str, float]], all_days: list[str], label: str) -> dict:
    by_day: dict[str, float] = defaultdict(float)
    trades_by_day: dict[str, int] = defaultdict(int)
    for d, rs in rows:
        if d < "2024-01-01":
            continue
        by_day[d] += float(rs)
        trades_by_day[d] += 1
    arr = np.array([by_day.get(d, 0.0) for d in all_days], float)
    traded = np.array([trades_by_day.get(d, 0) > 0 for d in all_days])
    tr = arr[traded]
    green = arr > 0
    ge500 = arr >= 500
    return dict(
        label=label,
        n_trades=int(sum(trades_by_day.values())),
        n_days=len(all_days),
        days_traded=int(traded.sum()),
        coverage_pct=round(100 * float(traded.mean()), 1),
        green_day_pct=round(100 * float(green.mean()), 1),
        green_among_traded_pct=round(100 * float((tr > 0).mean()), 1) if len(tr) else None,
        days_ge_500=int(ge500.sum()),
        days_ge_500_pct=round(100 * float(ge500.mean()), 1),
        avg_rs_per_day=round(float(arr.mean()), 0),
        median_rs_per_day=round(float(np.median(arr)), 0),
        avg_rs_traded_day=round(float(tr.mean()), 0) if len(tr) else None,
        median_rs_traded_day=round(float(np.median(tr)), 0) if len(tr) else None,
        worst_day_rs=round(float(arr.min()), 0),
        best_day_rs=round(float(arr.max()), 0),
        net_rs=round(float(arr.sum()), 0),
        # Prefer green% + days≥500 + avg near 500 + less terrible median
        score=round(
            float(green.mean()) * 120
            + float(ge500.mean()) * 80
            + float(traded.mean()) * 25
            + max(0.0, 1.0 - abs(float(arr.mean()) - 500) / 500) * 50
            + (15 if float(arr.mean()) >= 400 else (5 if float(arr.mean()) > 0 else -40))
            + (10 if len(tr) and float(np.median(tr)) > -1500 else 0),
            2,
        ),
    )


def candidates() -> list[SRSpec]:
    out: list[SRSpec] = []
    entries = [
        ("pdhl_retest", 0),
        ("or_retest", 0),
        ("swing_retest", 0),
        ("donch_retest", 15),
        ("donch_retest", 20),
        ("md_retest", 0),
        ("ema_pb", 0),
        ("sr_bounce", 0),
        ("or_pb", 0),
        ("swing", 0),
        ("or_hl", 0),
        ("pdhl_break", 0),
    ]
    biases = ["none", "ema50", "prev_day", "or_break", "or_mid"]
    exits = ["eod", "ema", "swing_trail", "rr1", "rr1_5", "rr2"]
    windows = [
        ("10:15", "10:15", "15:10"),
        ("10:15", "10:15", "12:00"),
        ("10:15", "10:15", "11:30"),
        ("09:45", "09:45", "15:10"),
    ]
    for ent, n in entries:
        for bias in biases:
            # ema_pb needs a bias for direction; allow none (uses ema50 trend inside)
            for ex in exits:
                for or_e, ear, lat in windows:
                    for ot in (True, False):
                        for slb in ((3, 5) if ent in ("swing", "swing_retest", "sr_bounce") else (5,)):
                            out.append(
                                SRSpec(ent, n, bias, ex, or_e, ear, lat, ot, swing_lb=slb)
                            )
    # Dedup
    seen = set()
    uniq = []
    for s in out:
        k = s.label()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(s)
    return uniq


def main():
    print("Loading caches...", flush=True)
    nifty = uni.load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    days = sorted(d for d in (set(nifty.days) | set(bank.days)) if d >= "2024-01-01")
    print(f"  OOS days={len(days)}", flush=True)

    cands = candidates()
    print(f"Evaluating {len(cands)} S/R·pullback·retest candidates...", flush=True)

    results = []
    for i, s in enumerate(cands):
        if i % 100 == 0:
            print(f"  [{i}/{len(cands)}] {s.label()}", flush=True)
        rows: list[tuple[str, float]] = []
        try:
            for inst in (nifty, bank):
                _pts, rs, years, dates = simulate(inst, s)
                for d, r, y in zip(dates, rs, years):
                    if int(y) >= 2024:
                        rows.append((d, float(r)))
        except Exception as e:
            print(f"  skip {s.label()}: {e}", flush=True)
            continue
        m = day_metrics(rows, days, s.label())
        m["spec"] = {
            "entry": s.entry,
            "entry_n": s.entry_n,
            "bias": s.bias,
            "exit": s.exit,
            "or_end": s.or_end,
            "earliest": s.earliest,
            "latest": s.latest,
            "one_trade": s.one_trade,
            "swing_lb": s.swing_lb,
        }
        results.append(m)

    viable = [r for r in results if (r["avg_rs_per_day"] or 0) > 0 and r["n_trades"] >= 60]
    by_score = sorted(viable, key=lambda r: r["score"], reverse=True)
    by_green = sorted(viable, key=lambda r: (r["green_day_pct"], r["days_ge_500_pct"], r["avg_rs_per_day"]), reverse=True)
    by_ge500 = sorted(viable, key=lambda r: (r["days_ge_500_pct"], r["green_day_pct"], r["avg_rs_per_day"]), reverse=True)
    by_avg = sorted(viable, key=lambda r: abs((r["avg_rs_per_day"] or 0) - 500))
    # Prefer: green≥30, avg≥400, coverage≥50
    preferred = [
        r
        for r in by_score
        if r["green_day_pct"] >= 28 and r["avg_rs_per_day"] >= 400 and r["coverage_pct"] >= 40
    ]
    # Retest/pullback-only leaders (exclude pure breakouts)
    retest_like = [
        r
        for r in by_score
        if r["spec"]["entry"]
        in ("pdhl_retest", "or_retest", "swing_retest", "donch_retest", "md_retest", "ema_pb", "sr_bounce", "or_pb")
    ]

    report = dict(
        goal="₹500/day via S/R + pullback + retest (Nifty+Bank 1 lot)",
        n_candidates=len(results),
        n_viable=len(viable),
        top_score=by_score[:20],
        top_green=by_green[:15],
        top_ge500=by_ge500[:15],
        closest_avg_500=by_avg[:10],
        top_retest_pullback=retest_like[:20],
        recommendation=dict(
            best_overall=by_score[0] if by_score else None,
            preferred=preferred[0] if preferred else (by_score[0] if by_score else None),
            best_retest_pullback=retest_like[0] if retest_like else None,
        ),
    )
    json.dump(report, open(OUT / "summary.json", "w"), indent=2)

    print("\n=== TOP SCORE (all S/R family) ===", flush=True)
    for r in by_score[:12]:
        print(
            f"{r['spec']['entry']:14} {r['spec']['bias']:9} {r['spec']['exit']:11} "
            f"1t={r['spec']['one_trade']!s:5} green={r['green_day_pct']:5.1f}% ge500={r['days_ge_500_pct']:5.1f}% "
            f"cov={r['coverage_pct']:5.1f}% avg₹={r['avg_rs_per_day']:6.0f} med₹={r['median_rs_per_day']:6.0f} "
            f"medtr={r['median_rs_traded_day']} n={r['n_trades']} score={r['score']}",
            flush=True,
        )
    print("\n=== TOP RETEST / PULLBACK ONLY ===", flush=True)
    for r in retest_like[:12]:
        print(
            f"{r['spec']['entry']:14} {r['spec']['bias']:9} {r['spec']['exit']:11} "
            f"1t={r['spec']['one_trade']!s:5} green={r['green_day_pct']:5.1f}% ge500={r['days_ge_500_pct']:5.1f}% "
            f"avg₹={r['avg_rs_per_day']:6.0f} medtr={r['median_rs_traded_day']} n={r['n_trades']}",
            flush=True,
        )
    print("\n=== RECOMMENDATION ===", flush=True)
    for k, v in report["recommendation"].items():
        if not v:
            continue
        print(
            f"{k}: {v['label']}\n  green={v['green_day_pct']}% ge500={v['days_ge_500_pct']}% "
            f"avg₹={v['avg_rs_per_day']} medtr={v['median_rs_traded_day']} n={v['n_trades']}",
            flush=True,
        )
    print(f"Wrote {OUT}/summary.json", flush=True)


if __name__ == "__main__":
    main()
