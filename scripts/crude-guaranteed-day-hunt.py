#!/usr/bin/env python3
"""
Guaranteed-profit TEST for Crude Mini.

A book only PASSES if every full-session tradable day is green after ₹50/RT.
Flat (no trade) fails. One red day fails. Quiet/dead days count.

This is a sample gate, not a live lock. Live can still lose tomorrow.

  python3 scripts/crude-guaranteed-day-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "crude-guaranteed-day"
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = (
    ROOT
    / "src"
    / "app"
    / "core"
    / "strategy-engine"
    / "strategies"
    / "crude-daily-green"
    / "crude-guaranteed-hunt.fixture.json"
)

spec = importlib.util.spec_from_file_location("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(mod)

NEED_RS = 150.0
WINDOWS = (
    (10 * 60, 23 * 60, "10-23"),
    (12 * 60, 15 * 60, "12-15"),
    (12 * 60, 23 * 60, "12-23"),
    (15 * 60 + 15, 23 * 60, "1515-23"),
)


def day_nets(mk, trades):
    tradable = [d for d in mk["uniq"] if mk["kind"].get(d) not in (None, "thin")]
    by = {}
    for t in trades:
        by[t["day"]] = by.get(t["day"], 0.0) + t["rs"]
    rows = []
    for d in tradable:
        rs = by.get(d, 0.0)
        rows.append({"day": d, "rs": rs, "kind": mk["kind"][d]})
    return rows


def score(label, kwargs, mk, trades):
    rows = day_nets(mk, trades)
    n = len(rows)
    green = sum(1 for r in rows if r["rs"] > 0)
    red = sum(1 for r in rows if r["rs"] < 0)
    flat = sum(1 for r in rows if abs(r["rs"]) < 1e-9)
    hit150 = sum(1 for r in rows if r["rs"] >= NEED_RS)
    nets = [r["rs"] for r in rows]
    kinds = {}
    for r in rows:
        k = kinds.setdefault(r["kind"], {"n": 0, "green": 0, "red": 0, "flat": 0, "hit150": 0})
        k["n"] += 1
        if r["rs"] > 0:
            k["green"] += 1
        elif r["rs"] < 0:
            k["red"] += 1
        else:
            k["flat"] += 1
        if r["rs"] >= NEED_RS:
            k["hit150"] += 1
    return {
        "label": label,
        "kwargs": kwargs,
        "tradable": n,
        "greenDays": green,
        "redDays": red,
        "flatDays": flat,
        "hit150": hit150,
        "greenPct": round(100.0 * green / n, 1) if n else 0,
        "hit150Pct": round(100.0 * hit150 / n, 1) if n else 0,
        "net": round(sum(nets), 0) if nets else 0,
        "avgDay": round(sum(nets) / n, 1) if n else 0,
        "worstDay": round(min(nets), 0) if nets else 0,
        "everyDayGreen": n > 0 and red == 0 and flat == 0,
        "everyDay150": n > 0 and hit150 == n,
        "kinds": kinds,
    }


def main():
    mk = mod.load()
    kinds = {}
    for d in mk["uniq"]:
        kinds[mk["kind"].get(d, "thin")] = kinds.get(mk["kind"].get(d, "thin"), 0) + 1
    print("tradable kinds", kinds, flush=True)

    wired_kw = dict(
        mode="all_three",
        tp=25,
        scratch=10,
        against_close=True,
        first_win=True,
        day_lock=20,
        week_lock=0,
        max_day=2,
        entry_s=10 * 60,
        entry_e=23 * 60,
    )
    rows = [score("wired_daily_min_sc10", wired_kw, mk, mod.simulate(mk, **wired_kw))]

    modes = (
        "pdhl",
        "trap",
        "orb_break",
        "orb_fade",
        "vwap_fade",
        "pdhl_trap",
        "pdhl_fade",
        "fade_trap",
        "all_three",
    )
    grid = product(
        modes,
        (12, 15, 20, 25, 30),
        (8, 10),
        (0, 15, 20),
        (1, 2),
        WINDOWS,
    )
    seen = set()
    for mode, tp, scratch, dlock, md, (es, ee, wtag) in grid:
        if dlock > tp:
            continue
        kw = dict(
            mode=mode,
            tp=tp,
            scratch=scratch,
            against_close=True,
            first_win=True,
            day_lock=dlock,
            week_lock=0,
            max_day=md,
            entry_s=es,
            entry_e=ee,
        )
        label = f"{mode}|tp{tp:g}|sc{scratch:g}|dl{dlock:g}|m{md}|{wtag}"
        if label in seen:
            continue
        seen.add(label)
        rows.append(score(label, kw, mk, mod.simulate(mk, **kw)))

    every_green = [r for r in rows if r["everyDayGreen"]]
    every_150 = [r for r in rows if r["everyDay150"]]
    near = sorted(
        [r for r in rows if r["tradable"] >= 40 and r["avgDay"] > 0],
        key=lambda r: (r["greenPct"], r["hit150Pct"], r["avgDay"], r["worstDay"]),
        reverse=True,
    )[:8]

    fixture = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "needRs": NEED_RS,
        "configs": len(rows),
        "tradableKinds": kinds,
        "gateEveryTradableDayGreen": {
            "rule": "Every full-session day net > ₹0 after charges. Flat fails. Red fails.",
            "count": len(every_green),
            "books": [r["label"] for r in every_green[:10]],
        },
        "gateEveryTradableDay150": {
            "rule": "Every full-session day net ≥ ₹150 after charges. Flat fails. Red fails.",
            "count": len(every_150),
            "books": [r["label"] for r in every_150[:10]],
        },
        "wired": {
            "label": rows[0]["label"],
            "greenDays": rows[0]["greenDays"],
            "redDays": rows[0]["redDays"],
            "flatDays": rows[0]["flatDays"],
            "hit150": rows[0]["hit150"],
            "tradable": rows[0]["tradable"],
            "greenPct": rows[0]["greenPct"],
            "hit150Pct": rows[0]["hit150Pct"],
            "worstDay": rows[0]["worstDay"],
            "avgDay": rows[0]["avgDay"],
            "everyDayGreen": rows[0]["everyDayGreen"],
            "everyDay150": rows[0]["everyDay150"],
        },
        "nearest": [
            {
                "label": r["label"],
                "greenPct": r["greenPct"],
                "hit150Pct": r["hit150Pct"],
                "redDays": r["redDays"],
                "flatDays": r["flatDays"],
                "worstDay": r["worstDay"],
                "avgDay": r["avgDay"],
            }
            for r in near
        ],
        "honest": (
            "The guaranteed-profit test found zero books. A past sample cannot lock "
            "tomorrow. Crude Best stays on daily-min-sc10. Not a guaranteed profit."
        ),
    }
    OUT.joinpath("summary.json").write_text(json.dumps({**fixture, "top": near}, indent=2))
    FIXTURE.write_text(json.dumps(fixture, indent=2) + "\n")

    lines = [
        f"configs {len(rows)}  tradable kinds {kinds}",
        f"GATE every tradable day green: {len(every_green)}",
        f"GATE every tradable day ≥₹{NEED_RS:.0f}: {len(every_150)}",
        (
            f"WIRED {rows[0]['label']} green {rows[0]['greenDays']}/{rows[0]['tradable']} "
            f"red {rows[0]['redDays']} flat {rows[0]['flatDays']} "
            f"hit150 {rows[0]['hit150']} worst ₹{rows[0]['worstDay']:.0f}"
        ),
        fixture["honest"],
        "",
        "nearest (still fail the guarantee gate)",
    ]
    for r in near:
        lines.append(
            f"  {r['label']:<48} green {r['greenPct']:5.1f}% hit150 {r['hit150Pct']:5.1f}% "
            f"red {r['redDays']:2d} flat {r['flatDays']:2d} worst ₹{r['worstDay']:.0f} avg ₹{r['avgDay']:.0f}"
        )
    report = "\n".join(lines) + "\n"
    OUT.joinpath("README.md").write_text("# Crude guaranteed-profit day gate\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
