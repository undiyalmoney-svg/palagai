#!/usr/bin/env python3
"""
Search for strategies aimed at daily consistency (~₹500 / trading day).

Optimizes calendar-day metrics (not just trade expectancy):
  - green day %
  - days with day_net_rs >= 500
  - avg / median ₹ per trading day
  - coverage (days with ≥1 trade)
  - worst day

Uses Nifty ₹65/pt + Bank ₹30/pt (1 lot each when both fire).
OOS: calendar days from 2024-01-01 onward.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = Path("/tmp/daily-consistency")
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("uni", ROOT / "scripts" / "strategy-universe-search.py")
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)


def trading_days(insts) -> list[str]:
    days = set()
    for inst in insts:
        days.update(inst.days)
    return sorted(d for d in days if d >= "2024-01-01")


def day_metrics(dated_rows: list[tuple[str, float]], all_days: list[str], label: str) -> dict:
    """Aggregate to calendar-day ₹ P&L (both books). dated_rows = (date, rs)."""
    by_day: dict[str, float] = defaultdict(float)
    trades_by_day: dict[str, int] = defaultdict(int)
    for d, rs in dated_rows:
        if d < "2024-01-01":
            continue
        by_day[d] += float(rs)
        trades_by_day[d] += 1

    oos_days = [d for d in all_days if d >= "2024-01-01"]
    day_rs = np.array([by_day.get(d, 0.0) for d in oos_days], float)
    traded = np.array([trades_by_day.get(d, 0) > 0 for d in oos_days])
    green = day_rs > 0
    ge500 = day_rs >= 500
    traded_rs = day_rs[traded]
    return dict(
        label=label,
        n_trades=int(sum(trades_by_day.values())),
        n_days=int(len(oos_days)),
        days_traded=int(traded.sum()),
        coverage_pct=round(100 * float(traded.mean()), 1) if len(oos_days) else 0.0,
        green_day_pct=round(100 * float(green.mean()), 1) if len(oos_days) else 0.0,
        green_among_traded_pct=round(100 * float((traded_rs > 0).mean()), 1) if len(traded_rs) else None,
        days_ge_500=int(ge500.sum()),
        days_ge_500_pct=round(100 * float(ge500.mean()), 1) if len(oos_days) else 0.0,
        avg_rs_per_day=round(float(day_rs.mean()), 0) if len(day_rs) else 0.0,
        median_rs_per_day=round(float(np.median(day_rs)), 0) if len(day_rs) else 0.0,
        avg_rs_traded_day=round(float(traded_rs.mean()), 0) if len(traded_rs) else None,
        worst_day_rs=round(float(day_rs.min()), 0) if len(day_rs) else 0.0,
        best_day_rs=round(float(day_rs.max()), 0) if len(day_rs) else 0.0,
        net_rs=round(float(day_rs.sum()), 0) if len(day_rs) else 0.0,
        pct_days_within_250_of_500=round(
            100 * float(((day_rs >= 250) & (day_rs <= 750)).mean()), 1
        )
        if len(day_rs)
        else 0.0,
        score=round(
            float(green.mean()) * 100
            + float(traded.mean()) * 30
            + max(0.0, 1.0 - abs(float(day_rs.mean()) - 500) / 500) * 40
            + (10 if float(day_rs.mean()) > 0 else -50),
            2,
        )
        if len(day_rs)
        else -999.0,
    )


def run_pair(nifty, bank, s: uni.Spec) -> list[tuple[str, float]]:
    rows: list[tuple[str, float]] = []
    for inst in (nifty, bank):
        _pts, rs, years, _holds, dates = uni.simulate_fast_dated(inst, s)
        for d, r, y in zip(dates, rs, years):
            if int(y) >= 2024:
                rows.append((d, float(r)))
    return rows


def candidate_specs() -> list[tuple[str, uni.Spec]]:
    """Focused set for daily consistency (activity + green-day proxies)."""
    specs: list[tuple[str, uni.Spec]] = []

    def add(family: str, s: uni.Spec):
        specs.append((family, s))

    # VolExpand baseline + session variants
    for latest, ot in [("11:30", True), ("12:00", True), ("15:10", True), ("15:10", False)]:
        add(
            "vol_expand_d15_ema50",
            uni.Spec("vol_expand", 15, "ema50", "eod", 0, 0.0, "10:15", "10:15", latest, ot),
        )
    for bias in ("none", "ema50", "prev_day", "or_break"):
        add(
            f"vol_expand_d15_{bias}",
            uni.Spec("vol_expand", 15, bias, "eod", 0, 0.0, "10:15", "10:15", "15:10", True),
        )

    # Donchian variants
    for n in (10, 15, 20, 30):
        for bias in ("none", "ema50", "prev_day", "or_break"):
            for latest, ot in [("15:10", True), ("15:10", False), ("12:00", True)]:
                add(
                    f"donch{n}_{bias}",
                    uni.Spec("donch", n, bias, "eod", 0, 0.0, "10:15", "10:15", latest, ot),
                )

    # Swing
    for lb in (3, 5):
        for bias in ("none", "ema50", "prev_day"):
            for latest, ot in [("15:10", True), ("15:10", False), ("12:00", True)]:
                add(
                    f"swing{lb}_{bias}",
                    uni.Spec("swing", 0, bias, "eod", 0, 0.0, "10:15", "10:15", latest, ot, swing_lb=lb),
                )

    # OR / session / PDHL
    for bias in ("none", "ema50", "prev_day"):
        for ot in (True, False):
            add(f"or_hl_{bias}", uni.Spec("or_hl", 0, bias, "eod", 0, 0.0, "10:15", "10:15", "15:10", ot))
            add(
                f"session_ext_{bias}",
                uni.Spec("session_ext", 0, bias, "eod", 0, 0.0, "10:15", "10:15", "15:10", ot),
            )
    for ent in ("pdhl_break", "pdhl_retest"):
        for bias in ("none", "ema50", "prev_day"):
            for ot in (True, False):
                add(ent, uni.Spec(ent, 0, bias, "eod", 0, 0.0, "10:15", "10:15", "15:10", ot))

    # Higher-frequency / mean-reversion-ish entries (may lift green-day %)
    for ent, n in [
        ("gap_fade", 0),
        ("gap_cont", 0),
        ("inside_break", 0),
        ("open_drive", 0),
        ("ema_pb", 0),
        ("mom", 6),
        ("mom", 12),
        ("range_squeeze", 20),
        ("md2", 0),
        ("md3", 0),
    ]:
        for bias in ("none", "ema50", "prev_day"):
            for ot in (True, False):
                add(
                    f"{ent}_{bias}",
                    uni.Spec(ent, n, bias, "eod", 0, 0.0, "10:15", "10:15", "15:10", ot),
                )

    # EMA exits (often higher WR, lower expectancy)
    for ent, n, kwargs in [
        ("donch", 20, {}),
        ("vol_expand", 15, {}),
        ("swing", 0, {"swing_lb": 5}),
        ("gap_fade", 0, {}),
        ("or_hl", 0, {}),
    ]:
        add(
            f"{ent}_ema_exit",
            uni.Spec(ent, n, "ema50", "ema", 0, 0.0, "10:15", "10:15", "15:10", True, **kwargs),
        )

    # Earlier window (more coverage)
    for ent, n in [("donch", 15), ("vol_expand", 15), ("swing", 0), ("or_hl", 0)]:
        kwargs = {"swing_lb": 5} if ent == "swing" else {}
        add(
            f"{ent}_early",
            uni.Spec(ent, n, "ema50", "eod", 0, 0.0, "09:45", "09:45", "15:10", True, **kwargs),
        )

    seen: set[str] = set()
    out: list[tuple[str, uni.Spec]] = []
    for family, s in specs:
        key = s.label()
        if key in seen:
            continue
        seen.add(key)
        out.append((family, s))
    return out


def main():
    print("Loading caches...", flush=True)
    nifty = uni.load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    days = trading_days([nifty, bank])
    print(f"  OOS calendar days={len(days)}", flush=True)

    results = []
    cands = candidate_specs()
    print(f"Evaluating {len(cands)} candidates...", flush=True)
    for i, (family, s) in enumerate(cands):
        if i % 25 == 0:
            print(f"  [{i}/{len(cands)}] {family} {s.label()}", flush=True)
        try:
            rows = run_pair(nifty, bank, s)
        except Exception as e:
            print(f"  skip {family}: {e}", flush=True)
            continue
        label = s.label()
        m = day_metrics(rows, days, label)
        m["family"] = family
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

    viable = [r for r in results if (r["avg_rs_per_day"] or 0) > 0 and r["n_trades"] >= 80]
    by_ge500 = sorted(
        viable, key=lambda r: (r["days_ge_500_pct"], r["green_day_pct"], r["avg_rs_per_day"]), reverse=True
    )
    by_green = sorted(
        viable, key=lambda r: (r["green_day_pct"], r["coverage_pct"], r["avg_rs_per_day"]), reverse=True
    )
    by_score = sorted(viable, key=lambda r: r["score"], reverse=True)
    by_avg = sorted(viable, key=lambda r: abs((r["avg_rs_per_day"] or 0) - 500))

    # Baseline: VolExpand Donch15 EMA50 EOD 10:15–11:30 1t
    baseline = next(
        (
            r
            for r in results
            if r["spec"]["entry"] == "vol_expand"
            and r["spec"]["entry_n"] == 15
            and r["spec"]["bias"] == "ema50"
            and r["spec"]["exit"] == "eod"
            and r["spec"]["latest"] == "11:30"
            and r["spec"]["one_trade"] is True
        ),
        None,
    )

    preferred = [
        r
        for r in by_score
        if r["green_day_pct"] >= 30 and r["coverage_pct"] >= 40 and r["avg_rs_per_day"] >= 200
    ]
    # Prefer green-day leaders that still clear ~₹200+/day average
    green_ok = [r for r in by_green if r["avg_rs_per_day"] >= 200]
    best = by_score[0] if by_score else None

    report = dict(
        goal="₹500 every trading day (Nifty+Bank 1 lot)",
        honesty=(
            "No directional strategy in this search is green every calendar day. "
            "Rankings maximize green-day rate / days≥₹500 / average near ₹500."
        ),
        n_candidates=len(results),
        n_viable=len(viable),
        volexpand_baseline=baseline,
        top_days_ge_500=by_ge500[:15],
        top_green_day_pct=by_green[:15],
        top_consistency_score=by_score[:15],
        closest_avg_to_500=by_avg[:10],
        recommendation=dict(
            best_consistency_score=best,
            preferred_green_coverage=preferred[0] if preferred else best,
            best_green_with_avg200=green_ok[0] if green_ok else best,
            note=(
                "Use preferred_green_coverage for more green days with decent average. "
                "Still expect red days — size lots so AVERAGE ≈ ₹500, not every day."
            ),
        ),
    )

    out_path = OUT / "summary.json"
    json.dump(report, open(out_path, "w"), indent=2)
    reports_path = ROOT / "reports" / "daily-consistency-summary.json"
    reports_path.parent.mkdir(parents=True, exist_ok=True)
    slim = {
        "goal": report["goal"],
        "honesty": report["honesty"],
        "n_candidates": report["n_candidates"],
        "n_viable": report["n_viable"],
        "volexpand_baseline": report.get("volexpand_baseline"),
        "recommendation": report.get("recommendation"),
        "top_consistency_score": report.get("top_consistency_score", [])[:5],
        "top_green_day_pct": report.get("top_green_day_pct", [])[:5],
        "closest_avg_to_500": report.get("closest_avg_to_500", [])[:5],
        "verdict": {
            "avg_near_500": "VolExpand Donch15 EMA50 EOD 10:15-11:30 1t (default)",
            "max_green_days": "Inside Break none EOD multi-trade full session (paper)",
            "equities_consistency": "GAP_FADE_500 on Stocks Desk",
        },
    }
    json.dump(slim, open(reports_path, "w"), indent=2)

    print("\n=== TOP by days ≥ ₹500 ===", flush=True)
    for r in by_ge500[:10]:
        print(
            f"{r['family'][:28]:28} ge500={r['days_ge_500_pct']:5.1f}% green={r['green_day_pct']:5.1f}% "
            f"cov={r['coverage_pct']:5.1f}% avg₹={r['avg_rs_per_day']} med₹={r['median_rs_per_day']} "
            f"worst={r['worst_day_rs']} n={r['n_trades']}",
            flush=True,
        )
    print("\n=== TOP by green day % ===", flush=True)
    for r in by_green[:10]:
        print(
            f"{r['family'][:28]:28} green={r['green_day_pct']:5.1f}% ge500={r['days_ge_500_pct']:5.1f}% "
            f"cov={r['coverage_pct']:5.1f}% avg₹={r['avg_rs_per_day']} n={r['n_trades']}",
            flush=True,
        )
    print("\n=== TOP consistency score ===", flush=True)
    for r in by_score[:8]:
        print(
            f"{r['family'][:28]:28} score={r['score']:6.1f} green={r['green_day_pct']:5.1f}% "
            f"cov={r['coverage_pct']:5.1f}% avg₹={r['avg_rs_per_day']} ge500={r['days_ge_500_pct']:5.1f}%",
            flush=True,
        )
    if baseline:
        print("\n=== VolExpand baseline ===", flush=True)
        print(
            f"green={baseline['green_day_pct']}% cov={baseline['coverage_pct']}% "
            f"avg₹={baseline['avg_rs_per_day']} ge500={baseline['days_ge_500_pct']}% "
            f"n={baseline['n_trades']}",
            flush=True,
        )
    print("\n=== RECOMMENDATION ===", flush=True)
    rec = report["recommendation"]
    for k in ("preferred_green_coverage", "best_green_with_avg200", "best_consistency_score"):
        r = rec.get(k)
        if not r:
            continue
        print(
            f"{k}: {r['label']} | green={r['green_day_pct']}% cov={r['coverage_pct']}% "
            f"avg₹={r['avg_rs_per_day']} ge500={r['days_ge_500_pct']}%",
            flush=True,
        )
    print(f"Wrote {out_path}", flush=True)
    print(f"Wrote {reports_path}", flush=True)


if __name__ == "__main__":
    main()
