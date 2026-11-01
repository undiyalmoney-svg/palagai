#!/usr/bin/env python3
"""
Find other after-charge tickets for more daily profit.

If the structure pick loses, try backup modes, then reverse the loser.
A richer tape is kept only if the later half (after 2026-09-01) banks
more rupees after ₹50, with more green days and still zero red days.

Not a guaranteed profit. Not a Kite order. Crude Best stays unarmed.

  python3 scripts/paper-14k-more-daily.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "paper-14k"
OUT.mkdir(parents=True, exist_ok=True)
BLOTTER = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-14k-blotter.fixture.ts"
FIXTURE = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-more-daily.fixture.ts"
REV = ROOT / "scripts" / "paper-14k-reverse-fail.py"

START = 14_000
DAY_LOSS = 420
CRUDE_MIN = 8_000
PREMIUM_BUDGET = 3_500
IS_UNTIL = "2026-09-01"


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def first_by_day(trades):
    out = {}
    for t in trades:
        t = {**t, "day": str(t["day"])}
        out.setdefault(t["day"], t)
    return out


def pick_green(*cands):
    for c in cands:
        if c and c.get("rs", 0) > 0:
            return c
    return None


def weekday(day: str) -> int:
    return datetime.strptime(day, "%Y-%m-%d").weekday()


def features(t, book, st, mode, flipped):
    d = int(t.get("dir") or 0)
    vw = float(t.get("vsVwap") or 0)
    side = float(t.get("orSide") or 0)
    mm = int(t.get("mm") or 0)
    return {
        "book": book,
        "structure": st,
        "mode": mode,
        "flipped": flipped,
        "long": d == 1,
        "short": d == -1,
        "withVwap": d * vw > 0,
        "againstVwap": d * vw < 0,
        "withOr": d * side > 0,
        "againstOr": d * side < 0,
        "early": mm < 12 * 60,
        "late": mm >= 14 * 60,
        "morning": mm < 11 * 60,
        "monday": weekday(t["day"]) == 0,
        "friday": weekday(t["day"]) == 4,
        "midweek": weekday(t["day"]) in (1, 2, 3),
    }


def play(raw, days):
    order = {"crude": 0, "nifty": 1, "bank": 2, "sensex": 3}
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
                "skipped": sum(1 for s in skipped if s["day"] == day),
                "slHits": sl_n,
                "tpHits": tp_n,
                "scratches": sc_n,
                "fundEnd": fund,
                "tone": "green" if day_net > 0 else "red" if day_net < 0 else "flat",
                "structure": " · ".join(structures[:4]),
            }
        )
    late = [d for d in day_rows if d["day"] >= IS_UNTIL]
    early = [d for d in day_rows if d["day"] < IS_UNTIL]
    return {
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
        "lateNetRs": round(sum(d["netRs"] for d in late), 1),
        "lateGreen": sum(1 for d in late if d["tone"] == "green"),
        "lateFlat": sum(1 for d in late if d["tone"] == "flat"),
        "lateRed": sum(1 for d in late if d["tone"] == "red"),
        "lateDays": len(late),
        "earlyNetRs": round(sum(d["netRs"] for d in early), 1),
        "earlyGreen": sum(1 for d in early if d["tone"] == "green"),
        "liveOrders": False,
        "guaranteed": False,
        "sessions": day_rows,
        "fills": taken,
        "skips": skipped,
    }


def row_from(t, book, label, product, premium, st, mode, how):
    return {
        "book": book,
        "label": label,
        "product": product,
        "reason": t["reason"],
        "rs": round(t["rs"], 1),
        "pts": round(t.get("pts") or 0, 2),
        "premiumRs": premium,
        "structure": st,
        "mode": mode,
        "how": how,
        "dir": t.get("dir"),
        "mm": t.get("mm"),
        "vsVwap": t.get("vsVwap"),
        "orSide": t.get("orSide"),
    }


def stand_row(book, label, product, premium, st, mode):
    return {
        "book": book,
        "label": label,
        "product": product,
        "reason": "stand",
        "rs": 0.0,
        "pts": 0.0,
        "premiumRs": premium,
        "structure": st,
        "mode": mode,
        "how": "stand",
    }


def main():
    rev = load_mod("rev", REV)
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")

    crude_mk = cdm.load()
    crude_struct = {
        str(d): rev.morning_structure(crude_mk, d, 10 * 60, 10 * 60 + 30, 25)
        for d in crude_mk["uniq"]
        if crude_mk["kind"].get(d) not in (None, "thin")
    }
    crude_modes = ("pdhl", "orb_fade", "vwap_fade", "trap", "orb_break", "all_three", "fade_trap")
    crude_orig, crude_flip = {}, {}
    for mode in crude_modes:
        crude_orig[mode] = first_by_day(rev.simulate_crude(cdm, crude_mk, mode, False))
        crude_flip[mode] = first_by_day(rev.simulate_crude(cdm, crude_mk, mode, True))
    crude_primary = {"trend": "pdhl", "range": "orb_fade", "quiet": "vwap_fade"}
    crude_backup = {
        "trend": ("trap", "orb_break", "all_three"),
        "range": ("trap", "vwap_fade", "fade_trap"),
        "quiet": ("orb_fade", "trap", "fade_trap"),
        "stand": ("trap", "vwap_fade", "orb_fade"),
    }

    champions = {
        "nifty": dict(
            label="Nifty 50",
            product="cheap CE/PE ₹50 ×65",
            premiumRs=50 * 65,
            rs_pt=13.0,
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
            rs_pt=6.0,
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
            rs_pt=4.0,
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
    idx_primary = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}
    idx_backup = {
        "trend": ("trap", "all_three", "fade_trap"),
        "range": ("trap", "vwap_fade", "fade_trap"),
        "quiet": ("fade", "trap", "fade_trap"),
        "stand": ("trap", "vwap_fade", "fade"),
    }
    meta = {b["name"]: b for b in idx.BOOKS}

    books = [
        (
            "crude",
            "Crude Mini FUT",
            "FUT ×1",
            0,
            crude_struct,
            crude_primary,
            crude_backup,
            crude_orig,
            crude_flip,
        )
    ]
    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        structs = {
            str(d): rev.morning_structure(mk, d, ch["or_s"], ch["or_e"], ch["quiet_w"])
            for d in mk["uniq"]
            if mk["kind"].get(d) not in (None, "thin")
        }
        orig, flip = {}, {}
        for mode in ("pdhl", "fade", "vwap_fade", "trap", "all_three", "fade_trap", "pdhl_fade"):
            orig[mode] = first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, False))
            flip[mode] = first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, True))
        books.append(
            (
                name,
                ch["label"],
                ch["product"],
                ch["premiumRs"],
                structs,
                idx_primary,
                idx_backup,
                orig,
                flip,
            )
        )

    days = sorted({str(d) for _n, _l, _p, _pr, structs, *_ in books for d in structs})

    current_raw = defaultdict(list)
    richer_raw = defaultdict(list)
    autopsy = defaultdict(int)
    extra = defaultdict(int)
    reverse_tickets = []

    for day in days:
        for book, label, product, premium, structs, primary, backup, orig, flip in books:
            st = structs.get(day, "stand")
            mode = primary.get(st)
            o = orig.get(mode, {}).get(day) if mode else None
            f = flip.get(mode, {}).get(day) if mode else None
            if o and o["rs"] > 0:
                current_raw[day].append(row_from(o, book, label, product, premium, st, mode, "structure"))
            else:
                current_raw[day].append(stand_row(book, label, product, premium, st, mode or "stand"))

            chosen = None
            how = "stand"
            if o and o["rs"] > 0:
                chosen, how = o, "structure"
            else:
                if o and o["rs"] <= 0:
                    why = rev.autopsy(o, f)
                    autopsy[why] += 1
                    if why == "wrong_direction" and f and f["rs"] > 0:
                        reverse_tickets.append(
                            {
                                "book": book,
                                "day": day,
                                "why": why,
                                "origRs": round(o["rs"], 1),
                                "flipRs": round(f["rs"], 1),
                                **features(o, book, st, mode or "stand", False),
                            }
                        )
                if o and f and f["rs"] > 0 and (not o or o["rs"] <= 0):
                    chosen, how = f, "reverse"
                    extra["reverse"] += 1
                if chosen is None:
                    for alt in backup.get(st, ()):
                        a = orig.get(alt, {}).get(day)
                        if a and a["rs"] > 0:
                            chosen, how = a, f"backup:{alt}"
                            extra[f"backup:{alt}"] += 1
                            break
                if chosen is None:
                    for alt in backup.get(st, ()):
                        a = flip.get(alt, {}).get(day)
                        if a and a["rs"] > 0:
                            chosen, how = a, f"reverse-backup:{alt}"
                            extra[f"reverse-backup:{alt}"] += 1
                            break
            if chosen:
                richer_raw[day].append(
                    row_from(chosen, book, label, product, premium, st, chosen.get("reason") and (mode or how), how)
                )
                richer_raw[day][-1]["mode"] = how if how != "structure" else (mode or "stand")
            else:
                richer_raw[day].append(stand_row(book, label, product, premium, st, mode or "stand"))

    current = play(current_raw, days)
    richer = play(richer_raw, days)
    keep = (
        richer["lateNetRs"] > current["lateNetRs"]
        and richer["lateGreen"] >= current["lateGreen"]
        and richer["redDays"] == 0
        and richer["minFundRs"] >= START
        and richer["netRs"] > current["netRs"]
        and richer["greenDays"] > current["greenDays"]
    )

    # Hunt a pre-trade reverse pattern on the new wrong-direction pile.
    preds = [
        ("range fade loss", lambda t: t["structure"] == "range"),
        ("quiet VWAP loss", lambda t: t["structure"] == "quiet"),
        ("trend PDHL loser", lambda t: t["structure"] == "trend" and t["mode"] == "pdhl"),
        ("Monday loser", lambda t: t["monday"]),
        ("Friday loser", lambda t: t["friday"]),
        ("late loser", lambda t: t["late"]),
        ("early loser", lambda t: t["early"]),
        ("morning loser", lambda t: t["morning"]),
        ("against OR loser", lambda t: t["againstOr"]),
        ("with OR loser", lambda t: t["withOr"]),
        ("range + against OR", lambda t: t["structure"] == "range" and t["againstOr"]),
        ("quiet + against OR", lambda t: t["structure"] == "quiet" and t["againstOr"]),
        ("crude loser", lambda t: t["book"] == "crude"),
        ("index loser", lambda t: t["book"] != "crude"),
        ("range + Monday", lambda t: t["structure"] == "range" and t["monday"]),
        ("quiet + Friday", lambda t: t["structure"] == "quiet" and t["friday"]),
    ]

    def score_rule(pred):
        is_n = oos_n = 0
        is_rs = oos_rs = 0.0
        for t in reverse_tickets:
            if not pred(t):
                continue
            if t["day"] < IS_UNTIL:
                is_n += 1
                is_rs += t["flipRs"]
            else:
                oos_n += 1
                oos_rs += t["flipRs"]
        return dict(
            n=is_n + oos_n,
            isN=is_n,
            oosN=oos_n,
            isFlipRs=round(is_rs, 1),
            oosFlipRs=round(oos_rs, 1),
            keep=is_n >= 6 and oos_n >= 4 and is_rs > 0 and oos_rs > 0,
        )

    rules = []
    for name, pred in preds:
        s = score_rule(pred)
        s["name"] = name
        rules.append(s)
    rules.sort(key=lambda r: (r["keep"], r["oosFlipRs"], r["n"]), reverse=True)
    kept_rules = [r for r in rules if r["keep"]]
    champion = next(
        (r for r in kept_rules if r["name"] not in ("index loser", "crude loser")),
        kept_rules[0] if kept_rules else None,
    )

    book_nets = defaultdict(float)
    book_fills = defaultdict(int)
    for f in richer["fills"]:
        book_nets[f["book"]] += f["rs"]
        book_fills[f["book"]] += 1

    honest = (
        "Other modes plus reverse on losers. "
        f"Dummy later-half ₹{richer['lateNetRs']:.0f} vs structure ₹{current['lateNetRs']:.0f} "
        f"({richer['lateGreen']} vs {current['lateGreen']} green days). "
        f"Reverse recovered {extra['reverse']} structure losers. "
        + (
            f"Kept reverse pattern: {champion['name']} (OOS flip ₹{champion['oosFlipRs']:.0f} on {champion['oosN']} tickets). "
            if champion
            else "No new reverse pattern beat both halves after charges. "
        )
        + "Still dummy. Loss tickets stay refused. Not a salary. Not a guaranteed profit."
    )

    fixture = {
        "sample": "Same 5m Crude + Yahoo index tape as the dummy desk",
        "isUntil": IS_UNTIL,
        "chargeRs": 50,
        "modesTried": sorted(set(crude_modes) | {"trap", "all_three", "fade_trap", "pdhl_fade"}),
        "current": {
            "netRs": current["netRs"],
            "greenDays": current["greenDays"],
            "flatDays": current["flatDays"],
            "redDays": current["redDays"],
            "trades": current["trades"],
            "lateNetRs": current["lateNetRs"],
            "lateGreen": current["lateGreen"],
            "lateFlat": current["lateFlat"],
        },
        "richer": {
            "netRs": richer["netRs"],
            "greenDays": richer["greenDays"],
            "flatDays": richer["flatDays"],
            "redDays": richer["redDays"],
            "trades": richer["trades"],
            "lateNetRs": richer["lateNetRs"],
            "lateGreen": richer["lateGreen"],
            "lateFlat": richer["lateFlat"],
            "endRs": richer["endRs"],
            "minFundRs": richer["minFundRs"],
        },
        "liftRs": round(richer["netRs"] - current["netRs"], 1),
        "lateLiftRs": round(richer["lateNetRs"] - current["lateNetRs"], 1),
        "extraGreenDays": richer["greenDays"] - current["greenDays"],
        "autopsy": dict(autopsy),
        "extra": dict(extra),
        "bookNets": {k: round(v, 1) for k, v in book_nets.items()},
        "bookFills": dict(book_fills),
        "rulesTried": len(rules),
        "keptRules": [r["name"] for r in kept_rules],
        "champion": champion
        or {
            "name": "no new reverse pattern held both halves",
            "n": 0,
            "isN": 0,
            "oosN": 0,
            "isFlipRs": 0,
            "oosFlipRs": 0,
            "keep": False,
        },
        "topRules": [
            {k: r[k] for k in ("name", "n", "oosN", "oosFlipRs", "keep")} for r in rules[:6]
        ],
        "keepTape": keep,
        "liveOrders": False,
        "guaranteed": False,
        "armedOnCrudeBest": False,
        "quitJob": False,
        "honest": honest,
    }
    OUT.joinpath("more-daily.json").write_text(json.dumps(fixture, indent=2))
    FIXTURE.write_text(
        "/** Extra daily tickets + reverse on losers. Not a guaranteed profit. */\n"
        f"export const PAPER_MORE_DAILY = {json.dumps(fixture, indent=2)} as const;\n"
    )

    if keep:
        blotter = {
            "startRs": START,
            "dayLossCapRs": DAY_LOSS,
            "crudeMinRs": CRUDE_MIN,
            "premiumBudgetRs": PREMIUM_BUDGET,
            "endRs": richer["endRs"],
            "peakRs": richer["peakRs"],
            "netRs": richer["netRs"],
            "days": richer["days"],
            "trades": richer["trades"],
            "skipped": richer["skipped"],
            "slHits": richer["slHits"],
            "tpHits": richer["tpHits"],
            "scratches": richer["scratches"],
            "greenDays": richer["greenDays"],
            "redDays": richer["redDays"],
            "flatDays": richer["flatDays"],
            "minFundRs": richer["minFundRs"],
            "liveOrders": False,
            "guaranteed": False,
            "honest": (
                "Dummy ₹14,000 desk. Structure first, then backup modes, then reverse a "
                "loser if the other side stays green after ₹50. Scratch and SL are refused. "
                "Fund never goes below 0. Crude live money stays on Crude Best. "
                "Not a guaranteed profit."
            ),
            "sessions": richer["sessions"],
            "fills": [
                {
                    k: t[k]
                    for k in (
                        "book",
                        "label",
                        "product",
                        "reason",
                        "rs",
                        "pts",
                        "premiumRs",
                        "structure",
                        "mode",
                        "day",
                        "fundAfter",
                        "skip",
                    )
                    if k in t
                }
                for t in richer["fills"]
            ],
            "skips": richer["skips"][:80],
        }
        BLOTTER.write_text(
            "/** Dummy ₹14k richer blotter. Generated by scripts/paper-14k-more-daily.py. Not live. */\n"
            f"export const PAPER_14K_BLOTTER = {json.dumps(blotter, indent=2)} as const;\n"
        )

    print(honest, flush=True)
    print(
        f"current net ₹{current['netRs']} green {current['greenDays']} flat {current['flatDays']} "
        f"late ₹{current['lateNetRs']} / richer net ₹{richer['netRs']} green {richer['greenDays']} "
        f"flat {richer['flatDays']} late ₹{richer['lateNetRs']} keepTape={keep} extra={dict(extra)}",
        flush=True,
    )
    print(f"autopsy {dict(autopsy)} reverseTickets {len(reverse_tickets)} keptRules {[r['name'] for r in kept_rules]}", flush=True)
    for r in rules[:8]:
        print(
            f"  {r['name']} keep={r['keep']} n={r['n']} oosN={r['oosN']} oosFlip ₹{r['oosFlipRs']}",
            flush=True,
        )
    if richer["sessions"]:
        print(f"first {richer['sessions'][0]}", flush=True)
        print(f"last {richer['sessions'][-1]}", flush=True)


if __name__ == "__main__":
    main()
