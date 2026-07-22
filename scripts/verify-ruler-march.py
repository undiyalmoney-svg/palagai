#!/usr/bin/env python3
"""Verify Ruler research March baseline and Angular DNA sensitivity."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

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


uni = load("uni", ROOT / "scripts" / "strategy-universe-search.py")
sr = load("sr", ROOT / "scripts" / "sr-pullback-retest-daily500.py")
boost = load("boost", Path("/tmp/ruler-profit-boost.py"))


def main() -> None:
    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    books = boost.build(nifty, bank)
    days = sorted(
        d for d in (set(nifty.day_starts) | set(bank.day_starts)) if d.startswith("2026-03")
    )
    feats = {}
    for d in days:
        fn = boost.morning_feat(nifty, d) if d in nifty.day_starts else None
        feats[d] = fn or (boost.morning_feat(bank, d) if d in bank.day_starts else None)

    official = boost.run(books, feats, days, "trail", "dyn0", 1500.0, None, 3000.0, "beast")
    march = official["monthly"].get("2026-03")

    # 1t trail books (Angular maxTrades=1 on DONCH_TRAIL)
    sp_1t = sr.SRSpec("donch_retest", 20, "or_break", "swing_trail", "09:45", "09:45", "15:10", True)
    books_1t = {k: dict(v) for k, v in books.items()}
    for inst, name in ((nifty, "nifty"), (bank, "bank")):
        _, rs, _, dates = sr.simulate(inst, sp_1t)
        books_1t["DONCH_TRAIL"][name] = boost.day_pnl(dates, rs)
    one_t = boost.run(books_1t, feats, days, "trail", "dyn0", 1500.0, None, 3000.0, "beast")

    rows = []
    mtd = 0.0
    for d in days:
        f = feats.get(d)
        arm = boost.beast(f) if mtd < 3000 else boost.trail(f)
        raw = boost.comb(books, arm, d)
        if mtd > 0:
            dyn = min(1500.0, mtd)
            clipped = boost.clip(raw, dyn) if dyn > 0 else 0.0
        else:
            clipped = boost.clip(raw, 1500.0)
        rows.append(
            {
                "date": d,
                "arm": arm,
                "raw": round(raw, 2),
                "clipped": round(clipped, 2),
                "mtd_before": round(mtd, 2),
                "choppy": None if f is None else bool(f["choppy"]),
                "wide": None if f is None else bool(f["wide"]),
                "strong": None if f is None else bool(f["strong"]),
                "ema_buy": None if f is None else bool(f["ema_buy"]),
                "ema_sell": None if f is None else bool(f["ema_sell"]),
                "drive": None if f is None else round(float(f["drive"]), 4),
            }
        )
        mtd += clipped

    report = {
        "official_march": march,
        "official_arms": official["arms"],
        "one_trade_trail_march": one_t["monthly"].get("2026-03"),
        "pass_official_near_20212": abs(float(march) - 20212.0) < 1.0,
        "pass_one_t_still_green": float(one_t["monthly"].get("2026-03", 0)) > 0,
        "days": rows,
    }
    (OUT / "march-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in report if k != "days"}, indent=2))


if __name__ == "__main__":
    main()
