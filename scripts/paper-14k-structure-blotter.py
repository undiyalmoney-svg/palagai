#!/usr/bin/env python3
"""
Dummy ₹14k blotter that switches book by morning structure and only banks
tickets that are green after charges.

Morning bars only — no look-ahead on the day close.
  trend  → PDH/PDL
  range  → OR fade
  quiet  → VWAP fade
  stand  → no ticket (OR too thin)

A scratch or SL is refused ("loss not allowed"). Fund never goes below 0.
Not a guaranteed profit. Not a Kite order.

  python3 scripts/paper-14k-structure-blotter.py
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


def morning_structure(mk, day, or_s, or_e, quiet_w):
    mask = (mk["days"] == day) & (mk["mins"] >= or_s) & (mk["mins"] <= or_e)
    if int(mask.sum()) < 4:
        return "stand"
    hi = float(mk["h"][mask].max())
    lo = float(mk["l"][mask].min())
    width = hi - lo
    if width <= 0:
        return "stand"
    o0 = float(mk["o"][mask][0])
    c1 = float(mk["c"][mask][-1])
    mid = (hi + lo) / 2.0
    if width < quiet_w:
        return "quiet"
    if c1 >= mid + 0.2 * width and c1 > o0:
        return "trend"
    if c1 <= mid - 0.2 * width and c1 < o0:
        return "trend"
    return "range"


def main():
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")

    crude_mk = cdm.load()
    crude_struct = {
        d: morning_structure(crude_mk, d, 10 * 60, 10 * 60 + 30, 25)
        for d in crude_mk["uniq"]
        if crude_mk["kind"].get(d) not in (None, "thin")
    }
    crude_by_mode = {
        "pdhl": cdm.simulate(
            crude_mk, mode="pdhl", tp=25, scratch=10, against_close=True,
            first_win=True, day_lock=20, week_lock=0, max_day=1,
            entry_s=10 * 60 + 30, entry_e=23 * 60,
        ),
        "orb_fade": cdm.simulate(
            crude_mk, mode="orb_fade", tp=25, scratch=10, against_close=True,
            first_win=True, day_lock=20, week_lock=0, max_day=1,
            entry_s=10 * 60 + 30, entry_e=23 * 60,
        ),
        "vwap_fade": cdm.simulate(
            crude_mk, mode="vwap_fade", tp=25, scratch=10, against_close=True,
            first_win=True, day_lock=20, week_lock=0, max_day=1,
            entry_s=10 * 60 + 30, entry_e=23 * 60,
        ),
    }
    crude_mode = {"trend": "pdhl", "range": "orb_fade", "quiet": "vwap_fade"}

    raw: dict[str, list[dict]] = defaultdict(list)
    for day, st in crude_struct.items():
        mode = crude_mode.get(st)
        if not mode:
            raw[day].append(
                {
                    "book": "crude",
                    "label": "Crude Mini FUT",
                    "product": "FUT ×1",
                    "reason": "stand",
                    "rs": 0.0,
                    "pts": 0.0,
                    "premiumRs": 0,
                    "structure": st,
                    "mode": "stand",
                }
            )
            continue
        hits = [t for t in crude_by_mode[mode] if t["day"] == day]
        if not hits:
            raw[day].append(
                {
                    "book": "crude",
                    "label": "Crude Mini FUT",
                    "product": "FUT ×1",
                    "reason": "stand",
                    "rs": 0.0,
                    "pts": 0.0,
                    "premiumRs": 0,
                    "structure": st,
                    "mode": mode,
                }
            )
            continue
        t = hits[0]
        raw[day].append(
            {
                "book": "crude",
                "label": "Crude Mini FUT",
                "product": "FUT ×1",
                "reason": t["reason"],
                "rs": round(t["rs"], 1),
                "pts": round(t["pts"], 2),
                "premiumRs": 0,
                "structure": st,
                "mode": mode,
            }
        )

    champions = {
        "nifty": dict(
            label="Nifty 50",
            product="cheap CE/PE ₹50 ×65",
            premiumRs=50 * 65,
            rs_pt=65 * 0.2,
            sl=25,
            tp=50,
            scratch=12,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(10, 15),
            entry_s=idx.to_min(10, 15),
            flat=idx.to_min(15, 15),
            quiet_w=30,
        ),
        "bank": dict(
            label="Bank Nifty",
            product="cheap CE/PE ₹100 ×30",
            premiumRs=100 * 30,
            rs_pt=30 * 0.2,
            sl=50,
            tp=110,
            scratch=25,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
            quiet_w=80,
        ),
        "sensex": dict(
            label="Sensex",
            product="cheap CE/PE ₹150 ×20",
            premiumRs=150 * 20,
            rs_pt=20 * 0.2,
            sl=80,
            tp=160,
            scratch=40,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
            quiet_w=100,
        ),
    }
    idx_mode = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}
    meta = {b["name"]: b for b in idx.BOOKS}

    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        if not mk:
            continue
        structs = {
            d: morning_structure(mk, d, ch["or_s"], ch["or_e"], ch["quiet_w"])
            for d in mk["uniq"]
            if mk["kind"].get(d) not in (None, "thin")
        }
        by_mode = {}
        for mode in ("pdhl", "fade", "vwap_fade"):
            by_mode[mode] = idx.simulate(
                mk,
                mode=mode,
                sl=ch["sl"],
                tp=ch["tp"],
                scratch=ch["scratch"],
                rs_pt=ch["rs_pt"],
                first_win=True,
                max_day=1,
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
        for day, st in structs.items():
            mode = idx_mode.get(st)
            row = {
                "book": name,
                "label": ch["label"],
                "product": ch["product"],
                "premiumRs": ch["premiumRs"],
                "structure": st,
                "mode": mode or "stand",
            }
            if not mode:
                raw[day].append({**row, "reason": "stand", "rs": 0.0, "pts": 0.0})
                continue
            hits = [t for t in by_mode[mode] if t["day"] == day]
            if not hits:
                raw[day].append({**row, "reason": "stand", "rs": 0.0, "pts": 0.0})
                continue
            t = hits[0]
            raw[day].append(
                {
                    **row,
                    "reason": t["reason"],
                    "rs": round(t["rs"], 1),
                    "pts": round(t["pts"], 2),
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
        structures = []
        for tr in sorted(raw[day], key=lambda x: order.get(x["book"], 9)):
            structures.append(f"{tr['book']}:{tr.get('structure', 'stand')}/{tr.get('mode', 'stand')}")
            free = fund - locked
            if tr["rs"] <= 0:
                skipped.append({**tr, "day": day, "skip": "loss not allowed after charges"})
                continue
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
                "structure": " · ".join(structures[:4]),
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
            "Dummy ₹14,000 desk. Morning structure picks PDH/PDL, OR fade, or VWAP fade. "
            "Only tickets that stay green after ₹50 charges are banked. Scratch and SL "
            "are refused. Fund never goes below 0. Crude live money stays on Crude Best. "
            "This tab does not talk to Kite. Not a guaranteed profit."
        ),
        "sessions": day_rows,
        "fills": taken,
        "skips": skipped[:80],
    }
    OUT.joinpath("structure-summary.json").write_text(json.dumps(blotter, indent=2))
    TS.write_text(
        "/** Dummy ₹14k structure blotter. Generated by scripts/paper-14k-structure-blotter.py. Not live. */\n"
        f"export const PAPER_14K_BLOTTER = {json.dumps(blotter, indent=2)} as const;\n"
    )
    print(
        f"start ₹{START} end ₹{fund:.0f} net ₹{fund - START:.0f} min ₹{blotter['minFundRs']:.0f} "
        f"days {len(day_rows)} fills {len(taken)} skip {len(skipped)} "
        f"green {blotter['greenDays']} red {blotter['redDays']} flat {blotter['flatDays']} "
        f"SL {blotter['slHits']} TP {blotter['tpHits']} scratch {blotter['scratches']}",
        flush=True,
    )
    if day_rows:
        print(f"first {day_rows[0]}", flush=True)
        print(f"last {day_rows[-1]}", flush=True)


if __name__ == "__main__":
    main()
