#!/usr/bin/env python3
"""
Hunt a Crude-style daily-min book for Nifty, Bank Nifty, and Sensex at ₹14,000.

Futures 1 lot is scored for edge, then rejected: SPAN margin is far above ₹14k.
Cheap CE/PE is the only product that can even open. Premium must stay ≤ ₹3,500
and one stop ≤ ₹420 (3% day-loss). Spot 5m is a delta proxy, not live option prints.

Not a guaranteed profit. Not a live arm.

  python3 scripts/index-14k-daily-min-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from itertools import product
from pathlib import Path

import numpy as np
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / "reports" / "index-14k-daily-min"
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = (
    ROOT
    / "src"
    / "app"
    / "core"
    / "paper-desk"
    / "index-14k-hunt.fixture.ts"
)

CAPITAL = 14_000
PREMIUM_BUDGET = 3_500
DAY_LOSS = 420
INDEX_MIN = 40_000
CHARGE = 50.0
OOS_FROM = "2026-09-15"


def to_min(h, m):
    return h * 60 + m


def week_monday(day: str) -> str:
    dt = datetime.strptime(day, "%Y-%m-%d")
    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")


def load_yahoo(symbol: str, cache_name: str) -> dict | None:
    path = CACHE / f"yahoo-5m-{cache_name}.json"
    rows = []
    if path.exists():
        raw = json.loads(path.read_text())
        rows = raw
    else:
        df = yf.Ticker(symbol).history(period="60d", interval="5m", auto_adjust=False)
        if df is None or df.empty:
            return None
        df = df.tz_convert("Asia/Kolkata")
        for idx, r in df.iterrows():
            rows.append(
                dict(
                    day=idx.strftime("%Y-%m-%d"),
                    min=idx.hour * 60 + idx.minute,
                    open=float(r["Open"]),
                    high=float(r["High"]),
                    low=float(r["Low"]),
                    close=float(r["Close"]),
                )
            )
        path.write_text(json.dumps(rows))
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
    day_hl = {}
    kind = {}
    for d in uniq:
        mask = days == d
        hi, lo = float(h[mask].max()), float(l[mask].min())
        day_hl[d] = (hi, lo)
        sess = mask & (mins >= to_min(9, 15)) & (mins <= to_min(15, 15))
        if sess.sum() < 40:
            kind[d] = "thin"
            continue
        ar = float(h[sess].max() - l[sess].min())
        ao = float(o[sess][0])
        ac = float(c[sess][-1])
        move = ac - ao
        if ar < 40:
            kind[d] = "quiet"
        elif abs(move) < 0.35 * ar:
            kind[d] = "sideways"
        elif move > 0:
            kind[d] = "greenish"
        else:
            kind[d] = "red"
    prev = {}
    for i, d in enumerate(uniq):
        if i:
            prev[d] = day_hl[uniq[i - 1]]
    vwap = np.zeros(len(c))
    cur = None
    pv = 0.0
    nbar = 0
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
        span=f"{uniq[0]} → {uniq[-1]}" if uniq else "",
        bars=len(c),
    )


def session_or(mk, i, or_s, or_e):
    day = mk["days"][i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and mk["days"][j] == day:
        mm = int(mk["mins"][j])
        if or_s <= mm <= or_e:
            hi = max(hi, float(mk["h"][j]))
            lo = min(lo, float(mk["l"][j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def swing_hl(mk, i, lb=6):
    start = max(0, i - lb)
    if start >= i:
        return None, None
    return float(mk["h"][start:i].max()), float(mk["l"][start:i].min())


def signal(mode, mk, i, day, mm, or_s, or_e, or_min, or_max, trap_p, pd_max, vwap_min):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
    up, dn = cc > oo, cc < oo

    def pdhl():
        lv = mk["prev"].get(day)
        if not lv:
            return 0
        pdh, pdl = lv
        if (pdh - pdl) > pd_max:
            return 0
        if cc > pdh and up:
            return 1
        if cc < pdl and dn:
            return -1
        return 0

    def fade():
        if mm <= or_e:
            return 0
        orb = session_or(mk, i, or_s, or_e)
        if not orb:
            return 0
        oh, ol = orb
        w = oh - ol
        if w < or_min or w > or_max:
            return 0
        if hh > oh and cc < oh and dn:
            return -1
        if ll < ol and cc > ol and up:
            return 1
        return 0

    def trap():
        sh, slv = swing_hl(mk, i, 6)
        if sh is None:
            return 0
        if ll < slv - trap_p and cc > slv and up:
            return 1
        if hh > sh + trap_p and cc < sh and dn:
            return -1
        return 0

    def vfade():
        vw = float(mk["vwap"][i])
        dist = cc - vw
        if abs(dist) < vwap_min:
            return 0
        if dist > 0 and dn:
            return -1
        if dist < 0 and up:
            return 1
        return 0

    if mode == "pdhl":
        return pdhl()
    if mode == "fade":
        return fade()
    if mode == "trap":
        return trap()
    if mode == "pdhl_fade":
        return pdhl() or fade()
    if mode == "all_three":
        return pdhl() or fade() or trap()
    if mode == "fade_trap":
        return fade() or trap()
    if mode == "vwap_fade":
        return vfade()
    return 0


def simulate(mk, *, mode, sl, tp, scratch, rs_pt, first_win, max_day, or_s, or_e, entry_s, flat, or_min, or_max, trap_p, pd_max, vwap_min):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    trades = []
    pending = open_t = None
    day_net = 0.0
    trades_today = 0
    won = False
    cur = None

    def close_it(day, pts, reason):
        nonlocal day_net, trades_today, won, open_t
        rupee = pts * rs_pt - CHARGE
        trades.append({"day": day, "pts": pts, "rs": rupee, "reason": reason, "kind": mk["kind"].get(day, "thin")})
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

        stopped = day_net <= -DAY_LOSS or (first_win and won) or trades_today >= max_day

        if open_t is not None:
            d, entry, stop, target, sc = open_t["dir"], open_t["entry"], open_t["stop"], open_t["target"], open_t["scratch"]
            hi, lo, cl = float(h[i]), float(l[i]), float(c[i])
            exit_px = reason = None
            if scratch > 0:
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
                close_it(day, d * (exit_px - entry), reason)
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
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * sl,
                "target": fill + d * tp,
                "scratch": fill - d * scratch if scratch > 0 else None,
            }
            continue

        if not (entry_s <= mm <= to_min(15, 10)):
            continue
        d = signal(mode, mk, i, day, mm, or_s, or_e, or_min, or_max, trap_p, pd_max, vwap_min)
        if d:
            pending = {"dir": d, "sig": float(c[i])}
    return trades


def day_stats(mk, trades):
    tradable = [d for d in mk["uniq"] if mk["kind"].get(d) not in (None, "thin")]
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    nets = [by.get(d, 0.0) for d in tradable]
    weeks = defaultdict(float)
    for d, rs in by.items():
        weeks[week_monday(d)] += rs
    w = list(weeks.values())
    arr = np.array(nets) if nets else np.array([0.0])
    green = int((arr > 0).sum())
    red = int((arr < 0).sum())
    flat = int((np.abs(arr) < 1e-9).sum())
    return {
        "tradable": len(tradable),
        "traded": sum(1 for d in tradable if d in by),
        "n": len(trades),
        "greenDays": green,
        "redDays": red,
        "flatDays": flat,
        "greenPct": round(100.0 * green / len(tradable), 1) if tradable else 0,
        "net": round(float(arr.sum()), 0),
        "avgDay": round(float(arr.mean()), 1) if len(arr) else 0,
        "worstDay": round(float(arr.min()), 0) if len(arr) else 0,
        "bestDay": round(float(arr.max()), 0) if len(arr) else 0,
        "weeks": len(w),
        "greenWeeks": int(sum(1 for x in w if x > 0)),
        "worstWeek": round(min(w), 0) if w else 0,
        "avgWeek": round(float(np.mean(w)), 1) if w else 0,
    }


BOOKS = (
    dict(
        name="nifty",
        label="Nifty 50",
        yahoo="^NSEI",
        cache="nifty",
        lot=65,
        fut_margin=1_60_000,
        fut_rs=65.0,
        or_min=20,
        or_max=180,
        trap_p=12,
        pd_max=500,
        vwap_min=15,
        fut_sl=(20, 30, 40),
        fut_tp=(30, 40, 50),
        opt_prem=50,
        opt_delta=0.2,
        opt_sl=(25, 30),
        opt_tp=(40, 50, 60),
        scratch=(12, 18),
    ),
    dict(
        name="bank",
        label="Bank Nifty",
        yahoo="^NSEBANK",
        cache="bank",
        lot=30,
        fut_margin=2_00_000,
        fut_rs=30.0,
        or_min=40,
        or_max=350,
        trap_p=25,
        pd_max=900,
        vwap_min=30,
        fut_sl=(50, 70, 80),
        fut_tp=(80, 100, 120),
        opt_prem=100,
        opt_delta=0.2,
        opt_sl=(50, 70),
        opt_tp=(80, 110),
        scratch=(25, 40),
    ),
    dict(
        name="sensex",
        label="Sensex",
        yahoo="^BSESN",
        cache="sensex",
        lot=20,
        fut_margin=1_50_000,
        fut_rs=20.0,
        or_min=50,
        or_max=400,
        trap_p=30,
        pd_max=1000,
        vwap_min=35,
        fut_sl=(60, 80, 100),
        fut_tp=(100, 130, 160),
        opt_prem=150,
        opt_delta=0.2,
        opt_sl=(80, 100),
        opt_tp=(130, 160),
        scratch=(40, 60),
    ),
)


def product_gate(book, kind, sl, rs_pt, prem):
    one_stop = sl * rs_pt
    cost = prem * book["lot"] if kind == "CEPE" else book["fut_margin"]
    fits_premium = kind == "CEPE" and cost <= PREMIUM_BUDGET and cost > 0
    fits_stop = one_stop <= DAY_LOSS
    fits_margin = kind == "FUT" and book["fut_margin"] <= CAPITAL
    fits_14k = (fits_premium and fits_stop) if kind == "CEPE" else (fits_margin and fits_stop)
    why = []
    if kind == "FUT" and not fits_margin:
        why.append(f"FUT margin ~₹{book['fut_margin']:,} > ₹{CAPITAL:,}")
    if kind == "CEPE" and cost > PREMIUM_BUDGET:
        why.append(f"premium ₹{cost:,} > budget ₹{PREMIUM_BUDGET:,}")
    if not fits_stop:
        why.append(f"one stop ₹{one_stop:.0f} > day-loss ₹{DAY_LOSS}")
    if not why:
        why.append("opens at ₹14,000")
    return {
        "fits14k": fits_14k,
        "oneStopRs": round(one_stop, 0),
        "openCostRs": cost,
        "why": "; ".join(why),
    }


def main():
    windows = (
        dict(tag="0945-1515", or_s=to_min(9, 15), or_e=to_min(9, 45), entry_s=to_min(9, 45), flat=to_min(15, 15)),
        dict(tag="1015-1515", or_s=to_min(9, 15), or_e=to_min(10, 15), entry_s=to_min(10, 15), flat=to_min(15, 15)),
    )
    modes = ("pdhl", "fade", "trap", "pdhl_fade", "fade_trap", "all_three", "vwap_fade")
    rows = []
    loaded = {}
    for book in BOOKS:
        print(f"loading {book['label']}…", flush=True)
        mk = load_yahoo(book["yahoo"], book["cache"])
        if not mk:
            print(f"  skip {book['label']} — no candles", flush=True)
            continue
        loaded[book["name"]] = mk
        kinds = defaultdict(int)
        for d in mk["uniq"]:
            kinds[mk["kind"].get(d, "thin")] += 1
        print(f"  {mk['span']} bars={mk['bars']} kinds={dict(kinds)}", flush=True)

        # Futures 1 lot — edge only, then capital reject.
        for mode, sl, tp, scratch, win in product(modes, book["fut_sl"], book["fut_tp"], book["scratch"], windows):
            if scratch >= sl or sl >= tp:
                continue
            trades = simulate(
                mk,
                mode=mode,
                sl=sl,
                tp=tp,
                scratch=scratch,
                rs_pt=book["fut_rs"],
                first_win=True,
                max_day=2,
                or_s=win["or_s"],
                or_e=win["or_e"],
                entry_s=win["entry_s"],
                flat=win["flat"],
                or_min=book["or_min"],
                or_max=book["or_max"],
                trap_p=book["trap_p"],
                pd_max=book["pd_max"],
                vwap_min=book["vwap_min"],
            )
            gate = product_gate(book, "FUT", sl, book["fut_rs"], 0)
            st = day_stats(mk, trades)
            rows.append(
                {
                    "book": book["name"],
                    "label": book["label"],
                    "product": "FUT ×1",
                    "mode": mode,
                    "window": win["tag"],
                    "sl": sl,
                    "tp": tp,
                    "scratch": scratch,
                    **gate,
                    **st,
                    "span": mk["span"],
                }
            )

        # Cheap CE/PE proxy that can open at ₹14k.
        rs_pt = book["lot"] * book["opt_delta"]
        prem = book["opt_prem"]
        cost = prem * book["lot"]
        for mode, sl, tp, scratch, win in product(modes, book["opt_sl"], book["opt_tp"], book["scratch"], windows):
            if scratch >= sl or sl >= tp:
                continue
            if sl * rs_pt > DAY_LOSS + 1:
                continue
            trades = simulate(
                mk,
                mode=mode,
                sl=sl,
                tp=tp,
                scratch=scratch,
                rs_pt=rs_pt,
                first_win=True,
                max_day=2,
                or_s=win["or_s"],
                or_e=win["or_e"],
                entry_s=win["entry_s"],
                flat=win["flat"],
                or_min=book["or_min"],
                or_max=book["or_max"],
                trap_p=book["trap_p"],
                pd_max=book["pd_max"],
                vwap_min=book["vwap_min"],
            )
            gate = product_gate(book, "CEPE", sl, rs_pt, prem)
            st = day_stats(mk, trades)
            rows.append(
                {
                    "book": book["name"],
                    "label": book["label"],
                    "product": f"cheap CE/PE ~₹{prem} ×{book['lot']} (δ{book['opt_delta']})",
                    "mode": mode,
                    "window": win["tag"],
                    "sl": sl,
                    "tp": tp,
                    "scratch": scratch,
                    "premiumRs": cost,
                    **gate,
                    **st,
                    "span": mk["span"],
                }
            )

    def viable(r):
        return (
            r["fits14k"]
            and r["tradable"] >= 20
            and r["n"] >= 8
            and r["avgDay"] > 0
            and r["net"] > 0
            and r["worstDay"] >= -DAY_LOSS
            and r["worstWeek"] >= -DAY_LOSS * 3
        )

    champs = {}
    near = {}
    for name in ("nifty", "bank", "sensex"):
        mine = [r for r in rows if r["book"] == name]
        ok = [r for r in mine if viable(r)]
        ok.sort(key=lambda r: (r["greenWeeks"], r["avgWeek"], r["greenPct"], r["avgDay"], r["worstWeek"]), reverse=True)
        rest = [r for r in mine if r["product"].startswith("cheap") and r["n"] >= 8]
        rest.sort(key=lambda r: (r["avgDay"], r["greenPct"], r["worstDay"]), reverse=True)
        champs[name] = ok[0] if ok else None
        near[name] = rest[:3]

    fixture = {
        "capitalRs": CAPITAL,
        "premiumBudgetRs": PREMIUM_BUDGET,
        "dayLossCapRs": DAY_LOSS,
        "indexMinRs": INDEX_MIN,
        "configs": len(rows),
        "honest": (
            "₹14,000 cannot open Nifty / Bank / Sensex futures (margin ₹1.5L–₹2L) "
            "or ATM CE/PE (premium ~₹10k–₹12k). Cheap OTM proxies that fit the "
            "₹3,500 premium budget were hunted on Yahoo 5m spot with a 0.2 delta. "
            "That is not a live option tape. No book is armed. Not a guaranteed profit."
        ),
        "books": {},
    }
    for book in BOOKS:
        name = book["name"]
        mk = loaded.get(name)
        champ = champs.get(name)
        fixture["books"][name] = {
            "label": book["label"],
            "span": mk["span"] if mk else None,
            "bars": mk["bars"] if mk else 0,
            "futMarginRs": book["fut_margin"],
            "atmPremiumRs": 10_000 if name == "nifty" else 12_000 if name == "bank" else 8_000,
            "lot": book["lot"],
            "futAllowed": False,
            "atmAllowed": False,
            "champion": (
                {
                    "product": champ["product"],
                    "mode": champ["mode"],
                    "window": champ["window"],
                    "sl": champ["sl"],
                    "tp": champ["tp"],
                    "scratch": champ["scratch"],
                    "fits14k": champ["fits14k"],
                    "oneStopRs": champ["oneStopRs"],
                    "openCostRs": champ["openCostRs"],
                    "why": champ["why"],
                    "greenDays": champ["greenDays"],
                    "redDays": champ["redDays"],
                    "flatDays": champ["flatDays"],
                    "tradable": champ["tradable"],
                    "greenPct": champ["greenPct"],
                    "net": champ["net"],
                    "avgDay": champ["avgDay"],
                    "worstDay": champ["worstDay"],
                    "greenWeeks": champ["greenWeeks"],
                    "weeks": champ["weeks"],
                    "worstWeek": champ["worstWeek"],
                    "avgWeek": champ["avgWeek"],
                }
                if champ
                else None
            ),
            "nearestCheap": [
                {
                    "mode": r["mode"],
                    "window": r["window"],
                    "sl": r["sl"],
                    "tp": r["tp"],
                    "fits14k": r["fits14k"],
                    "oneStopRs": r["oneStopRs"],
                    "why": r["why"],
                    "net": r["net"],
                    "avgDay": r["avgDay"],
                    "worstDay": r["worstDay"],
                    "greenPct": r["greenPct"],
                    "greenWeeks": r["greenWeeks"],
                    "weeks": r["weeks"],
                    "worstWeek": r["worstWeek"],
                    "n": r["n"],
                }
                for r in near.get(name, [])
            ],
        }

    OUT.joinpath("summary.json").write_text(json.dumps({"fixture": fixture, "top": [champs[k] for k in champs]}, indent=2, default=str))
    ts = (
        "/** ₹14k index hunt. Generated by scripts/index-14k-daily-min-hunt.py.\n"
        " *  Not a live book. Not a guaranteed profit.\n"
        " */\n"
        f"export const INDEX_14K_HUNT = {json.dumps(fixture, indent=2)} as const;\n"
    )
    FIXTURE.write_text(ts)

    lines = [f"configs {len(rows)}  capital ₹{CAPITAL}  premium ≤₹{PREMIUM_BUDGET}  day-loss ₹{DAY_LOSS}", fixture["honest"], ""]
    for name in ("nifty", "bank", "sensex"):
        b = fixture["books"][name]
        lines.append(f"== {b['label']}  {b['span']}  FUT margin ₹{b['futMarginRs']:,}  ATM ~₹{b['atmPremiumRs']:,} ==")
        if b["champion"]:
            c = b["champion"]
            lines.append(
                f"  LIVE-FIT {c['product']} {c['mode']} {c['window']} sl{c['sl']} tp{c['tp']} "
                f"green {c['greenDays']}/{c['tradable']} net ₹{c['net']:.0f} avg ₹{c['avgDay']:.0f} "
                f"worstD ₹{c['worstDay']:.0f} weeks {c['greenWeeks']}/{c['weeks']} worstW ₹{c['worstWeek']:.0f}"
            )
        else:
            lines.append("  LIVE-FIT none — no cheap CE/PE DNA stayed green after ₹50 charges inside the ₹420 stop")
        for r in b["nearestCheap"]:
            lines.append(
                f"  near {r['mode']}|{r['window']}|sl{r['sl']}|tp{r['tp']} "
                f"fit={r['fits14k']} stop₹{r['oneStopRs']:.0f} net ₹{r['net']:.0f} "
                f"avg ₹{r['avgDay']:.0f} worst ₹{r['worstDay']:.0f} g{r['greenPct']}% "
                f"weeks {r['greenWeeks']}/{r['weeks']} n={r['n']} | {r['why']}"
            )
        lines.append("")
    report = "\n".join(lines)
    OUT.joinpath("README.md").write_text("# Index ₹14k daily-min hunt\n\n```\n" + report + "\n```\n")
    print(report, flush=True)


if __name__ == "__main__":
    main()
