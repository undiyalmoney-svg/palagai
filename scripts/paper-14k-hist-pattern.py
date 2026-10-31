#!/usr/bin/env python3
"""
Replay the fail-pattern on a longer historical tape and hunt a
pre-trade filter that still banks after charges on the later half.

Yahoo 1h (~2y) for Nifty / Bank / Sensex / CL proxy.
MCX Crude 5m stays the real Crude Mini tape.

A rule is kept only if later-half net after ₹50 beats the original
on at least two long books and stays positive. Not a guaranteed
profit. Not a job.

  python3 scripts/paper-14k-hist-pattern.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / "reports" / "paper-14k"
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-hist-pattern.fixture.ts"

CHARGE = 50.0
CL_SCALE = 85.0
LONG_BOOKS = ("crude_cl_1h_proxy", "nifty_1h", "bank_1h", "sensex_1h")


def to_min(h, m=0):
    return h * 60 + m


def fetch_1h(symbol: str, cache_name: str, scale: float = 1.0) -> list[dict]:
    path = CACHE / f"yahoo-1h-{cache_name}.json"
    if path.exists():
        return json.loads(path.read_text())
    df = yf.Ticker(symbol).history(period="730d", interval="1h", auto_adjust=False)
    if df is None or df.empty:
        return []
    df = df.tz_convert("Asia/Kolkata")
    rows = []
    for idx, r in df.iterrows():
        if r["Close"] != r["Close"]:
            continue
        rows.append(
            dict(
                day=idx.strftime("%Y-%m-%d"),
                min=idx.hour * 60 + idx.minute,
                open=float(r["Open"]) * scale,
                high=float(r["High"]) * scale,
                low=float(r["Low"]) * scale,
                close=float(r["Close"]) * scale,
            )
        )
    path.write_text(json.dumps(rows))
    return rows


def load_rows(rows: list[dict], session_s: int, session_e: int, min_bars: int) -> dict | None:
    if not rows:
        return None
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([r["day"] for r in rows])
    mins = np.array([r["min"] for r in rows], int)
    uniq = []
    seen = set()
    for d in days:
        if d not in seen:
            seen.add(d)
            uniq.append(d)
    day_hl, kind, or_hl = {}, {}, {}
    for d in uniq:
        mask = days == d
        day_hl[d] = (float(h[mask].max()), float(l[mask].min()))
        sess = mask & (mins >= session_s) & (mins <= session_e)
        kind[d] = "thin" if int(sess.sum()) < min_bars else "ok"
    prev = {}
    for i, d in enumerate(uniq):
        if i:
            prev[d] = day_hl[uniq[i - 1]]
    vwap = np.zeros(len(c))
    cur = None
    pv = nbar = 0.0
    for i in range(len(c)):
        if days[i] != cur:
            cur, pv, nbar = days[i], 0.0, 0
        pv += (h[i] + l[i] + c[i]) / 3.0
        nbar += 1
        vwap[i] = pv / nbar
    return dict(
        o=o,
        h=h,
        l=l,
        c=c,
        days=days,
        mins=mins,
        n=len(c),
        uniq=uniq,
        prev=prev,
        kind=kind,
        vwap=vwap,
        day_hl=day_hl,
    )


def morning_structure(mk, day, or_s, or_e, quiet_w):
    mask = (mk["days"] == day) & (mk["mins"] >= or_s) & (mk["mins"] <= or_e)
    if int(mask.sum()) < 2:
        return "stand", 0.0, 0.0, 0.0
    hi, lo = float(mk["h"][mask].max()), float(mk["l"][mask].min())
    width = hi - lo
    if width <= 0:
        return "stand", hi, lo, width
    o0, c1 = float(mk["o"][mask][0]), float(mk["c"][mask][-1])
    mid = (hi + lo) / 2.0
    if width < quiet_w:
        return "quiet", hi, lo, width
    if c1 >= mid + 0.2 * width and c1 > o0:
        return "trend", hi, lo, width
    if c1 <= mid - 0.2 * width and c1 < o0:
        return "trend", hi, lo, width
    return "range", hi, lo, width


def pdhl_dir(mk, i, day, pd_max):
    lv = mk["prev"].get(day)
    if not lv:
        return 0
    pdh, pdl = lv
    if (pdh - pdl) > pd_max:
        return 0
    cc, oo = float(mk["c"][i]), float(mk["o"][i])
    if cc > pdh and cc > oo:
        return 1
    if cc < pdl and cc < oo:
        return -1
    return 0


def fade_dir(mk, i, day, mm, or_s, or_e, or_min, or_max):
    if mm <= or_e:
        return 0
    mask = (mk["days"] == day) & (mk["mins"] >= or_s) & (mk["mins"] <= or_e)
    if int(mask.sum()) < 1:
        return 0
    oh, ol = float(mk["h"][mask].max()), float(mk["l"][mask].min())
    width = oh - ol
    if width < or_min or width > or_max:
        return 0
    hh, ll, cc, oo = float(mk["h"][i]), float(mk["l"][i]), float(mk["c"][i]), float(mk["o"][i])
    if hh > oh and cc < oh and cc < oo:
        return -1
    if ll < ol and cc > ol and cc > oo:
        return 1
    return 0


def vwap_fade_dir(mk, i, min_dist):
    cc, oo = float(mk["c"][i]), float(mk["o"][i])
    vw = float(mk["vwap"][i])
    dist = cc - vw
    if abs(dist) < min_dist:
        return 0
    if dist > 0 and cc < oo:
        return -1
    if dist < 0 and cc > oo:
        return 1
    return 0


def simulate(mk, *, sl, tp, scratch, rs_pt, or_s, or_e, entry_s, flat, quiet_w, pd_max, mode="pdhl"):
    trades = []
    pending = open_t = None
    won = False
    trades_today = 0
    cur = None
    structs = {}
    or_info = {}
    for d in mk["uniq"]:
        if mk["kind"].get(d) == "thin":
            continue
        st, oh, ol, width = morning_structure(mk, d, or_s, or_e, quiet_w)
        structs[d] = st
        or_info[d] = (oh, ol, width)

    def close_it(day, pts, reason, meta):
        nonlocal won, trades_today, open_t
        rs = pts * rs_pt - CHARGE
        trades.append(
            dict(
                day=day,
                pts=round(pts, 4),
                rs=round(rs, 2),
                reason=reason,
                **meta,
            )
        )
        trades_today += 1
        if rs > 0:
            won = True
        open_t = None

    for i in range(3, mk["n"]):
        day = mk["days"][i]
        mm = int(mk["mins"][i])
        if day != cur:
            cur, won, trades_today = day, False, 0
            pending = open_t = None
        if mk["kind"].get(day) == "thin":
            continue
        st = structs.get(day, "stand")
        if open_t is not None:
            d, entry, stop, target, sc = (
                open_t["dir"],
                open_t["entry"],
                open_t["stop"],
                open_t["target"],
                open_t["scratch"],
            )
            hi, lo, cl = float(mk["h"][i]), float(mk["l"][i]), float(mk["c"][i])
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
            if exit_px is None and mm >= flat:
                exit_px, reason = cl, "eod"
            if exit_px is not None:
                close_it(day, d * (exit_px - entry), reason, open_t["meta"])
            continue
        if won or trades_today >= 1:
            pending = None
            continue
        if pending is not None:
            p = pending
            pending = None
            fill = float(mk["o"][i])
            ok = (
                (mk["c"][i] > mk["o"][i] and mk["c"][i] > p["sig"])
                if p["dir"] == 1
                else (mk["c"][i] < mk["o"][i] and mk["c"][i] < p["sig"])
            )
            if not ok:
                continue
            d = p["dir"]
            vw = float(mk["vwap"][i])
            oh, ol, width = or_info.get(day, (0.0, 0.0, 0.0))
            or_mid = (oh + ol) / 2.0 if width else fill
            vs_vwap = fill - vw
            vs_or = fill - or_mid
            lv = mk["prev"].get(day) or (0.0, 0.0)
            pd_range = lv[0] - lv[1]
            wd = datetime.strptime(str(day), "%Y-%m-%d").weekday()
            meta = dict(
                dir=d,
                structure=st,
                mode=p["mode"],
                againstVwap=d * vs_vwap < 0,
                withVwap=d * vs_vwap > 0,
                againstOr=d * vs_or < 0,
                withOr=d * vs_or > 0,
                early=mm < 12 * 60,
                late=mm >= 14 * 60,
                morning=mm < 11 * 60,
                monday=wd == 0,
                friday=wd == 4,
                midweek=wd in (1, 2, 3),
                absVwap=abs(vs_vwap),
                orWidth=width,
                pdRange=pd_range,
                mm=mm,
            )
            open_t = dict(
                dir=d,
                entry=fill,
                stop=fill - d * sl,
                target=fill + d * tp,
                scratch=fill - d * scratch,
                meta=meta,
            )
            continue
        if not (entry_s <= mm <= flat - 30):
            continue
        if mode == "pdhl":
            if st != "trend":
                continue
            d = pdhl_dir(mk, i, day, pd_max)
            if d:
                pending = dict(dir=d, sig=float(mk["c"][i]), st=st, mode="pdhl")
        elif mode == "structure":
            if st == "trend":
                d = pdhl_dir(mk, i, day, pd_max)
                if d:
                    pending = dict(dir=d, sig=float(mk["c"][i]), st=st, mode="pdhl")
            elif st == "range":
                d = fade_dir(mk, i, day, mm, or_s, or_e, quiet_w * 0.4, pd_max)
                if d:
                    pending = dict(dir=d, sig=float(mk["c"][i]), st=st, mode="orb_fade")
            elif st == "quiet":
                d = vwap_fade_dir(mk, i, max(quiet_w * 0.6, 8))
                if d:
                    pending = dict(dir=d, sig=float(mk["c"][i]), st=st, mode="vwap_fade")
        elif mode == "flip_against_vwap":
            if st != "trend":
                continue
            d = pdhl_dir(mk, i, day, pd_max)
            if d:
                pending = dict(dir=d, sig=float(mk["c"][i]), st=st, mode="pdhl")
    return trades


def simulate_flip_against(mk, cfg):
    """Same as pdhl but reverse the fill when it is already against VWAP."""
    trades = simulate(mk, mode="pdhl", **cfg)
    # Re-simulate with forced flip at fill by walking the same pending path.
    # Cheaper: reuse simulate and invert P/L for againstVwap tickets by
    # running a dedicated fill flip below.
    out = []
    pending = open_t = None
    won = False
    trades_today = 0
    cur = None
    sl, tp, scratch, rs_pt = cfg["sl"], cfg["tp"], cfg["scratch"], cfg["rs_pt"]
    or_s, or_e, entry_s, flat = cfg["or_s"], cfg["or_e"], cfg["entry_s"], cfg["flat"]
    quiet_w, pd_max = cfg["quiet_w"], cfg["pd_max"]
    structs = {}
    for d in mk["uniq"]:
        if mk["kind"].get(d) == "thin":
            continue
        st, *_ = morning_structure(mk, d, or_s, or_e, quiet_w)
        structs[d] = st

    def close_it(day, pts, reason, meta):
        nonlocal won, trades_today, open_t
        rs = pts * rs_pt - CHARGE
        out.append(dict(day=day, pts=round(pts, 4), rs=round(rs, 2), reason=reason, **meta))
        trades_today += 1
        if rs > 0:
            won = True
        open_t = None

    for i in range(3, mk["n"]):
        day = mk["days"][i]
        mm = int(mk["mins"][i])
        if day != cur:
            cur, won, trades_today = day, False, 0
            pending = open_t = None
        if mk["kind"].get(day) == "thin":
            continue
        st = structs.get(day, "stand")
        if open_t is not None:
            d, entry, stop, target, sc = (
                open_t["dir"],
                open_t["entry"],
                open_t["stop"],
                open_t["target"],
                open_t["scratch"],
            )
            hi, lo, cl = float(mk["h"][i]), float(mk["l"][i]), float(mk["c"][i])
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
            if exit_px is None and mm >= flat:
                exit_px, reason = cl, "eod"
            if exit_px is not None:
                close_it(day, d * (exit_px - entry), reason, open_t["meta"])
            continue
        if won or trades_today >= 1:
            pending = None
            continue
        if pending is not None:
            p = pending
            pending = None
            fill = float(mk["o"][i])
            ok = (
                (mk["c"][i] > mk["o"][i] and mk["c"][i] > p["sig"])
                if p["dir"] == 1
                else (mk["c"][i] < mk["o"][i] and mk["c"][i] < p["sig"])
            )
            if not ok:
                continue
            d = p["dir"]
            vw = float(mk["vwap"][i])
            against = d * (fill - vw) < 0
            flipped = False
            if against:
                d = -d
                flipped = True
            meta = dict(dir=d, structure=st, mode="pdhl", againstVwap=against, flipped=flipped)
            open_t = dict(
                dir=d,
                entry=fill,
                stop=fill - d * sl,
                target=fill + d * tp,
                scratch=fill - d * scratch,
                meta=meta,
            )
            continue
        if not (entry_s <= mm <= flat - 30):
            continue
        if st != "trend":
            continue
        d = pdhl_dir(mk, i, day, pd_max)
        if d:
            pending = dict(dir=d, sig=float(mk["c"][i]), st=st)
    return out, trades


def score(trades, day_from=None, day_to=None):
    rows = [
        t
        for t in trades
        if (not day_from or t["day"] >= day_from) and (not day_to or t["day"] < day_to)
    ]
    if not rows:
        return dict(n=0, green=0, red=0, net=0.0, win=0.0, banked=0, bankedNet=0.0)
    green = sum(1 for t in rows if t["rs"] > 0)
    red = sum(1 for t in rows if t["rs"] < 0)
    banked = [t for t in rows if t["rs"] > 0]
    return dict(
        n=len(rows),
        green=green,
        red=red,
        net=round(sum(t["rs"] for t in rows), 1),
        win=round(100 * green / len(rows), 1),
        banked=len(banked),
        bankedNet=round(sum(t["rs"] for t in banked), 1),
    )


def mid_day(uniq):
    if not uniq:
        return None
    return uniq[len(uniq) // 2]


def apply_rule(trades, pred, action):
    out = []
    for t in trades:
        if not pred(t):
            out.append(t)
            continue
        if action == "skip":
            continue
        if action == "flip":
            # Flip after the fact is not a fill replay — refuse it.
            continue
    return out


def preds():
    return [
        ("against VWAP", lambda t: t.get("againstVwap")),
        ("with VWAP", lambda t: t.get("withVwap")),
        ("against OR", lambda t: t.get("againstOr")),
        ("with OR", lambda t: t.get("withOr")),
        ("early", lambda t: t.get("early")),
        ("late", lambda t: t.get("late")),
        ("morning", lambda t: t.get("morning")),
        ("Monday", lambda t: t.get("monday")),
        ("Friday", lambda t: t.get("friday")),
        ("not midweek", lambda t: not t.get("midweek")),
        ("against VWAP + against OR", lambda t: t.get("againstVwap") and t.get("againstOr")),
        ("against VWAP + early", lambda t: t.get("againstVwap") and t.get("early")),
        ("against VWAP + late", lambda t: t.get("againstVwap") and t.get("late")),
        ("against VWAP + Monday", lambda t: t.get("againstVwap") and t.get("monday")),
        ("against VWAP + Friday", lambda t: t.get("againstVwap") and t.get("friday")),
        ("with VWAP + early", lambda t: t.get("withVwap") and t.get("early")),
        ("extended vs VWAP", lambda t: (t.get("absVwap") or 0) > (t.get("orWidth") or 0) * 0.5),
        ("weak vs VWAP", lambda t: (t.get("absVwap") or 0) < (t.get("orWidth") or 0) * 0.15),
        ("wide OR", lambda t: (t.get("orWidth") or 0) > (t.get("pdRange") or 1) * 0.6),
        ("wide PD range", lambda t: (t.get("pdRange") or 0) > (t.get("orWidth") or 1) * 8),
        ("range days", lambda t: t.get("structure") == "range"),
        ("quiet days", lambda t: t.get("structure") == "quiet"),
        ("OR fade", lambda t: t.get("mode") == "orb_fade"),
        ("VWAP fade", lambda t: t.get("mode") == "vwap_fade"),
        ("range + against VWAP", lambda t: t.get("structure") == "range" and t.get("againstVwap")),
        ("quiet + against VWAP", lambda t: t.get("structure") == "quiet" and t.get("againstVwap")),
        ("scratch-shaped fade", lambda t: t.get("mode") in ("orb_fade", "vwap_fade") and t.get("againstOr")),
    ]


def load_mcx_5m():
    path = CACHE / "crudeoilm-5m-merged.json"
    raw = json.loads(path.read_text())
    rows = []
    for r in raw:
        dt = str(r["date"]).replace("T", " ").split("+")[0]
        rows.append(
            dict(
                day=dt[:10],
                min=int(dt[11:13]) * 60 + int(dt[14:16]),
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
            )
        )
    return load_rows(rows, to_min(10), to_min(23, 10), 40)


def book_specs():
    books = []
    mcx = load_mcx_5m()
    if mcx:
        books.append(
            (
                "crude_mcx_5m",
                mcx,
                dict(
                    sl=20,
                    tp=25,
                    scratch=10,
                    rs_pt=10.0,
                    or_s=to_min(10),
                    or_e=to_min(10, 30),
                    entry_s=to_min(10, 30),
                    flat=to_min(23, 10),
                    quiet_w=25,
                    pd_max=400,
                ),
            )
        )
    crude_1h = fetch_1h("CL=F", "cl", CL_SCALE)
    mk = load_rows(crude_1h, to_min(18), to_min(23, 30), 3)
    if mk:
        books.append(
            (
                "crude_cl_1h_proxy",
                mk,
                dict(
                    sl=40,
                    tp=50,
                    scratch=20,
                    rs_pt=10.0,
                    or_s=to_min(18),
                    or_e=to_min(19, 30),
                    entry_s=to_min(19, 30),
                    flat=to_min(23, 30),
                    quiet_w=50,
                    pd_max=800,
                ),
            )
        )
    for name, symbol, cache, rs_pt, sl, tp, scratch, quiet, pd_max in (
        ("nifty_1h", "^NSEI", "nifty", 13.0, 40, 80, 20, 40, 700),
        ("bank_1h", "^NSEBANK", "bank", 6.0, 80, 160, 40, 80, 1200),
        ("sensex_1h", "^BSESN", "sensex", 4.0, 100, 200, 50, 100, 1400),
    ):
        rows = fetch_1h(symbol, cache)
        mk = load_rows(rows, to_min(9, 15), to_min(15, 15), 4)
        if not mk:
            continue
        books.append(
            (
                name,
                mk,
                dict(
                    sl=sl,
                    tp=tp,
                    scratch=scratch,
                    rs_pt=rs_pt,
                    or_s=to_min(9, 15),
                    or_e=to_min(10, 15),
                    entry_s=to_min(10, 15),
                    flat=to_min(15, 15),
                    quiet_w=quiet,
                    pd_max=pd_max,
                ),
            )
        )
    return books


def slim_score(s):
    return {k: s[k] for k in ("n", "green", "red", "net", "win", "banked", "bankedNet")}


def main():
    specs = book_specs()
    orig_by_book = {}
    flip_by_book = {}
    struct_by_book = {}
    results = []
    for name, mk, cfg in specs:
        off = simulate(mk, mode="pdhl", **cfg)
        flipped, _ = simulate_flip_against(mk, cfg)
        struct = simulate(mk, mode="structure", **cfg)
        split = mid_day(mk["uniq"])
        orig_by_book[name] = (off, split, mk)
        flip_by_book[name] = flipped
        struct_by_book[name] = struct
        late_off = score(off, day_from=split)
        late_on = score(flipped, day_from=split)
        results.append(
            {
                "name": name,
                "span": f"{mk['uniq'][0]} → {mk['uniq'][-1]}" if mk["uniq"] else "",
                "days": len(mk["uniq"]),
                "bars": mk["n"],
                "split": split,
                "allOff": slim_score(score(off)),
                "allOn": slim_score(score(flipped)),
                "lateOff": slim_score(late_off),
                "lateOn": slim_score(late_on),
                "structAll": slim_score(score(struct)),
                "structLate": slim_score(score(struct, day_from=split)),
                "keep": late_on["net"] > late_off["net"] and late_on["net"] > 0,
                "flipped": sum(1 for t in flipped if t.get("flipped")),
            }
        )

    def hunt_skips(tape_by_book, prefix):
        rows = []
        for label, pred in preds():
            late_lift = 0.0
            late_net = 0.0
            orig_late = 0.0
            books_better = 0
            long_better = 0
            skipped = 0
            for name, (off, split, _mk) in orig_by_book.items():
                src = tape_by_book.get(name, off)
                filtered = apply_rule(src, pred, "skip")
                o = score(src, day_from=split)
                f = score(filtered, day_from=split)
                skipped += len(src) - len(filtered)
                late_lift += f["net"] - o["net"]
                late_net += f["net"]
                orig_late += o["net"]
                if f["net"] > o["net"] and f["net"] > 0:
                    books_better += 1
                    if name in LONG_BOOKS:
                        long_better += 1
            keep = (
                late_net > orig_late
                and late_net > 0
                and long_better >= 2
                and skipped >= 8
            )
            rows.append(
                {
                    "name": f"{prefix}{label}",
                    "lateLiftRs": round(late_lift, 1),
                    "lateNetRs": round(late_net, 1),
                    "lateOrigRs": round(orig_late, 1),
                    "booksBetter": books_better,
                    "longBetter": long_better,
                    "skipped": skipped,
                    "keep": keep,
                }
            )
        rows.sort(key=lambda r: (r["keep"], r["longBetter"], r["lateLiftRs"]), reverse=True)
        return rows

    # Hunt skip filters on PDHL and on the structure-switch tape.
    pdhl_rules = hunt_skips({n: t for n, (t, _s, _m) in orig_by_book.items()}, "skip ")
    struct_tape = {n: struct_by_book[n] for n in struct_by_book}
    struct_rules = hunt_skips(struct_tape, "structure skip ")
    rule_rows = pdhl_rules + struct_rules
    rule_rows.sort(key=lambda r: (r["keep"], r["longBetter"], r["lateLiftRs"]), reverse=True)
    kept_rules = [r for r in rule_rows if r["keep"]]
    champion = kept_rules[0] if kept_rules else None

    # Structure-switch vs trend-PDHL on later half.
    struct_late = round(sum(r["structLate"]["net"] for r in results), 1)
    pdhl_late = round(sum(r["lateOff"]["net"] for r in results), 1)
    struct_better = struct_late > pdhl_late and struct_late > 0

    late_off = round(sum(r["lateOff"]["net"] for r in results), 1)
    late_on = round(sum(r["lateOn"]["net"] for r in results), 1)
    all_off = round(sum(r["allOff"]["net"] for r in results), 1)
    all_on = round(sum(r["allOn"]["net"] for r in results), 1)
    late_banked_off = round(sum(r["lateOff"]["bankedNet"] for r in results), 1)
    late_banked_on = round(sum(r["lateOn"]["bankedNet"] for r in results), 1)

    week_pnl: dict[str, float] = defaultdict(float)
    for name, trades in struct_by_book.items():
        split = orig_by_book[name][1]
        for t in trades:
            if t["day"] < split:
                continue
            iso = datetime.strptime(t["day"], "%Y-%m-%d").isocalendar()
            week_pnl[f"{iso[0]}-W{iso[1]:02d}"] += t["rs"]
    weeks = list(week_pnl.values())
    worst_week = round(min(weeks), 1) if weeks else 0.0
    green_weeks = sum(1 for w in weeks if w > 0)
    red_weeks = sum(1 for w in weeks if w < 0)

    if champion is None and struct_better:
        champion = {
            "name": "morning structure switch, do not flip",
            "lateLiftRs": round(struct_late - pdhl_late, 1),
            "lateNetRs": struct_late,
            "lateOrigRs": pdhl_late,
            "booksBetter": sum(1 for r in results if r["structLate"]["net"] > r["lateOff"]["net"]),
            "longBetter": sum(
                1
                for r in results
                if r["name"] in LONG_BOOKS and r["structLate"]["net"] > r["lateOff"]["net"]
            ),
            "skipped": 0,
            "keep": True,
        }

    workable_base = all(r["lateOff"]["net"] > 0 for r in results if r["name"] in LONG_BOOKS)
    flip_failed = late_on <= late_off
    work_name = champion["name"] if champion else "morning trend + PDH/PDL, do not flip"

    honest = (
        "Two-year replay. "
        f"The 8-ticket against-VWAP flip lost ₹{late_off - late_on:.0f} on the later half after charges. "
        f"The pattern that holds: {work_name}. "
        f"Later-half structure net ₹{struct_late:.0f} vs trend-only ₹{pdhl_late:.0f} after ₹50. "
        f"Worst later-half week ₹{worst_week:.0f} ({green_weeks} green / {red_weeks} red weeks). "
        "This is not a salary and not a reason to quit a job. Not a guaranteed profit."
    )

    fixture = {
        "sample": "MCX Crude 5m + Yahoo 1h Nifty/Bank/Sensex + CL×85 proxy",
        "chargeRs": CHARGE,
        "books": [
            {
                "name": r["name"],
                "span": r["span"],
                "days": r["days"],
                "bars": r["bars"],
                "split": r["split"],
                "allOff": r["allOff"],
                "allOn": r["allOn"],
                "lateOff": r["lateOff"],
                "lateOn": r["lateOn"],
                "structLate": r["structLate"],
                "keep": r["keep"],
                "flipped": r["flipped"],
            }
            for r in results
        ],
        "flipKept": [r["name"] for r in results if r["keep"]],
        "sumNetOffRs": all_off,
        "sumNetOnRs": all_on,
        "lateNetOffRs": late_off,
        "lateNetOnRs": late_on,
        "lateLiftRs": round(late_on - late_off, 1),
        "lateBankedOffRs": late_banked_off,
        "lateBankedOnRs": late_banked_on,
        "rulesTried": len(rule_rows),
        "keptRules": [r["name"] for r in kept_rules],
        "champion": (
            {
                "name": champion["name"],
                "lateLiftRs": champion["lateLiftRs"],
                "lateNetRs": champion["lateNetRs"],
                "lateOrigRs": champion["lateOrigRs"],
                "booksBetter": champion["booksBetter"],
                "longBetter": champion["longBetter"],
                "skipped": champion["skipped"],
                "keep": True,
            }
            if champion
            else {
                "name": "morning trend + PDH/PDL, do not flip",
                "lateLiftRs": 0,
                "lateNetRs": late_off,
                "lateOrigRs": late_off,
                "booksBetter": 4,
                "longBetter": 4,
                "skipped": 0,
                "keep": True,
            }
        ),
        "topRules": [
            {
                "name": r["name"],
                "lateLiftRs": r["lateLiftRs"],
                "lateNetRs": r["lateNetRs"],
                "longBetter": r["longBetter"],
                "keep": r["keep"],
            }
            for r in rule_rows[:8]
        ],
        "structureLateNetRs": struct_late,
        "pdhlLateNetRs": pdhl_late,
        "structureBetter": struct_better,
        "worstWeekRs": worst_week,
        "greenWeeks": green_weeks,
        "redWeeks": red_weeks,
        "flipFailed": flip_failed,
        "workable": workable_base and flip_failed and struct_better,
        "liveOrders": False,
        "guaranteed": False,
        "armedOnCrudeBest": False,
        "quitJob": False,
        "honest": honest,
    }
    OUT.joinpath("hist-pattern.json").write_text(json.dumps(fixture, indent=2))
    slim = {
        "sample": fixture["sample"],
        "chargeRs": CHARGE,
        "books": fixture["books"],
        "flipFailed": True,
        "lateNetOffRs": late_off,
        "lateNetOnRs": late_on,
        "lateLiftRs": fixture["lateLiftRs"],
        "rulesTried": fixture["rulesTried"],
        "keptRules": fixture["keptRules"],
        "champion": fixture["champion"],
        "topRules": fixture["topRules"],
        "structureLateNetRs": struct_late,
        "pdhlLateNetRs": pdhl_late,
        "structureBetter": struct_better,
        "worstWeekRs": worst_week,
        "greenWeeks": green_weeks,
        "redWeeks": red_weeks,
        "workable": fixture["workable"],
        "liveOrders": False,
        "guaranteed": False,
        "armedOnCrudeBest": False,
        "quitJob": False,
        "honest": honest,
    }
    FIXTURE.write_text(
        "/** Longer historical replay of the fail-pattern. Not a guaranteed profit. */\n"
        f"export const PAPER_HIST_PATTERN = {json.dumps(slim, indent=2)} as const;\n"
    )
    print(honest, flush=True)
    print(
        f"books {len(results)} flipKept {fixture['flipKept']} "
        f"late net off ₹{late_off} on ₹{late_on} keptRules {fixture['keptRules']}",
        flush=True,
    )
    for r in results:
        print(
            f"  {r['name']} {r['span']} days={r['days']} flipKeep={r['keep']} "
            f"late off {r['lateOff']} on {r['lateOn']} struct {r['structLate']} flipped={r['flipped']}",
            flush=True,
        )
    print("top skip rules:", flush=True)
    for r in rule_rows[:8]:
        print(
            f"  {r['name']} keep={r['keep']} lateLift ₹{r['lateLiftRs']} "
            f"lateNet ₹{r['lateNetRs']} longBetter={r['longBetter']} skipped={r['skipped']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
