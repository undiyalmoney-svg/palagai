#!/usr/bin/env python3
"""
Build a dummy ₹14,000 blotter that plays Crude + the three index champions
like a live day: reserve cash, hit SL/TP/scratch, mark the fund.

Treats paper rupees as real. Never lets the fund go negative. Stops a day
at −₹420. Crude still needs ₹8,000 free. Index cheap CE/PE must fit the
₹3,500 premium budget per ticket. Not a Kite order. Not a guaranteed profit.

  python3 scripts/paper-14k-blotter.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "paper-14k"
OUT.mkdir(parents=True, exist_ok=True)
TS = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-14k-blotter.fixture.ts"

START = 14_000
DAY_LOSS = 420
CRUDE_MIN = 8_000
PREMIUM_BUDGET = 3_500


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def main():
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")

    crude_mk = cdm.load()
    crude_trades = cdm.simulate(
        crude_mk,
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

    raw: dict[str, list[dict]] = defaultdict(list)
    for t in crude_trades:
        raw[t["day"]].append(
            {
                "book": "crude",
                "label": "Crude Mini FUT",
                "product": "FUT ×1",
                "reason": t["reason"],
                "rs": round(t["rs"], 1),
                "pts": round(t["pts"], 2),
                "premiumRs": 0,
            }
        )

    champions = {
        "nifty": dict(
            label="Nifty 50",
            product="cheap CE/PE ₹50 ×65",
            premiumRs=50 * 65,
            rs_pt=65 * 0.2,
            mode="all_three",
            sl=25,
            tp=50,
            scratch=12,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(10, 15),
            entry_s=idx.to_min(10, 15),
            flat=idx.to_min(15, 15),
        ),
        "bank": dict(
            label="Bank Nifty",
            product="cheap CE/PE ₹100 ×30",
            premiumRs=100 * 30,
            rs_pt=30 * 0.2,
            mode="all_three",
            sl=50,
            tp=110,
            scratch=25,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
        ),
        "sensex": dict(
            label="Sensex",
            product="cheap CE/PE ₹150 ×20",
            premiumRs=150 * 20,
            rs_pt=20 * 0.2,
            mode="vwap_fade",
            sl=80,
            tp=160,
            scratch=40,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
        ),
    }

    meta = {b["name"]: b for b in idx.BOOKS}
    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        if not mk:
            continue
        trades = idx.simulate(
            mk,
            mode=ch["mode"],
            sl=ch["sl"],
            tp=ch["tp"],
            scratch=ch["scratch"],
            rs_pt=ch["rs_pt"],
            first_win=True,
            max_day=2,
            or_s=ch["or_s"],
            or_e=ch["or_e"],
            entry_s=ch["entry_s"],
            flat=ch["flat"],
            or_min=book["or_min"],
            or_max=book["or_max"],
            trap_p=book["trap_p"],
            pd_max=book["pd_max"],
            vwap_min=book["vwap_min"],
        )
        for t in trades:
            raw[t["day"]].append(
                {
                    "book": name,
                    "label": ch["label"],
                    "product": ch["product"],
                    "reason": t["reason"],
                    "rs": round(t["rs"], 1),
                    "pts": round(t["pts"], 2),
                    "premiumRs": ch["premiumRs"],
                }
            )

    order = {"crude": 0, "nifty": 1, "bank": 2, "sensex": 3}
    days = sorted(raw)
    fund = float(START)
    peak = fund
    taken = []
    skipped = []
    day_rows = []

    for day in days:
        day_net = 0.0
        sl_n = tp_n = sc_n = 0
        locked = 0.0
        for tr in sorted(raw[day], key=lambda x: order.get(x["book"], 9)):
            free = fund - locked
            if day_net <= -DAY_LOSS:
                skipped.append({**tr, "day": day, "skip": "day-loss cap"})
                continue
            if tr["book"] == "crude" and free < CRUDE_MIN:
                skipped.append({**tr, "day": day, "skip": "need ₹8,000 free for Crude"})
                continue
            if tr["premiumRs"] > PREMIUM_BUDGET:
                skipped.append({**tr, "day": day, "skip": "premium over budget"})
                continue
            if tr["premiumRs"] > free:
                skipped.append({**tr, "day": day, "skip": "not enough free cash for premium"})
                continue
            if fund + tr["rs"] < 0:
                skipped.append({**tr, "day": day, "skip": "would wipe the fund"})
                continue
            locked += tr["premiumRs"]
            fund = round(fund + tr["rs"], 1)
            locked = max(0.0, locked - tr["premiumRs"])
            day_net = round(day_net + tr["rs"], 1)
            peak = max(peak, fund)
            if tr["reason"] == "sl":
                sl_n += 1
            elif tr["reason"] == "tp":
                tp_n += 1
            elif tr["reason"] in ("scratch", "smell"):
                sc_n += 1
            taken.append({**tr, "day": day, "fundAfter": fund, "skip": None})
        day_rows.append(
            {
                "day": day,
                "netRs": day_net,
                "trades": sum(1 for t in taken if t["day"] == day),
                "skipped": sum(1 for t in skipped if t["day"] == day),
                "slHits": sl_n,
                "tpHits": tp_n,
                "scratches": sc_n,
                "fundEnd": fund,
                "tone": "green" if day_net > 0 else "red" if day_net < 0 else "flat",
            }
        )

    blotter = {
        "startRs": START,
        "dayLossCapRs": DAY_LOSS,
        "crudeMinRs": CRUDE_MIN,
        "premiumBudgetRs": PREMIUM_BUDGET,
        "endRs": fund,
        "peakRs": peak,
        "netRs": round(fund - START, 1),
        "days": len(day_rows),
        "trades": len(taken),
        "skipped": len(skipped),
        "slHits": sum(d["slHits"] for d in day_rows),
        "tpHits": sum(d["tpHits"] for d in day_rows),
        "scratches": sum(d["scratches"] for d in day_rows),
        "greenDays": sum(1 for d in day_rows if d["tone"] == "green"),
        "redDays": sum(1 for d in day_rows if d["tone"] == "red"),
        "flatDays": sum(1 for d in day_rows if d["tone"] == "flat"),
        "minFundRs": min((d["fundEnd"] for d in day_rows), default=START),
        "liveOrders": False,
        "guaranteed": False,
        "honest": (
            "Dummy ₹14,000 desk. Same daily fills as the hunted books. "
            "Cash is treated as real: day-loss ₹420, Crude needs ₹8,000 free, "
            "index premium ≤ ₹3,500, fund never goes below 0. Crude live money "
            "stays on Crude Best. This tab does not talk to Kite. Not a guaranteed profit."
        ),
        "sessions": day_rows,
        "fills": taken,
        "skips": skipped[:80],
    }
    OUT.joinpath("summary.json").write_text(json.dumps(blotter, indent=2))
    TS.write_text(
        "/** Dummy ₹14k blotter. Generated by scripts/paper-14k-blotter.py. Not live. */\n"
        f"export const PAPER_14K_BLOTTER = {json.dumps(blotter, indent=2)} as const;\n"
    )
    print(
        f"start ₹{START} end ₹{fund:.0f} net ₹{fund - START:.0f} min ₹{blotter['minFundRs']:.0f} "
        f"days {len(day_rows)} fills {len(taken)} skip {len(skipped)} "
        f"SL {blotter['slHits']} TP {blotter['tpHits']} scratch {blotter['scratches']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
