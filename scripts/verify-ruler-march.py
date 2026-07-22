#!/usr/bin/env python3
"""Verify Ruler Sep-boost March baseline and DNA sensitivity."""
from __future__ import annotations

import importlib.util
import json
import sys
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


uni = load("uni", ROOT / "scripts" / "strategy-universe-search.py")
sr = load("sr", ROOT / "scripts" / "sr-pullback-retest-daily500.py")
boost = load("boost", Path("/tmp/ruler-profit-boost.py"))
sep = load("sep", ROOT / "scripts" / "ruler-sep-boost.py")

# March target under zero-red discipline (hunter when MTD red + early breaker).
MARCH_TARGET = 20115.5


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

    official = sep.run_sep_boost(
        books,
        feats,
        days,
        comb=boost.comb,
        clip=boost.clip,
        beast=boost.beast,
        edge=boost.edge,
    )
    march = official["monthly"].get("2026-03")

    # Legacy plain-trail (for regression awareness)
    legacy = boost.run(books, feats, days, "trail", "dyn0", 1500.0, None, 3000.0, "beast")

    rows = []
    for p in official["picks"]:
        f = feats.get(p["date"])
        rows.append(
            {
                **p,
                "choppy": None if f is None else bool(f["choppy"]),
                "wide": None if f is None else bool(f["wide"]),
                "strong": None if f is None else bool(f["strong"]),
                "ema_buy": None if f is None else bool(f["ema_buy"]),
                "ema_sell": None if f is None else bool(f["ema_sell"]),
                "drive": None if f is None else round(float(f["drive"]), 4),
            }
        )

    report = {
        "recipe": official["recipe"],
        "official_march": march,
        "legacy_trail_march": legacy["monthly"].get("2026-03"),
        "official_arms": official["arms"],
        "pass_official_near_target": abs(float(march) - MARCH_TARGET) < 1.0,
        "pass_still_green": float(march) > 15000,
        "days": rows,
    }
    (OUT / "march-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in report if k != "days"}, indent=2))
    if not report["pass_official_near_target"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
