#!/usr/bin/env python3
"""
Find a better winning clock for weekly-bank Crude Mini.

Fixes DNA (TP30, scratch 8, smell, first-win, day +20, week +40) and only
moves the entry window. Scores rupees after ₹50/RT.

  python3 scripts/crude-weekly-bank-hours.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "crude-weekly-bank-hours"
OUT.mkdir(parents=True, exist_ok=True)
SPEC = ROOT / "scripts" / "crude-weekly-bank-hunt.py"
spec = importlib.util.spec_from_file_location("cwb", SPEC)
mod = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(mod)
CHARGE = mod.CHARGE
OOS_FROM = mod.OOS_FROM

DNA = dict(
    tp=30,
    scratch=8,
    against_close=True,
    first_win=True,
    day_lock=20,
    week_lock=40,
    max_day=2,
    trail_arm=0,
    trail_give=0,
)

WINDOWS = [
    ("09:00-23:00", 9 * 60, 23 * 60),
    ("09:00-12:00", 9 * 60, 12 * 60),
    ("09:00-15:00", 9 * 60, 15 * 60),
    ("09:00-18:00", 9 * 60, 18 * 60),
    ("09:00-21:00", 9 * 60, 21 * 60),
    ("09:30-23:00", 9 * 60 + 30, 23 * 60),
    ("10:00-15:00", 10 * 60, 15 * 60),
    ("10:00-18:00", 10 * 60, 18 * 60),
    ("10:00-21:00", 10 * 60, 21 * 60),
    ("11:00-16:00", 11 * 60, 16 * 60),
    ("12:00-15:00", 12 * 60, 15 * 60),
    ("12:00-16:00", 12 * 60, 16 * 60),
    ("12:00-18:00", 12 * 60, 18 * 60),
    ("12:00-21:00", 12 * 60, 21 * 60),
    ("12:00-17:00", 12 * 60, 17 * 60),
    ("13:00-16:00", 13 * 60, 16 * 60),
    ("13:00-18:00", 13 * 60, 18 * 60),
    ("14:00-18:00", 14 * 60, 18 * 60),
    ("15:00-19:00", 15 * 60, 19 * 60),
    ("15:00-21:00", 15 * 60, 21 * 60),
    ("16:00-20:00", 16 * 60, 20 * 60),
    ("17:00-21:00", 17 * 60, 21 * 60),
    ("18:00-21:00", 18 * 60, 21 * 60),
    ("18:30-21:00", 18 * 60 + 30, 21 * 60),
    ("18:30-22:00", 18 * 60 + 30, 22 * 60),
    ("18:30-23:00", 18 * 60 + 30, 23 * 60),
    ("19:00-22:00", 19 * 60, 22 * 60),
    ("19:00-23:00", 19 * 60, 23 * 60),
    ("20:00-23:00", 20 * 60, 23 * 60),
    ("10:00-23:00", 10 * 60, 23 * 60),
    ("12:00-23:00", 12 * 60, 23 * 60),
    ("14:00-23:00", 14 * 60, 23 * 60),
    ("15:00-23:00", 15 * 60, 23 * 60),
]


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def hour_bucket(trades: list[dict]) -> list[dict]:
    by = defaultdict(lambda: {"n": 0, "green": 0, "rs": 0.0, "tp": 0, "scratch": 0})
    for t in trades:
        h = int(t.get("hour") or 0)
        row = by[h]
        row["n"] += 1
        row["rs"] += t["rs"]
        if t["rs"] > 0:
            row["green"] += 1
        if t["reason"] == "tp":
            row["tp"] += 1
        if t["reason"] in ("scratch", "smell"):
            row["scratch"] += 1
    out = []
    for h in range(9, 24):
        row = by.get(h)
        if not row or row["n"] == 0:
            continue
        out.append(
            {
                "hour": f"{h:02d}:00-{h:02d}:59 IST",
                "n": row["n"],
                "green_pct": round(100.0 * row["green"] / row["n"], 1),
                "net_rs": round(row["rs"], 0),
                "avg_rs": round(row["rs"] / row["n"], 1),
                "tp_hit": round(100.0 * row["tp"] / row["n"], 1),
                "scratch_n": row["scratch"],
            }
        )
    return out


def ok(r: dict) -> bool:
    return (
        r["is"]["weeks"] >= 4
        and r["oos"]["weeks"] >= 4
        and r["is"]["avg_week"] > 0
        and r["oos"]["avg_week"] > 0
        and r["full"]["avg_week"] > 0
        and r["full"]["worst_week"] >= -500
    )


def main():
    mk = mod.load()
    all_session = dict(DNA, entry_s=9 * 60, entry_e=23 * 60)
    all_trades = mod.simulate(mk, **all_session)
    hours = hour_bucket(all_trades)

    rows = []
    for name, s, e in WINDOWS:
        kw = dict(DNA, entry_s=s, entry_e=e)
        rows.append(mod.pack(name, kw, mod.simulate(mk, **kw)))

    viable = [r for r in rows if ok(r)]
    viable.sort(
        key=lambda r: (
            r["oos"]["green_weeks"],
            r["full"]["green_weeks"],
            r["oos"]["avg_week"],
            r["full"]["avg_week"],
            r["full"]["worst_week"],
            r["full"]["tp_hit"],
        ),
        reverse=True,
    )
    baseline = next(r for r in rows if r["label"] == "09:00-23:00")
    champ = viable[0] if viable else baseline

    summary = {
        "sample": "MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30",
        "oos_from": OOS_FROM,
        "charge_rs": CHARGE,
        "dna": "weekly-bank-sc8 · TP30 · scratch 8 · smell · first-win · day+20 · week+40",
        "honest": "Not a guaranteed clock. A tighter window can look cleaner because it trades less.",
        "hours": hours,
        "baseline": baseline,
        "wired": champ,
        "windows": viable,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def line(tag, r):
        f, o = r["full"], r["oos"]
        return (
            f"{tag:<6} {r['label']:<14} "
            f"full {f['green_weeks']:5.1f}% w{f['weeks']:2d} n{f['n']:3d} ₹{f['avg_week']:6.0f} "
            f"tp{f['tp_hit']:4.0f}% worst{f['worst_week']:6.0f}  "
            f"OOS {o['green_weeks']:5.1f}% ₹{o['avg_week']:6.0f} worst{o['worst_week']:6.0f}"
        )

    lines = [
        f"sample {summary['sample']}  DNA {summary['dna']}",
        line("BASE", baseline),
        line("BEST", champ),
        "",
        "green weeks by entry window (IS+OOS both profitable)",
    ]
    for r in viable:
        lines.append(line(" ", r))
    lines += ["", "fills by entry hour on 09:00–23:00 DNA (after ₹50/RT)"]
    for h in hours:
        lines.append(
            f"  {h['hour']:<18} n{h['n']:3d}  green {h['green_pct']:5.1f}%  "
            f"net ₹{h['net_rs']:6.0f}  avg ₹{h['avg_rs']:6.1f}  tp {h['tp_hit']:4.0f}%"
        )
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Crude weekly-bank winning clock\n\n```\n" + report + "```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
