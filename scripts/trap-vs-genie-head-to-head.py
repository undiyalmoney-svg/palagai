#!/usr/bin/env python3
"""
Head-to-head: App Trap DNA vs App Genie legs on SAME windows.
Metric: index pts × lot (Nifty×65 · Bank×30) — research proxy.
NOT desk option ₹ (that path is currently unreliable).

    python3 scripts/trap-vs-genie-head-to-head.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"

# --- Trap hunt ---
import importlib.util

spec = importlib.util.spec_from_file_location(
    "trap_hunt", ROOT / "scripts" / "sr-trap-confirm-max-earn-hunt.py"
)
TH = importlib.util.module_from_spec(spec)
spec.loader.exec_module(TH)

# --- Smart-PB / Genie legs ---
spec2 = importlib.util.spec_from_file_location(
    "loops", ROOT / "scripts" / "smart-pb-pro-trader-loops.py"
)
L = importlib.util.module_from_spec(spec2)
sys.modules["loops"] = L
spec2.loader.exec_module(L)
L.CACHE = CACHE  # override /workspace path

APP_TRAP = dict(
    mode="both",
    confirm="next",
    ema=True,
    third=False,
    or_mid=False,
    side="both",
    rr=3.5,
    mt=3,
    dl=80,
    es=9 * 60 + 45,
    ee=14 * 60 + 45,
    cd=3,
    max_risk=28,
    min_risk=4,
    lb=5,
    pierce_pts=3.0,
)


def summarize(day_rs: dict[str, float]) -> dict:
    if not day_rs:
        return dict(days=0, traded=0, net=0, avg=0, green_pct=0, red_pct=0, best=0, worst=0)
    vals = list(day_rs.values())
    traded = [v for v in vals if abs(v) > 1e-9]
    green = sum(1 for v in traded if v > 0)
    red = sum(1 for v in traded if v < 0)
    net = float(sum(vals))
    n = len(day_rs)
    return dict(
        days=n,
        traded=len(traded),
        net=round(net),
        avg=round(net / n) if n else 0,
        green_pct=round(100 * green / len(traded), 1) if traded else 0,
        red_pct=round(100 * red / len(traded), 1) if traded else 0,
        best=round(max(vals)) if vals else 0,
        worst=round(min(vals)) if vals else 0,
    )


def calendar_days(nifty_days, bank_days, start: str, end: str) -> list[str]:
    return sorted({d for d in set(nifty_days) | set(bank_days) if start <= d <= end})


def trap_book(nifty, bank, days: list[str]) -> dict[str, float]:
    out: dict[str, float] = {d: 0.0 for d in days}
    for mk, max_risk, min_risk in ((nifty, 28, 4), (bank, 50, 8)):
        cfg = dict(APP_TRAP, max_risk=max_risk, min_risk=min_risk)
        pc = TH.precompute(mk, cfg["lb"], cfg["pierce_pts"])
        day_rs = TH.simulate(mk, pc, cfg)
        for d, v in day_rs.items():
            if d in out:
                out[d] += v
    return out


def genie_book(nifty_inst, bank_inst, days: list[str]) -> dict[str, float]:
    """Genie-ish: Nifty pine_bo 3R mt2 + Bank armed_retest 1.5R mt1, Tue SKIP."""
    nifty_loop = L.Loop(
        entry="pine_bo",
        exit="rr3",
        earliest="10:15",
        latest="14:30",
        max_trades=2,
        min_gap=15,
        skip_sideways=True,
        regime="none",
        confluence="or_mid",
        book="indep",
        strong_mult=0.6,
        retest_tol=5.0,
    )
    bank_loop = L.Loop(
        entry="armed_retest",
        exit="rr1_5",
        earliest="10:15",
        latest="14:30",
        max_trades=1,
        min_gap=30,
        skip_sideways=True,
        regime="none",
        confluence="or_mid",
        book="indep",
        strong_mult=0.8,
        retest_tol=12.0,
    )
    # simulate from early so indicators warm; filter window after
    n_trades = L.simulate_inst(nifty_inst, nifty_loop, "2020-01-01")
    b_trades = L.simulate_inst(bank_inst, bank_loop, "2020-01-01")
    out: dict[str, float] = {d: 0.0 for d in days}
    for t in n_trades + b_trades:
        d = t["date"] if isinstance(t, dict) else t[0]
        rs = t["rs"] if isinstance(t, dict) else t[1]
        if d in out:
            # Tue SKIP (GENIE v3)
            wd = datetime.strptime(d, "%Y-%m-%d").weekday()  # Mon=0 … Tue=1
            if wd == 1:
                continue
            out[d] += float(rs)
    return out


def fmt(s: dict) -> str:
    return (
        f"net=₹{s['net']:>8,}  avg=₹{s['avg']:>5,}  "
        f"traded={s['traded']:>3}  green={s['green_pct']:>5}%  red={s['red_pct']:>5}%  "
        f"best=₹{s['best']:>6,}  worst=₹{s['worst']:>7,}"
    )


def main():
    print("Loading cache…")
    nifty = TH.load("nifty-5m-2020-2026.json", 65.0)
    bank = TH.load("banknifty-5m-2020-2026.json", 30.0)
    nifty_inst = L.load_inst("nifty", CACHE / "nifty-5m-2020-2026.json")
    bank_inst = L.load_inst("bank", CACHE / "banknifty-5m-2020-2026.json")
    last = str(nifty["days"][-1])[:10]
    print(f"Cache last bar date: {last}")
    print(f"App Trap DNA: {APP_TRAP}")
    print("Genie legs: Nifty pine_bo·3R·mt2 + Bank armed_retest·1.5R·mt1 · Tue SKIP")
    print()

    windows = [
        ("2026-07-01", min("2026-07-26", last), "Jul 2026 (your desk ∩ cache)"),
        ("2026-06-01", "2026-06-30", "Jun 2026"),
        ("2026-01-01", last, "2026 YTD"),
        ("2025-07-01", "2025-07-31", "Jul 2025"),
        ("2024-01-01", last, "OOS 2024+"),
    ]

    results = []
    for start, end, label in windows:
        days = calendar_days(nifty["days"], bank["days"], start, end)
        t = trap_book(nifty, bank, days)
        g = genie_book(nifty_inst, bank_inst, days)
        st, sg = summarize(t), summarize(g)
        winner = "TRAP" if st["net"] > sg["net"] else ("GENIE" if sg["net"] > st["net"] else "TIE")
        results.append(
            dict(label=label, start=start, end=end, trap=st, genie=sg, winner=winner)
        )
        print(f"=== {label}  ({start} → {end}, {len(days)} sessions) ===")
        print(f"  TRAP   {fmt(st)}")
        print(f"  GENIE  {fmt(sg)}")
        print(f"  → {winner} by ₹{abs(st['net'] - sg['net']):,}")
        print()

    out = ROOT / "reports" / "trap-vs-genie-head-to-head.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "cache_last": last,
        "metric": "index pts × lot (NOT option premium)",
        "note": "Desk option ₹ can diverge wildly; trust this proxy + index pts column first.",
        "app_trap": APP_TRAP,
        "windows": results,
    }
    out.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {out}")

    # Bottom line for user
    jul = next(r for r in results if r["label"].startswith("Jul 2026"))
    oos = next(r for r in results if r["label"].startswith("OOS"))
    print("BOTTOM LINE")
    print(
        f"  Jul 2026 (partial cache): Trap ₹{jul['trap']['net']:,} vs Genie ₹{jul['genie']['net']:,} → {jul['winner']}"
    )
    print(
        f"  OOS 2024+: Trap ₹{oos['trap']['net']:,} vs Genie ₹{oos['genie']['net']:,} → {oos['winner']}"
    )
    if jul["winner"] == "GENIE" and oos["winner"] == "TRAP":
        print("  Research Trap>Genie is LONG-RUN. Your recent Jul stretch can still favor Genie.")
    if jul["winner"] == "GENIE":
        print("  For money NOW on recent tape: prefer Genie until Trap wins same-window index pts.")


if __name__ == "__main__":
    main()
