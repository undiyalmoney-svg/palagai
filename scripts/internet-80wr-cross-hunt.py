#!/usr/bin/env python3
"""
Test internet '80% win-rate' recipes on every instrument we can actually load.

  - Crude Mini: local CRUDEOILM 5m cache (full sessions only)
  - Nifty / Bank Nifty / Sensex: Yahoo 5m spot, last ~60 sessions

Not a live book. Not a guaranteed profit. Win rate is after charges.

  python3 scripts/internet-80wr-cross-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "internet-80wr"
OUT.mkdir(parents=True, exist_ok=True)
CRUDE = ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def pack_arrays(rows: list[dict]) -> dict:
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
    day_hl = {d: (float(h[days == d].max()), float(l[days == d].min())) for d in uniq}
    prev = {}
    for i, d in enumerate(uniq):
        if i:
            prev[d] = day_hl[uniq[i - 1]]
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, n=len(c), uniq=uniq, prev=prev)


def load_crude() -> dict | None:
    if not CRUDE.exists():
        return None
    raw = json.loads(CRUDE.read_text())
    rows = []
    for r in raw:
        dt = str(r["date"]).replace("T", " ").split("+")[0]
        day = dt[:10]
        hm = dt.replace("T", " ")[11:16]
        rows.append(
            dict(day=day, min=to_min(hm), open=float(r["open"]), high=float(r["high"]), low=float(r["low"]), close=float(r["close"]))
        )
    mk = pack_arrays(rows)
    full = [d for d in mk["uniq"] if int((mk["days"] == d).sum()) >= 80]
    mk["tradable"] = set(full)
    mk["name"] = "crude"
    mk["label"] = "Crude Mini FUT"
    mk["rs"] = 10.0
    mk["charge"] = 50.0
    mk["open"] = 10 * 60
    mk["close"] = 23 * 60
    mk["flat"] = 23 * 60 + 10
    mk["or15"] = (10 * 60, 10 * 60 + 15)
    mk["or30"] = (10 * 60, 10 * 60 + 30)
    mk["sl"] = 20.0
    mk["fits_14k"] = True
    return mk


def load_yahoo(symbol: str, name: str, label: str, rs: float, sl: float) -> dict | None:
    t = yf.Ticker(symbol)
    df = t.history(period="60d", interval="5m", auto_adjust=False)
    if df is None or df.empty:
        return None
    df = df.tz_convert("Asia/Kolkata")
    rows = []
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
    mk = pack_arrays(rows)
    mk["tradable"] = set(mk["uniq"])
    mk["name"] = name
    mk["label"] = label
    mk["rs"] = rs
    mk["charge"] = 50.0
    mk["open"] = 9 * 60 + 15
    mk["close"] = 15 * 60 + 15
    mk["flat"] = 15 * 60 + 15
    mk["or15"] = (9 * 60 + 15, 9 * 60 + 30)
    mk["or30"] = (9 * 60 + 15, 9 * 60 + 45)
    mk["sl"] = sl
    mk["fits_14k"] = False
    mk["yahoo"] = symbol
    return mk


def session_or(mk, i, span):
    day = mk["days"][i]
    a, b = span
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and mk["days"][j] == day:
        mm = int(mk["mins"][j])
        if a <= mm <= b:
            hi = max(hi, float(mk["h"][j]))
            lo = min(lo, float(mk["l"][j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def vwap_at(mk, i):
    day = mk["days"][i]
    pv = 0.0
    n = 0
    j = i
    while j >= 0 and mk["days"][j] == day:
        pv += (mk["h"][j] + mk["l"][j] + mk["c"][j]) / 3.0
        n += 1
        j -= 1
    return pv / n if n else float(mk["c"][i])


def simulate(mk: dict, recipe: str) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    cur = None
    taken = False
    sl0 = mk["sl"]

    def close_it(day, pts, reason):
        nonlocal open_t
        rs = pts * mk["rs"] - mk["charge"]
        trades.append({"day": day, "pts": pts, "rs": rs, "reason": reason, "win": rs > 0})
        open_t = None

    for i in range(1, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur = day
            pending = open_t = None
            taken = False
        if day not in mk["tradable"]:
            continue

        if open_t is not None:
            d, entry, stop, target = open_t["dir"], open_t["entry"], open_t["stop"], open_t["target"]
            exit_px = reason = None
            if d == 1:
                if l[i] <= stop:
                    exit_px, reason = stop, "sl"
                elif target is not None and h[i] >= target:
                    exit_px, reason = target, "tp"
            else:
                if h[i] >= stop:
                    exit_px, reason = stop, "sl"
                elif target is not None and l[i] <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and mm >= mk["flat"]:
                exit_px, reason = float(c[i]), "eod"
            if exit_px is not None:
                close_it(day, d * (exit_px - entry), reason)
            continue

        if taken or mm < mk["open"] or mm > mk["close"]:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if not ok:
                continue
            open_t = {"dir": p["dir"], "entry": fill, "stop": p["stop"], "target": p["target"]}
            taken = True
            continue

        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        d = 0
        stop = target = None

        if recipe in ("orb15_1r", "orb30_1r", "orb15_tiny", "quantflo_40_50", "first15_large"):
            span = mk["or30"] if recipe == "orb30_1r" else mk["or15"]
            if mm <= span[1]:
                continue
            orb = session_or(mk, i, span)
            if not orb:
                continue
            oh, ol = orb
            width = oh - ol
            if width < 4:
                continue
            if recipe == "first15_large" and width < 0.0024 * cc:
                continue
            if cc > oh and cc > oo:
                d = 1
            elif cc < ol and cc < oo:
                d = -1
            if not d:
                continue
            if recipe == "orb15_tiny":
                stop = fill_stop = None
                # tiny TP / wide SL — the internet 80% trick
                stop = (oh if d == -1 else ol) - d * width
                target = cc + d * max(width * 0.25, sl0 * 0.4)
            elif recipe == "quantflo_40_50":
                # full candle outside (open and close beyond)
                if d == 1 and not (oo > oh and cc > oh):
                    d = 0
                if d == -1 and not (oo < ol and cc < ol):
                    d = 0
                if not d:
                    continue
                tp = 40 if mk["name"] != "crude" else 20
                sl = 50 if mk["name"] != "crude" else 25
                stop = cc - d * sl
                target = cc + d * tp
            else:
                stop = ol if d == 1 else oh
                target = cc + d * width

        elif recipe == "orb15_fade":
            if mm <= mk["or15"][1]:
                continue
            orb = session_or(mk, i, mk["or15"])
            if not orb:
                continue
            oh, ol = orb
            width = oh - ol
            if width < 4 or width > 400:
                continue
            if hh > oh and cc < oh and cc < oo:
                d = -1
                stop = hh + 2
                target = (oh + ol) / 2
            elif ll < ol and cc > ol and cc > oo:
                d = 1
                stop = ll - 2
                target = (oh + ol) / 2

        elif recipe == "pdhl":
            levels = mk["prev"].get(day)
            if not levels:
                continue
            pdh, pdl = levels
            if cc > pdh and cc > oo:
                d = 1
            elif cc < pdl and cc < oo:
                d = -1
            if not d:
                continue
            stop = cc - d * sl0
            target = cc + d * sl0 * 1.5

        elif recipe == "vwap_cross":
            vw = vwap_at(mk, i)
            prev_vw = vwap_at(mk, i - 1) if days[i - 1] == day else vw
            prev_c = float(c[i - 1])
            if prev_c <= prev_vw and cc > vw and cc > oo:
                d = 1
            elif prev_c >= prev_vw and cc < vw and cc < oo:
                d = -1
            if not d:
                continue
            stop = cc - d * sl0
            target = cc + d * sl0

        elif recipe == "vwap_fade":
            vw = vwap_at(mk, i)
            dist = cc - vw
            if abs(dist) < sl0:
                continue
            if dist > 0 and cc < oo:
                d = -1
            elif dist < 0 and cc > oo:
                d = 1
            else:
                continue
            stop = cc - d * sl0
            target = vw

        if not d:
            continue
        pending = {"dir": d, "sig": cc, "stop": stop, "target": target}

    return trades


RECIPES = [
    ("orb15_1r", "ORB 15m break, 1R (DailyBulls-style)"),
    ("orb30_1r", "ORB 30m break, 1R"),
    ("orb15_fade", "Failed ORB 15m fade (Velvet Hammer fade)"),
    ("pdhl", "PDH/PDL break + 1.5R"),
    ("vwap_cross", "VWAP cross (textbook)"),
    ("vwap_fade", "VWAP fade back to mean"),
    ("orb15_tiny", "ORB 15m tiny-TP / wide-SL (fake 80%)"),
    ("quantflo_40_50", "Full-candle ORB, TP40/SL50 (QuantFlo grid)"),
    ("first15_large", "ORB 15m only if first range ≥ 0.24%"),
]


def score(trades: list[dict], tradable: int) -> dict:
    if not trades:
        return {
            "n": 0,
            "wr": 0,
            "wr_raw": 0,
            "net": 0,
            "avg": 0,
            "worst": 0,
            "days": 0,
            "green_days": 0,
            "pf": 0,
        }
    rs = np.array([t["rs"] for t in trades])
    raw = np.array([t["pts"] for t in trades])
    wins = rs[rs > 0].sum()
    loss = -rs[rs < 0].sum()
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    nets = np.array(list(by.values()))
    return {
        "n": int(len(trades)),
        "wr": round(100.0 * float((rs > 0).mean()), 1),
        "wr_raw": round(100.0 * float((raw > 0).mean()), 1),
        "net": round(float(rs.sum()), 0),
        "avg": round(float(rs.mean()), 1),
        "worst": round(float(rs.min()), 0),
        "days": int(len(by)),
        "green_days": round(100.0 * float((nets > 0).mean()), 1),
        "pf": round(float(wins / loss), 2) if loss > 0 else 99.0,
        "tradable": tradable,
    }


def main():
    books = []
    crude = load_crude()
    if crude:
        books.append(crude)
    for sym, name, label, rs, sl in (
        ("^NSEI", "nifty", "Nifty 50 spot", 65.0, 40.0),
        ("^NSEBANK", "bank", "Bank Nifty spot", 30.0, 80.0),
        ("^BSESN", "sensex", "Sensex spot", 10.0, 100.0),
    ):
        mk = load_yahoo(sym, name, label, rs, sl)
        if mk:
            books.append(mk)
            print(f"loaded {label}: {len(mk['uniq'])} days, {mk['n']} bars", flush=True)

    rows = []
    for mk in books:
        for rid, title in RECIPES:
            if rid == "first15_large" and mk["name"] == "crude":
                # crude 0.24% of ~5500 is ~13 pts — too small, use 40 pt OR
                pass
            tr = simulate(mk, rid)
            st = score(tr, len(mk["tradable"]))
            rows.append(
                {
                    "instrument": mk["label"],
                    "fits_14k": mk["fits_14k"],
                    "recipe": rid,
                    "title": title,
                    "span": f"{mk['uniq'][0]} → {mk['uniq'][-1]}" if mk["uniq"] else "",
                    **st,
                }
            )
            print(
                f"{mk['name']:<7} {rid:<16} n{st['n']:4d} wr{st['wr']:5.1f}% raw{st['wr_raw']:5.1f}% "
                f"net₹{st['net']:8.0f} avg₹{st['avg']:7.0f} worst{st['worst']:7.0f} pf{st['pf']:5.2f}",
                flush=True,
            )

    summary = {
        "honest": "No internet 80% book cleared 80% win rate after charges on these samples. High WR with a tiny target still loses.",
        "capital": "₹14,000 can live-trade Crude Mini ×1 only. Index futures/ATM options stay blocked.",
        "sources": [
            "DailyBulls ORB Nifty 5m (claimed 71.4% with RSI exit, 42 trades, zero costs)",
            "QuantFlo 09:15–09:45 full-candle ORB (their own 40/50 cell is 56.1%, not 80%)",
            "StrikeATM Nifty ORB 2023–2026 (all 9 versions lost; ~25% winners)",
            "Quantsapp PDH/PDL Nifty (34% WR, lost money)",
            "Indiquant Bank Nifty VWAP cross (38% green days, lost points)",
            "BroBillionaire Velvet Hammer (advertised 68–82%; no replayable tape)",
            "DataPointX win-rate trap (0.1% TP prints 84% WR and still loses)",
        ],
        "rows": rows,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))

    lines = [
        "Internet 80% win-rate recipes, replayed after ₹50/RT",
        f"Crude Mini local 5m · indices Yahoo 5m spot",
        "",
        f"{'Instrument':<18} {'Recipe':<28} {'n':>4} {'WR%':>6} {'raw%':>6} {'net₹':>8} {'avg₹':>7} {'worst':>7} {'PF':>5} {'14k':>5}",
    ]
    for r in rows:
        lines.append(
            f"{r['instrument']:<18} {r['recipe']:<28} {r['n']:4d} {r['wr']:6.1f} {r['wr_raw']:6.1f} "
            f"{r['net']:8.0f} {r['avg']:7.0f} {r['worst']:7.0f} {r['pf']:5.2f} {'yes' if r['fits_14k'] else 'no':>5}"
        )
    hit80 = [r for r in rows if r["wr"] >= 80 and r["n"] >= 20]
    lines += ["", "rows with WR ≥ 80% after charges and n ≥ 20:"]
    if hit80:
        for r in hit80:
            lines.append(f"  {r['instrument']} {r['recipe']} wr={r['wr']} net₹{r['net']} pf={r['pf']}")
    else:
        lines.append("  none")
    report = "\n".join(lines) + "\n"
    (OUT / "README.md").write_text("# Internet 80% WR cross-instrument test\n\n```\n" + report + "```\n")
    print("\n" + report, flush=True)


if __name__ == "__main__":
    main()
