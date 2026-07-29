#!/usr/bin/env python3
"""
Crude peer hunt — Champion / Daily Income / Trap-Confirm + loss cutoffs.

Data preference:
  1) reports/analyst-cache/crudeoilm-5m-merged.json  (real MCX)
  2) Yahoo CL=F × 85 (synthetic MCX-ish INR pts) — exploratory only

Usage:
  python3 scripts/crude-trap-loss-cutoff-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "crude-trap-loss-cutoff"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
EXIT_M = 23 * 60 + 10
CL_SCALE = 85.0  # rough USD→INR crude scale for proxy


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load_rows(rows: list[dict]) -> dict:
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"]).replace("T", " ")[11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    if len(c) >= 50:
        ema[49] = float(c[:50].mean())
        for i in range(50, len(c)):
            ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c))


def fetch_cl_proxy() -> list[dict]:
    url = "https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=5m&range=60d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.load(r)
    res = data["chart"]["result"][0]
    ts = res["timestamp"]
    q = res["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(ts):
        if q["close"][i] is None:
            continue
        ist = datetime.fromtimestamp(t, tz=timezone.utc) + timedelta(hours=5, minutes=30)
        rows.append(
            {
                "date": ist.strftime("%Y-%m-%d %H:%M:%S"),
                "open": float(q["open"][i]) * CL_SCALE,
                "high": float(q["high"][i]) * CL_SCALE,
                "low": float(q["low"][i]) * CL_SCALE,
                "close": float(q["close"][i]) * CL_SCALE,
            }
        )
    path = CACHE / "crude_cl_proxy_5m.json"
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def resolve_data() -> tuple[dict, str, str]:
    mcx = CACHE / "crudeoilm-5m-merged.json"
    if mcx.exists():
        rows = json.loads(mcx.read_text())
        # normalize date
        for r in rows:
            r["date"] = str(r["date"]).replace("T", " ").split("+")[0]
        return load_rows(rows), "mcx_kite", str(rows[0]["date"])[:10]
    rows = fetch_cl_proxy()
    return load_rows(rows), "cl_yahoo_x85", str(rows[0]["date"])[:10]


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


def prev_day_hl(days, h, l, i):
    day = days[i]
    prev = None
    j = i - 1
    while j >= 0:
        if days[j] < day:
            prev = days[j]
            break
        j -= 1
    if prev is None:
        return None
    pdh, pdl = -1e18, 1e18
    k = i - 1
    while k >= 0 and days[k] >= prev:
        if days[k] == prev:
            pdh = max(pdh, float(h[k]))
            pdl = min(pdl, float(l[k]))
        k -= 1
    if pdh < -1e17:
        return None
    return pdh, pdl


def orb_hl(days, mins, h, l, i, or_s, or_e):
    day = days[i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and days[j] == day:
        mm = int(mins[j])
        if or_s <= mm <= or_e:
            hi = max(hi, float(h[j]))
            lo = min(lo, float(l[j]))
        j -= 1
    if hi < -1e17:
        return None
    return hi, lo


def simulate(
    mk: dict,
    *,
    mode: str,
    stop: float,
    tp_m: float,
    tp_e: float,
    rr: float,
    day_loss: float,
    day_lock: float,
    max_day: int,
    peak: tuple[float, float, float] | None,
    soft: tuple[float, float, float] | None,
    entry_s: int,
    entry_e: int,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    trades_today = 0
    cur = None

    for i in range(50, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur = day
            day_net = 0.0
            trades_today = 0
            pending = None
            open_t = None

        stopped = day_net <= -day_loss or (day_lock > 0 and day_net >= day_lock)

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop_px = open_t["stop"]
            target = open_t["target"]
            risk0 = open_t["risk"]
            fav = (h[i] - entry) if d == 1 else (entry - l[i])
            adv = (entry - l[i]) if d == 1 else (h[i] - entry)
            open_t["mfe"] = max(open_t["mfe"], max(0.0, float(fav)))
            open_t["mae"] = max(open_t["mae"], max(0.0, float(adv)))
            mfe, mae = open_t["mfe"], open_t["mae"]

            if peak:
                arm_rs, lock_rs, gb_rs = peak
                peak_rs = mfe * RS
                if peak_rs >= arm_rs:
                    floor = max(lock_rs, peak_rs - gb_rs) / RS
                    lock_stop = entry + d * floor
                    if d == 1 and lock_stop > stop_px:
                        stop_px = lock_stop
                    elif d == -1 and lock_stop < stop_px:
                        stop_px = lock_stop
                    open_t["stop"] = stop_px

            exit_px = reason = None
            if soft and risk0 > 0:
                frac, soft_rs, max_mfe = soft
                against = (c[i] < entry) if d == 1 else (c[i] > entry)
                conf = (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                if mfe < max_mfe * risk0 and against and conf:
                    if mae >= frac * risk0 or mae * RS >= soft_rs:
                        exit_px, reason = float(c[i]), "cutoff_soft"
            if exit_px is None:
                if d == 1:
                    if l[i] <= stop_px:
                        exit_px, reason = stop_px, ("peak_trail" if peak and mfe * RS >= peak[0] and stop_px > entry else "sl")
                    elif h[i] >= target:
                        exit_px, reason = target, "tp"
                else:
                    if h[i] >= stop_px:
                        exit_px, reason = stop_px, ("peak_trail" if peak and mfe * RS >= peak[0] and stop_px < entry else "sl")
                    elif l[i] <= target:
                        exit_px, reason = target, "tp"
                if exit_px is None and mm >= EXIT_M:
                    exit_px, reason = float(c[i]), "eod"
            if exit_px is not None:
                pts = d * (exit_px - entry)
                trades.append({"day": day, "pts": pts, "rs": pts * RS, "reason": reason})
                day_net += pts
                trades_today += 1
                open_t = None
            continue

        if stopped or trades_today >= max_day:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            stop_px = float(p["stop"])
            if p["dir"] == 1:
                stop_px = min(stop_px, fill - 1)
            else:
                stop_px = max(stop_px, fill + 1)
            risk = abs(fill - stop_px)
            if mode == "trap":
                if risk < 15 or risk > 120:
                    continue
                target = fill + p["dir"] * risk * rr
            else:
                risk = stop
                stop_px = fill - p["dir"] * stop
                target = fill + p["dir"] * p["tp"]
            open_t = {"dir": p["dir"], "entry": fill, "stop": stop_px, "target": target, "risk": risk, "mfe": 0.0, "mae": 0.0}
            continue

        if not (entry_s <= mm <= entry_e):
            continue

        if mode == "trap":
            if ema[i] != ema[i]:
                continue
            j0 = i
            while j0 > 0 and days[j0 - 1] == day:
                j0 -= 1
            if i - j0 < 5:
                continue
            sh, slv = swing_hl(h, l, i, 5)
            pierce, pad = 8.0, 2.0
            cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
            trap_buy = ll < slv - pierce and cc > slv and cc > oo
            trap_sell = hh > sh + pierce and cc < sh and cc < oo
            rng = max(hh - ll, 1e-9)
            bounce_buy = ll <= slv + pierce and ll >= slv - pierce * 2 and cc > oo and cc >= slv and (hh - cc) / rng < 0.35
            bounce_sell = hh >= sh - pierce and hh <= sh + pierce * 2 and cc < oo and cc <= sh and (cc - ll) / rng < 0.35
            d = 0
            stop_px = 0.0
            if (trap_buy or bounce_buy) and cc > ema[i]:
                d, stop_px = 1, ll - pad
            elif (trap_sell or bounce_sell) and cc < ema[i]:
                d, stop_px = -1, hh + pad
            if not d:
                continue
            pending = {"dir": d, "stop": stop_px, "tp": 0.0}
            continue

        # morning ORB / evening PDHL (same-bar entry like crude evaluators)
        d = 0
        tp = tp_e
        if mode == "morning":
            orb = orb_hl(days, mins, h, l, i, 9 * 60, 10 * 60)
            if not orb:
                continue
            oh, ol = orb
            if oh - ol > 120:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > oh and cc > oo:
                d = 1
            elif cc < ol and cc < oo:
                d = -1
            tp = tp_m
        else:  # evening pdhl
            levels = prev_day_hl(days, h, l, i)
            if not levels:
                continue
            pdh, pdl = levels
            cc, oo = float(c[i]), float(o[i])
            if cc > pdh and cc > oo:
                d = 1
            elif cc < pdl and cc < oo:
                d = -1
            tp = tp_e
        if not d:
            continue
        fill = float(c[i])
        stop_px = fill - d * stop
        target = fill + d * tp
        open_t = {"dir": d, "entry": fill, "stop": stop_px, "target": target, "risk": stop, "mfe": 0.0, "mae": 0.0}

    return trades


def summarize(trades: list[dict], label: str) -> dict:
    if not trades:
        return {"label": label, "n": 0, "net": 0, "avg_day": 0, "green": 0, "red": 0, "pf": 0}
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    nets = np.array(list(by.values()))
    rs = np.array([t["rs"] for t in trades])
    wins = float(rs[rs > 0].sum())
    loss = float(-rs[rs < 0].sum())
    pf = wins / loss if loss > 0 else 99.0
    traded = nets[np.abs(nets) > 1e-9]
    green = float((traded > 0).mean()) if len(traded) else 0.0
    red = float((traded < 0).mean()) if len(traded) else 0.0
    big = [t for t in trades if t["rs"] <= -800]
    return {
        "label": label,
        "n": len(trades),
        "days": len(by),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "red": round(red * 100, 1),
        "pf": round(pf, 2),
        "avg_loss": round(float(rs[rs < 0].mean()), 0) if (rs < 0).any() else 0,
        "worst_day": round(float(nets.min()), 0),
        "big_loss_n": len(big),
        "cuts": sum(1 for t in trades if str(t.get("reason", "")).startswith("cutoff")),
        "trails": sum(1 for t in trades if t.get("reason") == "peak_trail"),
    }


def combine_pair(m_trades, e_trades):
    return m_trades + e_trades


def main():
    mk, source, oos_from = resolve_data()
    PEAK = (600.0, 300.0, 300.0)
    SOFT = (0.55, 700.0, 0.75)

    books = []

    # Champion pair bare
    champ_m = simulate(mk, mode="morning", stop=80, tp_m=250, tp_e=150, rr=0, day_loss=240, day_lock=0, max_day=1, peak=None, soft=None, entry_s=10*60, entry_e=12*60)
    champ_e = simulate(mk, mode="evening", stop=80, tp_m=250, tp_e=150, rr=0, day_loss=240, day_lock=0, max_day=1, peak=None, soft=None, entry_s=18*60+30, entry_e=20*60+30)
    books.append(("champion_bare", combine_pair(champ_m, champ_e)))

    # Champion + protect + dayloss 250
    champ_m2 = simulate(mk, mode="morning", stop=80, tp_m=250, tp_e=150, rr=0, day_loss=250, day_lock=0, max_day=1, peak=PEAK, soft=SOFT, entry_s=10*60, entry_e=12*60)
    champ_e2 = simulate(mk, mode="evening", stop=80, tp_m=250, tp_e=150, rr=0, day_loss=250, day_lock=0, max_day=1, peak=PEAK, soft=SOFT, entry_s=18*60+30, entry_e=20*60+30)
    books.append(("champion_protect_day250", combine_pair(champ_m2, champ_e2)))

    # Daily income
    di_m = simulate(mk, mode="morning", stop=40, tp_m=80, tp_e=50, rr=0, day_loss=50, day_lock=100, max_day=1, peak=PEAK, soft=SOFT, entry_s=10*60, entry_e=12*60)
    di_e = simulate(mk, mode="evening", stop=40, tp_m=80, tp_e=50, rr=0, day_loss=50, day_lock=100, max_day=1, peak=PEAK, soft=SOFT, entry_s=18*60+30, entry_e=20*60+30)
    books.append(("daily_income_protect", combine_pair(di_m, di_e)))

    # Trap bare / protect
    books.append(("trap_bare", simulate(mk, mode="trap", stop=0, tp_m=0, tp_e=0, rr=3.5, day_loss=240, day_lock=0, max_day=3, peak=None, soft=None, entry_s=10*60, entry_e=22*60)))
    books.append(("trap_protect_day250", simulate(mk, mode="trap", stop=0, tp_m=0, tp_e=0, rr=3.5, day_loss=250, day_lock=0, max_day=3, peak=PEAK, soft=SOFT, entry_s=10*60, entry_e=22*60)))
    books.append(("trap_protect_day150_lock100", simulate(mk, mode="trap", stop=0, tp_m=0, tp_e=0, rr=2.0, day_loss=150, day_lock=100, max_day=2, peak=PEAK, soft=SOFT, entry_s=10*60, entry_e=22*60)))

    rows = [summarize(tr, name) for name, tr in books]
    best = max(rows, key=lambda r: (r["avg_day"], r["green"], r["pf"]))
    summary = {
        "source": source,
        "oos_from": oos_from,
        "bars": int(mk["n"]),
        "note": "CL×85 is exploratory proxy — prefer crudeoilm-5m-merged.json when Kite auth available",
        "table": rows,
        "best": best,
        "wired_recommendation": {
            "default_profile": "trap-confirm" if best["label"].startswith("trap_") else "daily-income",
            "protect": {"armRs": 600, "lockRs": 300, "givebackRs": 300, "softRs": 700, "fracR": 0.55, "maxMfeR": 0.75},
            "dayLossPts": 250 if "trap" in best["label"] else 50,
        },
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    lines = [f"{'book':<32} {'net':>8} {'₹/day':>7} {'g%':>5} {'r%':>5} {'pf':>5} {'bigN':>4} {'worst':>7}"]
    for r in rows:
        lines.append(
            f"{r['label']:<32} {r['net']:8.0f} {r['avg_day']:7.0f} {r['green']:4.1f}% {r['red']:4.1f}% {r['pf']:5.2f} {r.get('big_loss_n',0):4d} {r.get('worst_day',0):7.0f}"
        )
    report = f"# Crude Trap / loss-cutoff hunt\n\nSource **{source}** from {oos_from}\n\n```\n" + "\n".join(lines) + f"\n```\n\nBest: **{best['label']}** · ₹{best['avg_day']}/day\n"
    (OUT / "README.md").write_text(report)
    print(report)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
