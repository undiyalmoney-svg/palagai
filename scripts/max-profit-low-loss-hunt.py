#!/usr/bin/env python3
"""
Max-profit / low-loss hunt vs GENIE on Nifty+Bank (1+1 lot, pts×65/×30).

Walk-forward: train 2020-01 → 2023-12, test 2024-01 → 2026-07.
Score = net↑, drawdown↓, red↓. Prefer books that beat GENIE on BOTH halves.
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
OUT = ROOT / "reports" / "max-profit-low-loss"
OUT.mkdir(parents=True, exist_ok=True)

TRAIN_END = "2023-12-31"
TEST_START = "2024-01-01"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


L = load("loops", ROOT / "scripts" / "smart-pb-pro-trader-loops.py")
L.CACHE = CACHE
G = load("genie_router", ROOT / "scripts" / "smart-pb-genie-router.py")
G.CACHE = CACHE
G.OOS = "2020-01-01"


@dataclass(frozen=True)
class Book:
    name: str
    n_exit: str
    b_exit: str
    n_mt: int
    b_mt: int
    router: str  # genie_v3 | always_both | bank_first | nifty_first | align_only | best_drive | genie_bank_bias


def alone(f):
    return "NIFTY" if f.n_drive >= f.b_drive else "BANK"


def drv_skip(f, md):
    if max(f.n_drive, f.b_drive) < md:
        return "SKIP"
    return "BOTH" if f.aligned else alone(f)


def route(f, name: str) -> str:
    if f is None:
        return "SKIP"
    if name == "genie_v3":
        if f.wd == 1:
            return "SKIP"
        if f.wd == 4:
            return "BOTH"
        if f.wd == 0:
            return drv_skip(f, 0.35)
        if f.wd == 2:
            return drv_skip(f, 0.25)
        return "BOTH" if f.aligned else alone(f)
    if name == "always_both":
        return "BOTH"
    if name == "bank_first":
        # Prefer Bank; add Nifty only when aligned + decent drive
        if f.wd == 1:
            return "SKIP"
        if max(f.n_drive, f.b_drive) < 0.25:
            return "SKIP"
        if f.aligned and min(f.n_drive, f.b_drive) >= 0.3:
            return "BOTH"
        return "BANK" if f.b_drive >= f.n_drive - 0.05 else "NIFTY"
    if name == "nifty_first":
        if f.wd == 1:
            return "SKIP"
        if max(f.n_drive, f.b_drive) < 0.25:
            return "SKIP"
        if f.aligned:
            return "BOTH"
        return "NIFTY"
    if name == "align_only":
        if f.wd == 1:
            return "SKIP"
        return "BOTH" if f.aligned else "SKIP"
    if name == "best_drive":
        if f.wd == 1:
            return "SKIP"
        if max(f.n_drive, f.b_drive) < 0.3:
            return "SKIP"
        if f.aligned and min(f.n_drive, f.b_drive) >= 0.35:
            return "BOTH"
        return alone(f)
    if name == "genie_bank_bias":
        # GENIE weekdays but prefer BANK alone over NIFTY alone
        if f.wd == 1:
            return "SKIP"
        if f.wd == 4:
            return "BOTH" if f.aligned else ("BANK" if f.b_drive >= 0.25 else "BOTH")
        if f.wd == 0 and max(f.n_drive, f.b_drive) < 0.35:
            return "SKIP"
        if f.wd == 2 and max(f.n_drive, f.b_drive) < 0.25:
            return "SKIP"
        if f.aligned:
            return "BOTH"
        return "BANK" if f.b_drive + 0.05 >= f.n_drive else "NIFTY"
    if name == "skip_weak_both":
        if f.wd == 1:
            return "SKIP"
        if max(f.n_drive, f.b_drive) < 0.4:
            return "SKIP"
        return "BOTH" if f.aligned else alone(f)
    return "SKIP"


def max_drawdown(daily: np.ndarray) -> float:
    eq = np.cumsum(daily)
    peak = np.maximum.accumulate(eq)
    dd = eq - peak
    return float(dd.min()) if len(dd) else 0.0


def metrics(day_rs: dict[str, float], days: list[str]) -> dict:
    xs = np.array([day_rs.get(d, 0.0) for d in days], float)
    if not len(xs):
        return {}
    traded = np.array([d in day_rs and day_rs[d] != 0 for d in days])
    return {
        "days": len(xs),
        "net": round(float(xs.sum())),
        "avg": round(float(xs.mean())),
        "median": round(float(np.median(xs))),
        "green_pct": round(100 * float((xs > 0).mean()), 1),
        "red_pct": round(100 * float((xs < 0).mean()), 1),
        "worst": round(float(xs.min())),
        "best": round(float(xs.max())),
        "max_dd": round(max_drawdown(xs)),
        "coverage_pct": round(100 * float(traded.mean()), 1),
        "profit_factor": round(
            float(xs[xs > 0].sum() / abs(xs[xs < 0].sum())) if (xs < 0).any() else 99.0, 2
        ),
        "pain": round(abs(max_drawdown(xs)) + abs(min(float(xs.min()), 0)), 0),
    }


def score(train: dict, test: dict) -> float:
    if not train or not test:
        return -1e12
    # Must be profitable both halves
    if train["net"] <= 0 or test["net"] <= 0:
        return -1e12 + train["net"] + test["net"]
    s = 0.0
    s += test["net"] * 0.0015 + train["net"] * 0.0008
    s += test["avg"] * 0.8 + train["avg"] * 0.4
    s -= abs(test["max_dd"]) * 0.04 + abs(train["max_dd"]) * 0.02
    s -= test["red_pct"] * 25 + train["red_pct"] * 10
    s += min(test["profit_factor"], 3.0) * 200
    # prefer higher net per unit of drawdown
    if abs(test["max_dd"]) > 0:
        s += (test["net"] / abs(test["max_dd"])) * 80
    return round(s, 1)


def build_books() -> list[Book]:
    books = []
    routers = [
        "genie_v3",
        "always_both",
        "bank_first",
        "nifty_first",
        "align_only",
        "best_drive",
        "genie_bank_bias",
        "skip_weak_both",
    ]
    n_exits = ["rr2", "rr2_5", "rr3"]
    b_exits = ["rr1_5", "rr2", "rr2_5"]
    for router in routers:
        for ne in n_exits:
            for be in b_exits:
                for n_mt in (1, 2):
                    for b_mt in (1,):
                        name = f"{router}|N{ne}|B{be}|mt{n_mt}/{b_mt}"
                        books.append(Book(name, ne, be, n_mt, b_mt, router))
    return books


def simulate_pair(nifty, bank, book: Book, feats, all_days):
    n_loop = L.Loop(
        entry="pine_bo",
        exit=book.n_exit,
        earliest="10:15",
        latest="14:30",
        max_trades=book.n_mt,
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
        exit=book.b_exit,
        earliest="10:15",
        latest="14:30",
        max_trades=book.b_mt,
        min_gap=30,
        skip_sideways=True,
        regime="none",
        confluence="or_mid",
        book="bank",
        strong_mult=0.8,
        retest_tol=12,
    )
    n_tr = G.simulate_leg(nifty, n_loop)
    b_tr = G.simulate_leg(bank, b_loop)
    n_by = defaultdict(float)
    b_list = defaultdict(list)
    for t in n_tr:
        n_by[t["date"]] += t["rs"]
    for t in b_tr:
        b_list[t["date"]].append(t)

    b_by_sync = {}
    b_by_all = defaultdict(float)
    for d, ts in b_list.items():
        b_by_all[d] = sum(t["rs"] for t in ts)
        f = feats.get(d)
        if not f:
            continue
        matched = [t for t in ts if t["dir"] == f.n_bias]
        if matched:
            b_by_sync[d] = sum(t["rs"] for t in matched)

    day_rs = {}
    for d in all_days:
        f = feats.get(d)
        mode = route(f, book.router)
        rs = 0.0
        if mode in ("BOTH", "NIFTY"):
            rs += n_by.get(d, 0.0)
        if mode == "BANK":
            # bank alone: use all bank (or sync if bias exists)
            if d in b_by_sync:
                rs += b_by_sync[d]
            else:
                rs += b_by_all.get(d, 0.0)
        elif mode == "BOTH":
            if f and f.aligned and d in b_by_sync:
                rs += b_by_sync[d]
            elif d in b_by_sync:
                rs += b_by_sync[d]
        if rs != 0 or mode != "SKIP":
            # only store if traded or skip (0)
            if mode == "SKIP":
                continue
            day_rs[d] = rs
    return day_rs


def main():
    print("Loading…", flush=True)
    nifty = L.load_inst("nifty", CACHE / "nifty-5m-2020-2026.json")
    bank = L.load_inst("bank", CACHE / "banknifty-5m-2020-2026.json")
    all_days = sorted(d for d in set(nifty.day_starts) | set(bank.day_starts) if d >= "2020-01-01")
    train_days = [d for d in all_days if d <= TRAIN_END]
    test_days = [d for d in all_days if d >= TEST_START]
    feats = G.build_feats(nifty, bank, all_days)
    print(f"days {len(all_days)} train {len(train_days)} test {len(test_days)}", flush=True)

    books = build_books()
    print(f"Books: {len(books)}", flush=True)

    # Cache legs by (exit, mt) to avoid resimulating
    n_cache = {}
    b_cache = {}

    def get_n(exit_name, mt):
        key = (exit_name, mt)
        if key not in n_cache:
            loop = L.Loop(
                entry="pine_bo", exit=exit_name, earliest="10:15", latest="14:30",
                max_trades=mt, min_gap=15, skip_sideways=True, regime="none",
                confluence="or_mid", book="nifty", strong_mult=0.6, retest_tol=10,
            )
            tr = G.simulate_leg(nifty, loop)
            by = defaultdict(float)
            for t in tr:
                by[t["date"]] += t["rs"]
            n_cache[key] = by
        return n_cache[key]

    def get_b(exit_name, mt):
        key = (exit_name, mt)
        if key not in b_cache:
            loop = L.Loop(
                entry="armed_retest", exit=exit_name, earliest="10:15", latest="14:30",
                max_trades=mt, min_gap=30, skip_sideways=True, regime="none",
                confluence="or_mid", book="bank", strong_mult=0.8, retest_tol=12,
            )
            tr = G.simulate_leg(bank, loop)
            by_all = defaultdict(float)
            by_list = defaultdict(list)
            for t in tr:
                by_all[t["date"]] += t["rs"]
                by_list[t["date"]].append(t)
            b_cache[key] = (by_all, by_list)
        return b_cache[key]

    rows = []
    for i, book in enumerate(books, 1):
        if i % 40 == 0 or i == 1:
            print(f"  … {i}/{len(books)}", flush=True)
        n_by = get_n(book.n_exit, book.n_mt)
        b_all, b_list = get_b(book.b_exit, book.b_mt)
        b_sync = {}
        for d, ts in b_list.items():
            f = feats.get(d)
            if not f:
                continue
            matched = [t for t in ts if t["dir"] == f.n_bias]
            if matched:
                b_sync[d] = sum(t["rs"] for t in matched)

        day_rs = {}
        for d in all_days:
            f = feats.get(d)
            mode = route(f, book.router)
            if mode == "SKIP":
                continue
            rs = 0.0
            if mode in ("BOTH", "NIFTY"):
                rs += n_by.get(d, 0.0)
            if mode == "BANK":
                rs += b_sync.get(d, b_all.get(d, 0.0))
            elif mode == "BOTH":
                if f and f.aligned:
                    rs += b_sync.get(d, 0.0)
                else:
                    rs += b_sync.get(d, 0.0)
            day_rs[d] = rs

        tr = metrics(day_rs, train_days)
        te = metrics(day_rs, test_days)
        full = metrics(day_rs, all_days)
        # yearly test
        years = {}
        for y in ["2024", "2025", "2026"]:
            yd = [d for d in test_days if d.startswith(y)]
            years[y] = metrics(day_rs, yd)
        rows.append(
            {
                "id": book.name,
                "router": book.router,
                "n_exit": book.n_exit,
                "b_exit": book.b_exit,
                "score": score(tr, te),
                "train": tr,
                "test": te,
                "full": full,
                "years": years,
            }
        )

    rows.sort(key=lambda r: -r["score"])
    # Beat GENIE baseline on test net AND better (lower) abs drawdown or red
    genie = next(r for r in rows if r["id"].startswith("genie_v3|Nrr3|Brr1_5|mt2/1"))
    beaters = [
        r
        for r in rows
        if r["train"]["net"] > 0
        and r["test"]["net"] > genie["test"]["net"]
        and (
            abs(r["test"]["max_dd"]) <= abs(genie["test"]["max_dd"]) * 1.05
            or r["test"]["red_pct"] <= genie["test"]["red_pct"]
        )
    ]
    # Also: best net with red <= genie red
    low_loss = [
        r
        for r in rows
        if r["train"]["net"] > 0
        and r["test"]["net"] > 0
        and r["test"]["red_pct"] <= genie["test"]["red_pct"]
        and abs(r["test"]["max_dd"]) <= abs(genie["test"]["max_dd"])
    ]
    low_loss.sort(key=lambda r: (-r["test"]["net"], r["test"]["red_pct"]))

    # Best efficiency: test net / abs(dd)
    eff = [
        r
        for r in rows
        if r["train"]["net"] > 0 and r["test"]["net"] > 0 and abs(r["test"]["max_dd"]) > 0
    ]
    eff.sort(key=lambda r: -(r["test"]["net"] / abs(r["test"]["max_dd"])))

    champ = beaters[0] if beaters else (low_loss[0] if low_loss else rows[0])

    out = {
        "goal": "Max profit with less loss vs GENIE @ 1 lot Nifty + 1 lot Bank",
        "proxy": "index pts ×65 / ×30",
        "walk_forward": {"train": f"2020→{TRAIN_END}", "test": f"{TEST_START}→2026-07"},
        "tested": len(rows),
        "genie_baseline": genie,
        "champion": champ,
        "top_score": rows[:12],
        "beat_genie_net_and_risk": beaters[:10],
        "best_low_loss": low_loss[:10],
        "best_efficiency_net_per_dd": [
            {
                **{k: r[k] for k in ("id", "score", "train", "test", "years")},
                "net_per_dd": round(r["test"]["net"] / abs(r["test"]["max_dd"]), 2),
            }
            for r in eff[:10]
        ],
        "honest_note": (
            "Causal routers only. Look-ahead oracle not allowed. "
            "Option premium path / charges not modeled."
        ),
    }
    (OUT / "summary.json").write_text(json.dumps(out, indent=2))

    def line(r, tag=""):
        t, e = r["train"], r["test"]
        print(
            f"{tag}{r['id'][:56]:<56} "
            f"train₹{t['net']:>8} red{t['red_pct']:>5}% dd{t['max_dd']:>8} | "
            f"test₹{e['net']:>8} avg{e['avg']:>5} red{e['red_pct']:>5}% dd{e['max_dd']:>8} "
            f"pf{e['profit_factor']:>4}",
            flush=True,
        )

    print("\n=== GENIE BASELINE ===", flush=True)
    line(genie, "  ")
    print("\n=== TOP SCORE ===", flush=True)
    for r in rows[:10]:
        line(r, "  ")
    print("\n=== BEATS GENIE (higher test net + not worse risk) ===", flush=True)
    if beaters:
        for r in beaters[:8]:
            line(r, "  ")
    else:
        print("  NONE", flush=True)
    print("\n=== BEST LOW-LOSS (dd & red ≤ GENIE, max test net) ===", flush=True)
    for r in low_loss[:8]:
        line(r, "  ")
    print("\n=== BEST NET / |DRAWDOWN| ===", flush=True)
    for r in eff[:8]:
        print(
            f"  {r['id'][:56]:<56} net/dd={r['test']['net']/abs(r['test']['max_dd']):.2f} "
            f"test₹{r['test']['net']} dd{r['test']['max_dd']} red{r['test']['red_pct']}%",
            flush=True,
        )
    print(f"\nCHAMPION → {champ['id']}", flush=True)
    print(f"Wrote {OUT / 'summary.json'}", flush=True)


if __name__ == "__main__":
    main()
