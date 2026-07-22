#!/usr/bin/env python3
"""
Scan weak / red months under current vs prior Ruler recipes.

Note: analyst cache is 2020-01-01..2026-07-21 — there is no 2018–2019 data.
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


def day_pnl_full(dates, rs):
    out = defaultdict(float)
    for d, r in zip(dates, rs):
        out[d] += float(r)
    return dict(out)


def main() -> None:
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

    discipline = sep.run_sep_boost(
        books,
        feats,
        days,
        comb=boost.comb,
        clip=boost.clip,
        beast=boost.beast,
        edge=boost.edge,
    )
    # Prior Sep-boost: wide trail, streak 3, cap 1500
    prior = sep.run_sep_boost(
        books,
        feats,
        days,
        comb=boost.comb,
        clip=boost.clip,
        beast=boost.beast,
        edge=boost.edge,
        base_cap=1500.0,
        loss_streak=3,
        post=sep.trail_wide_else_2r,
    )

    def soft_red(mon: dict[str, float]):
        red = sorted(m for m, v in mon.items() if v < 0)
        soft = sorted(m for m, v in mon.items() if 0 <= v < 5000)
        return red, soft

    d_red, d_soft = soft_red(discipline["monthly"])
    p_red, p_soft = soft_red(prior["monthly"])
    report = {
        "note": "Cache 2020-01-01..2026-07-21 only — no 2018-2019 data",
        "requested_window": "2018-2026",
        "available_window": f"{days[0]}..{days[-1]}",
        "discipline": {
            "recipe": discipline["recipe"],
            "net": discipline["net"],
            "red": discipline["red"],
            "red_list": d_red,
            "soft_list": d_soft,
            "worst": discipline["worst"],
            "sep25": discipline["monthly"].get("2025-09"),
            "mar26": discipline["monthly"].get("2026-03"),
            "monthly": discipline["monthly"],
            "arms": discipline["arms"],
        },
        "prior_sep_boost": {
            "recipe": "beast@3k→trail_wide + streak3→edge · day_cap₹1500",
            "net": prior["net"],
            "red": prior["red"],
            "red_list": p_red,
            "soft_list": p_soft,
            "worst": prior["worst"],
            "sep25": prior["monthly"].get("2025-09"),
            "mar26": prior["monthly"].get("2026-03"),
            "monthly": prior["monthly"],
        },
    }
    (OUT / "weak-months-scan.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in report if k not in ("discipline", "prior_sep_boost")}, indent=2))
    print("discipline", {k: report["discipline"][k] for k in ("net", "red", "worst", "red_list", "sep25", "mar26")})
    print("prior     ", {k: report["prior_sep_boost"][k] for k in ("net", "red", "worst", "red_list", "sep25", "mar26")})


if __name__ == "__main__":
    main()
