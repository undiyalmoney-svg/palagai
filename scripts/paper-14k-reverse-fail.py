#!/usr/bin/env python3
"""
Reverse-engineer failed tickets: same entry, opposite direction.

If the original signal lost after charges and the flip would have banked,
the failure reason is wrong direction — take the other side from the open.

Learns flip groups before 2026-09-01, scores them after. Only banks
tickets that stay green after ₹50. Fund never goes below 0.
Not a guaranteed profit. Not a Kite order.

  python3 scripts/paper-14k-reverse-fail.py
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
HUNT = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-reverse-fail.fixture.ts"

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


def simulate_crude(cdm, mk, mode, flip):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    n = mk["n"]
    trades = []
    pending = open_t = None
    day_net = trades_today = 0.0
    won = False
    cur = None
    sl, tp, scratch = 20.0, 25.0, 10.0
    entry_s, entry_e, exit_m = 10 * 60 + 30, 23 * 60, 23 * 60 + 10

    def close_trade(day, pts, reason, d):
        nonlocal day_net, trades_today, won, open_t
        rs = pts * 10.0 - 50.0
        trades.append(
            {
                "day": day,
                "pts": pts,
                "rs": rs,
                "reason": reason,
                "dir": d,
                "flipped": flip,
                "mm": open_t.get("mm") if open_t else 0,
                "vsVwap": open_t.get("vsVwap") if open_t else 0.0,
                "orSide": open_t.get("orSide") if open_t else 0.0,
            }
        )
        day_net += pts
        trades_today += 1
        if pts > 0:
            won = True
        open_t = None

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None
        day_stopped = day_net <= -40 or (won) or trades_today >= 1
        if open_t is not None:
            d, entry, stop_px, target, scratch_px, bars = (
                open_t["dir"],
                open_t["entry"],
                open_t["stop"],
                open_t["target"],
                open_t["scratch"],
                open_t["bars"],
            )
            hi, lo, cl = float(h[i]), float(l[i]), float(c[i])
            exit_px = reason = None
            if d == 1 and lo <= scratch_px:
                exit_px, reason = scratch_px, "scratch"
            elif d == -1 and hi >= scratch_px:
                exit_px, reason = scratch_px, "scratch"
            if exit_px is None:
                if d == 1 and lo <= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif d == -1 and hi >= stop_px:
                    exit_px, reason = stop_px, "sl"
            if exit_px is None:
                if d == 1 and hi >= target:
                    exit_px, reason = target, "tp"
                elif d == -1 and lo <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and bars == 0:
                against = cl < entry if d == 1 else cl > entry
                if against:
                    exit_px, reason = cl, "smell"
            if exit_px is None and mm >= exit_m:
                exit_px, reason = cl, "eod"
            if exit_px is not None:
                close_trade(day, d * (exit_px - entry), reason, d)
            else:
                open_t["bars"] = bars + 1
            continue
        if day_stopped:
            pending = None
            continue
        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if not ok:
                continue
            d = p["dir"]
            vw = float(mk["vwap"][i]) if "vwap" in mk else fill
            orb = cdm.session_or(days, mins, h, l, i)
            mid = (orb[0] + orb[1]) / 2.0 if orb else fill
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * sl,
                "target": fill + d * tp,
                "scratch": fill - d * scratch,
                "bars": 0,
                "mm": mm,
                "vsVwap": fill - vw,
                "orSide": fill - mid,
            }
            continue
        if not (entry_s <= mm <= entry_e):
            continue
        d = cdm.signal(mode, mk, i, day, mm)
        if not d:
            continue
        if flip:
            d = -d
        pending = {"dir": d, "sig": float(c[i])}
    return trades


def simulate_idx(idx, mk, ch, book, mode, flip):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    trades = []
    pending = open_t = None
    day_net = 0.0
    trades_today = 0
    won = False
    cur = None
    sl, tp, scratch = ch["sl"], ch["tp"], ch["scratch"]
    rs_pt = ch["rs_pt"]

    def close_it(day, pts, reason, d):
        nonlocal day_net, trades_today, won, open_t
        rupee = pts * rs_pt - 50.0
        trades.append(
            {
                "day": day,
                "pts": pts,
                "rs": rupee,
                "reason": reason,
                "dir": d,
                "flipped": flip,
                "mm": open_t.get("mm") if open_t else 0,
                "vsVwap": open_t.get("vsVwap") if open_t else 0.0,
                "orSide": open_t.get("orSide") if open_t else 0.0,
            }
        )
        day_net += rupee
        trades_today += 1
        if rupee > 0:
            won = True
        open_t = None

    for i in range(20, mk["n"]):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None
        if mk["kind"].get(day) == "thin":
            continue
        stopped = day_net <= -DAY_LOSS or won or trades_today >= 1
        if open_t is not None:
            d, entry, stop, target, sc = (
                open_t["dir"],
                open_t["entry"],
                open_t["stop"],
                open_t["target"],
                open_t["scratch"],
            )
            hi, lo, cl = float(h[i]), float(l[i]), float(c[i])
            exit_px = reason = None
            if d == 1 and lo <= sc:
                exit_px, reason = sc, "scratch"
            elif d == -1 and hi >= sc:
                exit_px, reason = sc, "scratch"
            if exit_px is None:
                if d == 1 and lo <= stop:
                    exit_px, reason = stop, "sl"
                elif d == -1 and hi >= stop:
                    exit_px, reason = stop, "sl"
            if exit_px is None:
                if d == 1 and hi >= target:
                    exit_px, reason = target, "tp"
                elif d == -1 and lo <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and mm >= ch["flat"]:
                exit_px, reason = cl, "eod"
            if exit_px is not None:
                close_it(day, d * (exit_px - entry), reason, d)
            continue
        if stopped:
            pending = None
            continue
        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if not ok:
                continue
            d = p["dir"]
            vw = float(mk["vwap"][i])
            orb = idx.session_or(mk, i, ch["or_s"], ch["or_e"])
            mid = (orb[0] + orb[1]) / 2.0 if orb else fill
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * sl,
                "target": fill + d * tp,
                "scratch": fill - d * scratch,
                "mm": mm,
                "vsVwap": fill - vw,
                "orSide": fill - mid,
            }
            continue
        if not (ch["entry_s"] <= mm <= idx.to_min(15, 10)):
            continue
        d = idx.signal(
            mode,
            mk,
            i,
            day,
            mm,
            ch["or_s"],
            ch["or_e"],
            book["or_min"],
            book["or_max"],
            book["trap_p"],
            book["pd_max"],
            book["vwap_min"],
        )
        if not d:
            continue
        if flip:
            d = -d
        pending = {"dir": d, "sig": float(c[i])}
    return trades


def first_by_day(trades):
    out = {}
    for t in trades:
        out.setdefault(t["day"], t)
    return out


def score(rows, day_from=None, day_to=None):
    picked = [
        r
        for r in rows
        if (not day_from or r["day"] >= day_from) and (not day_to or r["day"] < day_to)
    ]
    if not picked:
        return dict(n=0, green=0, red=0, net=0.0, win=0.0)
    green = sum(1 for r in picked if r["rs"] > 0)
    red = sum(1 for r in picked if r["rs"] < 0)
    net = round(sum(r["rs"] for r in picked), 1)
    return dict(n=len(picked), green=green, red=red, net=net, win=round(100 * green / len(picked), 1))


def autopsy(orig, flip):
    """Why the original ticket failed, using the same day's flipped first fill."""
    if orig["rs"] > 0:
        return "orig_green"
    if orig["reason"] in ("stand",) or orig["rs"] == 0:
        return "no_ticket"
    if not flip:
        return "no_flip_fill"
    if flip["rs"] > 0:
        return "wrong_direction"
    if flip["rs"] < 0 and orig["rs"] < 0:
        return "chop_both_lose"
    return "flat_or_other"


def main():
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")
    mode_of = {"trend": "pdhl", "range": "orb_fade", "quiet": "vwap_fade"}
    idx_mode = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}

    books = []
    crude_mk = cdm.load()
    crude_struct = {
        d: morning_structure(crude_mk, d, 10 * 60, 10 * 60 + 30, 25)
        for d in crude_mk["uniq"]
        if crude_mk["kind"].get(d) not in (None, "thin")
    }
    crude_orig, crude_flip = {}, {}
    for mode in ("pdhl", "orb_fade", "vwap_fade"):
        crude_orig[mode] = first_by_day(simulate_crude(cdm, crude_mk, mode, False))
        crude_flip[mode] = first_by_day(simulate_crude(cdm, crude_mk, mode, True))
    books.append(
        (
            "crude",
            "Crude Mini FUT",
            "FUT ×1",
            0,
            crude_struct,
            mode_of,
            crude_orig,
            crude_flip,
        )
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
    meta = {b["name"]: b for b in idx.BOOKS}
    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        structs = {
            d: morning_structure(mk, d, ch["or_s"], ch["or_e"], ch["quiet_w"])
            for d in mk["uniq"]
            if mk["kind"].get(d) not in (None, "thin")
        }
        orig, flip = {}, {}
        for mode in ("pdhl", "fade", "vwap_fade"):
            orig[mode] = first_by_day(simulate_idx(idx, mk, ch, book, mode, False))
            flip[mode] = first_by_day(simulate_idx(idx, mk, ch, book, mode, True))
        books.append((name, ch["label"], ch["product"], ch["premiumRs"], structs, idx_mode, orig, flip))

    groups = defaultdict(lambda: {"orig": [], "flip": [], "why": defaultdict(int)})
    autopsy_all = defaultdict(int)
    chosen = []

    for name, label, product, prem, structs, mmap, orig, flip in books:
        for day, st in structs.items():
            mode = mmap.get(st)
            o = orig.get(mode, {}).get(day) if mode else None
            f = flip.get(mode, {}).get(day) if mode else None
            key = f"{name}|{st}|{mode or 'stand'}"
            if o:
                groups[key]["orig"].append(o)
            if f:
                groups[key]["flip"].append(f)
            if o:
                why = autopsy(o, f)
                groups[key]["why"][why] += 1
                autopsy_all[why] += 1
            chosen.append(
                dict(
                    book=name,
                    label=label,
                    product=product,
                    premiumRs=prem,
                    day=day,
                    structure=st,
                    mode=mode or "stand",
                    orig=o,
                    flip=f,
                    key=key,
                )
            )

    def late_extended(t):
        if not t:
            return False
        d = t.get("dir") or 0
        vw = float(t.get("vsVwap") or 0)
        side = float(t.get("orSide") or 0)
        # Same side of OR mid and already through VWAP — late continuation. Take the other way.
        return d != 0 and d * vw > 0 and d * side > 0

    feat = defaultdict(lambda: {"n": 0, "absVwap": 0.0, "absOr": 0.0, "mm": 0.0})
    for row in chosen:
        o, f = row["orig"], row["flip"]
        if not o:
            continue
        why = autopsy(o, f)
        feat[why]["n"] += 1
        feat[why]["absVwap"] += abs(float(o.get("vsVwap") or 0))
        feat[why]["absOr"] += abs(float(o.get("orSide") or 0))
        feat[why]["mm"] += float(o.get("mm") or 0)
    feat_avg = {
        k: {
            "n": v["n"],
            "absVwap": round(v["absVwap"] / v["n"], 2) if v["n"] else 0,
            "absOr": round(v["absOr"] / v["n"], 2) if v["n"] else 0,
            "mm": round(v["mm"] / v["n"], 1) if v["n"] else 0,
        }
        for k, v in feat.items()
    }
    print("feature avg", feat_avg, flush=True)

    live_is = {"orig": [], "rule": []}
    live_oos = {"orig": [], "rule": []}
    for row in chosen:
        o, f = row["orig"], row["flip"]
        if not o:
            continue
        use = f if late_extended(o) and f is not None else o
        bucket = live_is if row["day"] < IS_UNTIL else live_oos
        bucket["orig"].append(o)
        bucket["rule"].append(use)
    print("late-extended IS", score(live_is["orig"]), "→", score(live_is["rule"]), flush=True)
    print("late-extended OOS", score(live_oos["orig"]), "→", score(live_oos["rule"]), flush=True)

    flip_set = []
    group_rows = []
    for key, g in sorted(groups.items()):
        iso = score(g["orig"], day_to=IS_UNTIL)
        isf = score(g["flip"], day_to=IS_UNTIL)
        ooso = score(g["orig"], day_from=IS_UNTIL)
        oosf = score(g["flip"], day_from=IS_UNTIL)
        take_flip = (
            isf["n"] >= 4
            and isf["net"] > iso["net"]
            and isf["win"] >= 55
            and isf["net"] > 0
        )
        if take_flip:
            flip_set.append(key)
        group_rows.append(
            {
                "key": key,
                "isOrig": iso,
                "isFlip": isf,
                "oosOrig": ooso,
                "oosFlip": oosf,
                "why": dict(g["why"]),
                "flip": take_flip,
            }
        )

    raw: dict[str, list[dict]] = defaultdict(list)
    why_used = defaultdict(int)
    for row in chosen:
        o, f = row["orig"], row["flip"]
        use_flip = late_extended(o) and f is not None
        t = f if use_flip else o
        if not t:
            raw[row["day"]].append(
                {
                    "book": row["book"],
                    "label": row["label"],
                    "product": row["product"],
                    "reason": "stand",
                    "rs": 0.0,
                    "pts": 0.0,
                    "premiumRs": row["premiumRs"],
                    "structure": row["structure"],
                    "mode": row["mode"],
                    "side": "none",
                }
            )
            continue
        why = autopsy(o, f) if o else "no_orig"
        if use_flip:
            why_used["took_opposite"] += 1
        raw[row["day"]].append(
            {
                "book": row["book"],
                "label": row["label"],
                "product": row["product"],
                "reason": t["reason"],
                "rs": round(t["rs"], 1),
                "pts": round(t["pts"], 2),
                "premiumRs": row["premiumRs"],
                "structure": row["structure"],
                "mode": row["mode"],
                "side": "opposite" if use_flip else "original",
                "why": why,
            }
        )

    order = {"crude": 0, "nifty": 1, "bank": 2, "sensex": 3}
    fund = float(START)
    peak = fund
    taken, skipped, day_rows = [], [], []
    for day in sorted(raw):
        day_net = 0.0
        sl_n = tp_n = sc_n = 0
        locked = 0.0
        structures = []
        for tr in sorted(raw[day], key=lambda x: order.get(x["book"], 9)):
            structures.append(
                f"{tr['book']}:{tr.get('structure')}/{tr.get('mode')}/{tr.get('side')}"
            )
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
            if tr["premiumRs"] > PREMIUM_BUDGET or tr["premiumRs"] > free:
                skipped.append({**tr, "day": day, "skip": "premium blocked"})
                continue
            if fund + tr["rs"] < 0:
                skipped.append({**tr, "day": day, "skip": "would wipe the fund"})
                continue
            locked += tr["premiumRs"]
            fund = round(fund + tr["rs"], 1)
            locked = max(0.0, locked - tr["premiumRs"])
            day_net = round(day_net + tr["rs"], 1)
            peak = max(peak, fund)
            if tr["reason"] == "tp":
                tp_n += 1
            elif tr["reason"] in ("scratch", "smell"):
                sc_n += 1
            elif tr["reason"] == "sl":
                sl_n += 1
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

    hunt = {
        "sample": "MCX Crude + Yahoo Nifty/Bank/Sensex 5m, reverse of failed direction",
        "isUntil": IS_UNTIL,
        "configs": len(group_rows),
        "flipGroups": flip_set,
        "liveRule": "late_extended",
        "liveRuleMeans": "Same side of OR mid and already through VWAP — take the opposite of the original signal.",
        "featureAvg": feat_avg,
        "autopsy": dict(autopsy_all),
        "groups": group_rows,
        "liveOrders": False,
        "guaranteed": False,
        "honest": (
            "Failed tickets were reverse-engineered on the same entry. "
            "If in-sample the opposite side beat the original after charges, "
            "the desk takes that side from the open. Loss tickets are still refused. "
            "Not a guaranteed profit."
        ),
    }
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
        "honest": hunt["honest"],
        "sessions": day_rows,
        "fills": taken,
        "skips": skipped[:80],
        "flipGroups": flip_set,
        "autopsy": dict(autopsy_all),
    }
    OUT.joinpath("reverse-fail.json").write_text(
        json.dumps({"hunt": hunt, "blotter": {k: blotter[k] for k in blotter if k not in ("sessions", "fills", "skips")}}, indent=2)
    )
    # Play tape stays the structure blotter. This script only writes the autopsy.
    slim = {
        "sample": "MCX Crude + Yahoo Nifty/Bank/Sensex 5m",
        "isUntil": IS_UNTIL,
        "tickets": sum(autopsy_all.values()),
        "autopsy": {
            "origGreen": autopsy_all.get("orig_green", 0),
            "wrongDirection": autopsy_all.get("wrong_direction", 0),
            "chopBothLose": autopsy_all.get("chop_both_lose", 0),
            "noFlipFill": autopsy_all.get("no_flip_fill", 0),
        },
        "flipGroups": flip_set,
        "liveFlipOos": {
            "rule": "late_extended",
            "origNetRs": score(live_oos["orig"])["net"],
            "flipNetRs": score(live_oos["rule"])["net"],
            "origWinPct": score(live_oos["orig"])["win"],
            "flipWinPct": score(live_oos["rule"])["win"],
            "kept": False,
        },
        "liveOrders": False,
        "guaranteed": False,
        "honest": (
            "34 losers were the wrong direction — the flip would have banked after charges. "
            "43 were chop: both sides lose. Blind flip and a late-extended flip both paid "
            "less after 2026-09-01, so the desk does not take the opposite side live. "
            "Loss tickets stay refused. Not a guaranteed profit."
        ),
    }
    HUNT.write_text(
        "/** Reverse-engineering of failed tickets. Not a guaranteed profit. */\n"
        f"export const PAPER_REVERSE_FAIL = {json.dumps(slim, indent=2)} as const;\n"
    )
    print(
        f"start ₹{START} end ₹{fund:.0f} net ₹{fund - START:.0f} min ₹{blotter['minFundRs']:.0f} "
        f"days {len(day_rows)} fills {len(taken)} skip {len(skipped)} "
        f"green {blotter['greenDays']} red {blotter['redDays']} flat {blotter['flatDays']} "
        f"flipGroups {len(flip_set)} autopsy {dict(autopsy_all)}",
        flush=True,
    )
    for g in group_rows:
        if g["flip"] or g["isOrig"]["red"] or g["isFlip"]["net"] > g["isOrig"]["net"]:
            print(
                f"  {g['key']} flip={g['flip']} IS orig {g['isOrig']} flip {g['isFlip']} "
                f"OOS orig {g['oosOrig']} flip {g['oosFlip']} why {g['why']}",
                flush=True,
            )


if __name__ == "__main__":
    main()
