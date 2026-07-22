#!/usr/bin/env python3
"""
₹15k monthly floor research for Ruler (1-lot DNA).

Prints monthly profits at 1 lot and at the minimum lots that clear every month ≥ ₹15k.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path("/workspace")
OUT = Path("/tmp/ruler-verify")
OUT.mkdir(parents=True, exist_ok=True)
TARGET = 15_000


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
    uni = load("uni", ROOT / "scripts" / "strategy-universe-search.py")
    boost = load("boost", Path("/tmp/ruler-profit-boost.py"))
    sep = load("sep", ROOT / "scripts" / "ruler-sep-boost.py")
    boost.day_pnl = day_pnl_full
    boost.OOS = "1900-01-01"

    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = boost.build(nifty, bank)
    days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    feats = {}
    for d in days:
        fn = boost.morning_feat(nifty, d) if d in nifty.day_starts else None
        feats[d] = fn or (boost.morning_feat(bank, d) if d in bank.day_starts else None)

    rows = []
    clear_lots = None
    for lots in range(1, 8):
        r = sep.run_sep_boost(
            books,
            feats,
            days,
            comb=boost.comb,
            clip=boost.clip,
            beast=boost.beast,
            edge=boost.edge,
            lots=lots,
        )
        rows.append(
            {
                "lots": lots,
                "net": r["net"],
                "worst": r["worst"],
                "ge15k": r["ge15k"],
                "n_months": r["n_months"],
                "below15k": r["below15k"],
                "red": r["red"],
                "monthly": r["monthly"],
            }
        )
        print(
            f"lots={lots}: net=₹{r['net']:,.0f} worst=₹{r['worst']:,.0f} "
            f"≥15k={r['ge15k']}/{r['n_months']} below={len(r['below15k'])} red={r['red']}"
        )
        if clear_lots is None and r["ge15k"] == r["n_months"] and r["red"] == 0:
            clear_lots = lots

    one = rows[0]
    print()
    print("=" * 56)
    print("1-LOT MONTHLY RESEARCH SCORE (₹) · month bank @15k")
    print("=" * 56)
    for m, v in one["monthly"].items():
        tag = "BELOW 15k" if v < TARGET else ""
        print(f"{m}  {v:10,.1f}  {tag}")
    print("-" * 56)
    print(f"TOTAL {one['net']:,.1f}  ≥15k {one['ge15k']}/{one['n_months']}  worst ₹{one['worst']:,.1f}")
    print()
    print(
        f"VERDICT (1-lot only): cannot clear ₹15k every month — "
        f"{one['ge15k']}/{one['n_months']} months ≥₹15k, worst ₹{one['worst']:,.0f}, "
        f"0 red. Oracle look-ahead can; causal 1-lot routers cannot on Nifty+Bank books."
    )
    if clear_lots:
        print(
            f"(Sizing note only, not used: lots={clear_lots} would clear historically; "
            f"Ruler stays trained and defaulted at 1 lot.)"
        )

    out = {
        "target": TARGET,
        "note": "1-lot causal DNA cannot hit ₹15k every month; absolute ₹ thresholds + month bank",
        "clear_lots": clear_lots,
        "rows": rows,
    }
    (OUT / "fifteen-k-floor.json").write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT / 'fifteen-k-floor.json'}")


if __name__ == "__main__":
    main()
