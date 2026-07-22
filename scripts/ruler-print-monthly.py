#!/usr/bin/env python3
"""
Print Ruler monthly research-score profits (day-capped ₹).

Default: current discipline recipe on full cache (2020–2026).
No 2018–2019 candles in-repo.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path("/workspace")
OUT = Path("/tmp/ruler-verify")
OUT.mkdir(parents=True, exist_ok=True)


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def day_pnl_full(dates, rs):
    out = defaultdict(float)
    for d, r in zip(dates, rs):
        out[d] += float(r)
    return dict(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="date_from", default="2020-01-01")
    ap.add_argument("--to", dest="date_to", default="2026-07-21")
    ap.add_argument("--json", dest="json_out", default=str(OUT / "monthly-profits.json"))
    args = ap.parse_args()

    uni = load("uni", ROOT / "scripts" / "strategy-universe-search.py")
    boost = load("boost", Path("/tmp/ruler-profit-boost.py"))
    sep = load("sep", ROOT / "scripts" / "ruler-sep-boost.py")
    boost.day_pnl = day_pnl_full
    boost.OOS = "1900-01-01"

    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = boost.build(nifty, bank)
    days = sorted(
        d
        for d in (set(nifty.day_starts) | set(bank.day_starts))
        if args.date_from <= d <= args.date_to
    )
    feats = {}
    for d in days:
        fn = boost.morning_feat(nifty, d) if d in nifty.day_starts else None
        feats[d] = fn or (boost.morning_feat(bank, d) if d in bank.day_starts else None)

    result = sep.run_sep_boost(
        books,
        feats,
        days,
        comb=boost.comb,
        clip=boost.clip,
        beast=boost.beast,
        edge=boost.edge,
    )
    mon = result["monthly"]

    print()
    print("=" * 56)
    print("RULER DISCIPLINE · MONTHLY RESEARCH SCORE (₹)")
    print("Recipe:", result["recipe"])
    print(f"Window: {args.date_from} .. {args.date_to}")
    if args.date_from < "2020-01-01":
        print("NOTE: no 2018–2019 candles in cache — early months absent")
    print("=" * 56)
    print(f"{'MONTH':<10} {'PROFIT ₹':>12}  NOTE")
    print("-" * 56)
    for m, v in sorted(mon.items()):
        note = "RED" if v < 0 else ("below 15k" if v < 15000 else "")
        print(f"{m:<10} {v:>12,.1f}  {note}")
    print("-" * 56)
    print(f"{'TOTAL':<10} {result['net']:>12,.1f}")
    ge = sum(1 for v in mon.values() if v >= 15000)
    print(
        f"Red months: {result['red']}  Worst: ₹{result['worst']:,.1f}  Best: ₹{result['best']:,.1f}  "
        f"≥₹15k: {ge}/{len(mon)}"
    )
    print()

    payload = {
        "recipe": result["recipe"],
        "from": args.date_from,
        "to": args.date_to,
        "note": "Research score = day-capped ₹; no 2018-2019 cache",
        "monthly": mon,
        "net": result["net"],
        "red": result["red"],
        "worst": result["worst"],
        "best": result["best"],
        "arms": result["arms"],
    }
    Path(args.json_out).write_text(json.dumps(payload, indent=2))
    print(f"Wrote {args.json_out}")


if __name__ == "__main__":
    main()
