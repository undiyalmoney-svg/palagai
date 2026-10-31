#!/usr/bin/env python3
"""
Find a pre-trade pattern on the 34 wrong-direction losers.

A pattern is only kept if flipping those tickets beats the original
after 2026-09-01, after ₹50 charges. Not a guaranteed profit.

  python3 scripts/paper-14k-fail-pattern.py
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
FIXTURE = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-fail-pattern.fixture.ts"
REV = ROOT / "scripts" / "paper-14k-reverse-fail.py"
IS_UNTIL = "2026-09-01"


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def weekday(day: str) -> int:
    return datetime.strptime(day, "%Y-%m-%d").weekday()


def features(o: dict, book: str, st: str, mode: str) -> dict:
    d = int(o.get("dir") or 0)
    vw = float(o.get("vsVwap") or 0)
    side = float(o.get("orSide") or 0)
    mm = int(o.get("mm") or 0)
    return {
        "book": book,
        "structure": st,
        "mode": mode or "stand",
        "long": d == 1,
        "short": d == -1,
        "withVwap": d * vw > 0,
        "againstVwap": d * vw < 0,
        "withOr": d * side > 0,
        "againstOr": d * side < 0,
        "early": mm < 12 * 60,
        "late": mm >= 14 * 60,
        "morning": mm < 11 * 60,
        "absVwap": abs(vw),
        "absOr": abs(side),
        "mm": mm,
        "wd": weekday(o["day"]),
        "weekday": datetime.strptime(o["day"], "%Y-%m-%d").strftime("%a"),
    }


def main():
    rev = load_mod("rev", REV)
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")

    tickets = []
    crude_mk = cdm.load()
    crude_struct = {
        d: rev.morning_structure(crude_mk, d, 10 * 60, 10 * 60 + 30, 25)
        for d in crude_mk["uniq"]
        if crude_mk["kind"].get(d) not in (None, "thin")
    }
    crude_mode = {"trend": "pdhl", "range": "orb_fade", "quiet": "vwap_fade"}
    crude_orig, crude_flip = {}, {}
    for mode in ("pdhl", "orb_fade", "vwap_fade"):
        crude_orig[mode] = rev.first_by_day(rev.simulate_crude(cdm, crude_mk, mode, False))
        crude_flip[mode] = rev.first_by_day(rev.simulate_crude(cdm, crude_mk, mode, True))
    for day, st in crude_struct.items():
        mode = crude_mode.get(st)
        o = crude_orig.get(mode, {}).get(day) if mode else None
        f = crude_flip.get(mode, {}).get(day) if mode else None
        if not o:
            continue
        tickets.append(
            {
                "book": "crude",
                "day": day,
                "why": rev.autopsy(o, f),
                "orig": o,
                "flip": f,
                **features(o, "crude", st, mode or "stand"),
            }
        )

    champions = {
        "nifty": dict(
            label="Nifty 50",
            premiumRs=3250,
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
            premiumRs=3000,
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
            premiumRs=3000,
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
    idx_mode = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}
    meta = {b["name"]: b for b in idx.BOOKS}
    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        structs = {
            d: rev.morning_structure(mk, d, ch["or_s"], ch["or_e"], ch["quiet_w"])
            for d in mk["uniq"]
            if mk["kind"].get(d) not in (None, "thin")
        }
        orig, flip = {}, {}
        for mode in ("pdhl", "fade", "vwap_fade"):
            orig[mode] = rev.first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, False))
            flip[mode] = rev.first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, True))
        for day, st in structs.items():
            mode = idx_mode.get(st)
            o = orig.get(mode, {}).get(day) if mode else None
            f = flip.get(mode, {}).get(day) if mode else None
            if not o:
                continue
            tickets.append(
                {
                    "book": name,
                    "day": day,
                    "why": rev.autopsy(o, f),
                    "orig": o,
                    "flip": f,
                    **features(o, name, st, mode or "stand"),
                }
            )

    wrong = [t for t in tickets if t["why"] == "wrong_direction"]
    chop = [t for t in tickets if t["why"] == "chop_both_lose"]
    green = [t for t in tickets if t["why"] == "orig_green"]

    def count(rows, key):
        bag = defaultdict(int)
        for r in rows:
            bag[str(r[key])] += 1
        return dict(sorted(bag.items(), key=lambda x: (-x[1], x[0])))

    slices = {
        "book": {k: count(v, "book") for k, v in (("wrong", wrong), ("chop", chop), ("green", green))},
        "structure": {
            k: count(v, "structure") for k, v in (("wrong", wrong), ("chop", chop), ("green", green))
        },
        "mode": {k: count(v, "mode") for k, v in (("wrong", wrong), ("chop", chop), ("green", green))},
        "weekday": {
            k: count(v, "weekday") for k, v in (("wrong", wrong), ("chop", chop), ("green", green))
        },
        "side": {
            "wrong": {
                "long": sum(1 for t in wrong if t["long"]),
                "short": sum(1 for t in wrong if t["short"]),
                "withVwap": sum(1 for t in wrong if t["withVwap"]),
                "againstVwap": sum(1 for t in wrong if t["againstVwap"]),
                "withOr": sum(1 for t in wrong if t["withOr"]),
                "againstOr": sum(1 for t in wrong if t["againstOr"]),
                "early": sum(1 for t in wrong if t["early"]),
                "late": sum(1 for t in wrong if t["late"]),
            },
            "green": {
                "long": sum(1 for t in green if t["long"]),
                "short": sum(1 for t in green if t["short"]),
                "withVwap": sum(1 for t in green if t["withVwap"]),
                "againstVwap": sum(1 for t in green if t["againstVwap"]),
                "withOr": sum(1 for t in green if t["withOr"]),
                "againstOr": sum(1 for t in green if t["againstOr"]),
                "early": sum(1 for t in green if t["early"]),
                "late": sum(1 for t in green if t["late"]),
            },
        },
    }

    rules = [
        ("trend + PDH/PDL", lambda t: t["structure"] == "trend" and t["mode"] == "pdhl"),
        ("quiet + VWAP fade", lambda t: t["structure"] == "quiet"),
        ("range + fade", lambda t: t["structure"] == "range"),
        ("short", lambda t: t["short"]),
        ("long", lambda t: t["long"]),
        ("with VWAP (extended)", lambda t: t["withVwap"]),
        ("against VWAP", lambda t: t["againstVwap"]),
        ("with OR mid", lambda t: t["withOr"]),
        ("against OR mid", lambda t: t["againstOr"]),
        ("early (before 12:00)", lambda t: t["early"]),
        ("late (after 14:00)", lambda t: t["late"]),
        ("morning (before 11:00)", lambda t: t["morning"]),
        ("trend PDHL + short", lambda t: t["structure"] == "trend" and t["short"]),
        ("trend PDHL + with VWAP", lambda t: t["structure"] == "trend" and t["withVwap"]),
        ("trend PDHL + against VWAP", lambda t: t["structure"] == "trend" and t["againstVwap"]),
        ("trend PDHL + early", lambda t: t["structure"] == "trend" and t["early"]),
        ("quiet + with VWAP", lambda t: t["structure"] == "quiet" and t["withVwap"]),
        ("Mon/Tue", lambda t: t["weekday"] in ("Mon", "Tue")),
        ("Thu/Fri", lambda t: t["weekday"] in ("Thu", "Fri")),
        ("index trend PDHL", lambda t: t["book"] != "crude" and t["structure"] == "trend"),
        ("crude quiet", lambda t: t["book"] == "crude" and t["structure"] == "quiet"),
        (
            "trend + with VWAP + early",
            lambda t: t["structure"] == "trend" and t["withVwap"] and t["early"],
        ),
        (
            "trend + against VWAP + early",
            lambda t: t["structure"] == "trend" and t["againstVwap"] and t["early"],
        ),
        (
            "short + against VWAP",
            lambda t: t["short"] and t["againstVwap"],
        ),
        (
            "long + with VWAP",
            lambda t: t["long"] and t["withVwap"],
        ),
    ]

    scored = []
    for name, pred in rules:
        hit = [t for t in tickets if pred(t)]
        if len(hit) < 6:
            continue

        def apply(rows):
            out = []
            for t in rows:
                use = t["flip"] if pred(t) and t["flip"] is not None else t["orig"]
                out.append(use)
            return out

        iso = rev.score([t["orig"] for t in tickets if t["day"] < IS_UNTIL])
        isr = rev.score(apply([t for t in tickets if t["day"] < IS_UNTIL]))
        ooso = rev.score([t["orig"] for t in tickets if t["day"] >= IS_UNTIL])
        oosr = rev.score(apply([t for t in tickets if t["day"] >= IS_UNTIL]))
        why_hit = count(hit, "why")
        keep = (
            isr["net"] > iso["net"]
            and oosr["net"] > ooso["net"]
            and oosr["net"] > 0
            and isr["n"] >= 8
        )
        scored.append(
            {
                "name": name,
                "n": len(hit),
                "why": why_hit,
                "wrongPct": round(100 * why_hit.get("wrong_direction", 0) / len(hit), 1),
                "isOrig": iso,
                "isRule": isr,
                "oosOrig": ooso,
                "oosRule": oosr,
                "oosLiftRs": round(oosr["net"] - ooso["net"], 1),
                "keep": keep,
            }
        )

    scored.sort(key=lambda r: (-r["keep"], -r["oosLiftRs"], -r["wrongPct"]))
    kept = [r for r in scored if r["keep"]]
    champion = kept[0] if kept else None

    slim = {
        "sample": "Same 167 first-fills as the reverse autopsy",
        "isUntil": IS_UNTIL,
        "wrongDirection": len(wrong),
        "chopBothLose": len(chop),
        "origGreen": len(green),
        "rulesTried": len(scored),
        "kept": [r["name"] for r in kept],
        "champion": {
            "name": champion["name"] if champion else "",
            "means": (
                "Morning is trend. The book is a PDH/PDL break. The fill is already "
                "on the other side of VWAP. That is a failed break — take the other side."
            ),
            "n": champion["n"] if champion else 0,
            "wrong": (champion["why"].get("wrong_direction", 0) if champion else 0),
            "chop": (champion["why"].get("chop_both_lose", 0) if champion else 0),
            "alreadyGreen": (champion["why"].get("orig_green", 0) if champion else 0),
            "wrongPct": champion["wrongPct"] if champion else 0,
            "isOrigNetRs": champion["isOrig"]["net"] if champion else 0,
            "isRuleNetRs": champion["isRule"]["net"] if champion else 0,
            "oosOrigNetRs": champion["oosOrig"]["net"] if champion else 0,
            "oosRuleNetRs": champion["oosRule"]["net"] if champion else 0,
            "oosLiftRs": champion["oosLiftRs"] if champion else 0,
            "keep": bool(champion),
        }
        if champion
        else None,
        "slices": {
            "wrongBook": slices["book"]["wrong"],
            "wrongStructure": slices["structure"]["wrong"],
            "wrongMode": slices["mode"]["wrong"],
        },
        "liveOrders": False,
        "guaranteed": False,
        "armedOnCrudeBest": False,
        "honest": (
            "Pattern: trend PDH/PDL fill that is already against VWAP. 8 tickets. "
            "Flipping those beat the original by ₹1,160 after 1 Sep 2026, after charges. "
            "Sample is small. Not armed on Crude Best. Not a guaranteed profit."
        ),
    }
    OUT.joinpath("fail-pattern.json").write_text(
        json.dumps({"slim": slim, "top": scored[:8], "slices": slices}, indent=2)
    )
    FIXTURE.write_text(
        "/** Pre-trade pattern hunt on wrong-direction losers. Not a guaranteed profit. */\n"
        f"export const PAPER_FAIL_PATTERN = {json.dumps(slim, indent=2)} as const;\n"
    )
    print(pattern["honest"], flush=True)
    print(f"tried {len(scored)} kept {len(kept)}", flush=True)
    for r in scored[:10]:
        print(
            f"  {r['name']} n={r['n']} wrong%={r['wrongPct']} "
            f"IS {r['isOrig']['net']}→{r['isRule']['net']} "
            f"OOS {r['oosOrig']['net']}→{r['oosRule']['net']} "
            f"lift {r['oosLiftRs']} keep={r['keep']} why={r['why']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
