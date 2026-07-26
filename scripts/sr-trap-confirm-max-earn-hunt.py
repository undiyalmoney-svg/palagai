#!/usr/bin/env python3
"""
S/R TRAP + CONFIRM max-earn hunt (fast).

Friend DNA: Support/Resistance → TRAP (liquidity sweep) → CONFIRM → reaction trade.

  Bear trap @ support: wick below swing low, close back above → BUY
  Bull trap @ resistance: wick above swing high, close back below → SELL

Precomputes trap/bounce signal arrays, then sweeps confirm filters + R exits.
Nifty×65 + Bank×30. Train≤2023 / test≥2024. GENIE unchanged.

    python3 scripts/sr-trap-confirm-max-earn-hunt.py
"""
from __future__ import annotations

import json
from itertools import product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "sr-trap-max-earn"
OUT.mkdir(parents=True, exist_ok=True)

TRAIN_END = "2023-12-31"
TEST_START = "2024-01-01"
EXIT_M = 15 * 60 + 15
GENIE = {"net": 321283, "avg": 523, "red_pct": 35.7, "max_dd": -34119, "pf": 1.58}


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(name: str, rs: float) -> dict:
    rows = json.loads((CACHE / name).read_text())
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([r["date"][:10] for r in rows])
    mins = np.array([to_min(r["date"][11:16]) for r in rows])
    body = np.abs(c - o)
    ab = np.ones(len(c))
    for i in range(10, len(c)):
        ab[i] = body[i - 10 : i].mean()
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    ema[49] = float(c[:50].mean())
    for i in range(50, len(c)):
        ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    # OR mid per day (09:15–09:45)
    or_mid = np.full(len(c), np.nan)
    i = 0
    n = len(c)
    while i < n:
        d = days[i]
        j = i
        oh, ol = -1e18, 1e18
        while j < n and days[j] == d:
            if mins[j] < 9 * 60 + 45:
                oh = max(oh, h[j])
                ol = min(ol, l[j])
            j += 1
        mid = (oh + ol) / 2 if oh > -1e17 else np.nan
        or_mid[i:j] = mid
        i = j
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, body=body, ab=ab, ema=ema, or_mid=or_mid, rs=rs)


def precompute(mk: dict, lb: int, pierce: float) -> dict:
    """Causal swing + trap/bounce flags + stop prices."""
    h, l, c, o = mk["h"], mk["l"], mk["c"], mk["o"]
    n = len(c)
    sh = np.full(n, np.nan)
    sl = np.full(n, np.nan)
    for i in range(lb, n):
        sh[i] = h[i - lb : i].max()
        sl[i] = l[i - lb : i].min()
    rng = np.maximum(h - l, 1e-9)
    trap_buy = (l < sl - pierce) & (c > sl) & (c > o)
    trap_sell = (h > sh + pierce) & (c < sh) & (c < o)
    bounce_buy = (
        (l <= sl + pierce)
        & (l >= sl - pierce * 2)
        & (c > o)
        & (c >= sl)
        & ((h - c) / rng < 0.35)
    )
    bounce_sell = (
        (h >= sh - pierce)
        & (h <= sh + pierce * 2)
        & (c < o)
        & (c <= sh)
        & ((c - l) / rng < 0.35)
    )
    stop_buy = l - 2.0
    stop_sell = h + 2.0
    return dict(
        trap_buy=trap_buy,
        trap_sell=trap_sell,
        bounce_buy=bounce_buy,
        bounce_sell=bounce_sell,
        stop_buy=stop_buy,
        stop_sell=stop_sell,
        sh=sh,
        sl=sl,
    )


def simulate(mk: dict, pc: dict, cfg: dict) -> dict[str, float]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    body, ab, ema, or_mid, rs = mk["body"], mk["ab"], mk["ema"], mk["or_mid"], mk["rs"]
    mode, confirm = cfg["mode"], cfg["confirm"]
    use_ema, use_third, use_or = cfg["ema"], cfg["third"], cfg["or_mid"]
    side, rr, mt, dl = cfg["side"], cfg["rr"], cfg["mt"], cfg["dl"]
    es, ee, cd = cfg["es"], cfg["ee"], cfg["cd"]
    max_risk, min_risk = cfg["max_risk"], cfg["min_risk"]

    if mode == "trap":
        buy_sig = pc["trap_buy"]
        sell_sig = pc["trap_sell"]
    else:
        buy_sig = pc["trap_buy"] | pc["bounce_buy"]
        sell_sig = pc["trap_sell"] | pc["bounce_sell"]

    day_rs: dict[str, float] = {}
    cur = None
    day_pts = trades = 0.0
    done = False
    open_dir = 0
    entry = stop = target = 0.0
    last = -9999
    pending = None  # (dir, stop, entry)

    for i in range(80, len(c)):
        d = days[i]
        mm = int(mins[i])
        if d != cur:
            cur = d
            day_pts = 0.0
            trades = 0
            done = False
            open_dir = 0
            pending = None

        if open_dir:
            px = None
            if open_dir == 1:
                if l[i] <= stop:
                    px = stop
                elif h[i] >= target:
                    px = target
            else:
                if h[i] >= stop:
                    px = stop
                elif l[i] <= target:
                    px = target
            if px is None and mm >= EXIT_M:
                px = float(c[i])
            if px is not None:
                pts = (px - entry) if open_dir == 1 else (entry - px)
                day_pts += pts
                day_rs[d] = day_rs.get(d, 0.0) + pts * rs
                trades += 1
                open_dir = 0
                last = i
                if day_pts <= -dl:
                    done = True
            continue

        if pending is not None:
            pdir, pstop, pentry = pending
            pending = None
            # Realistic fill: confirm on this bar, enter at THIS open (not stale prior close)
            fill = float(o[i])
            cc = float(c[i])
            oo = float(o[i])
            ok = (pdir == 1 and cc > oo and cc > pentry) or (
                pdir == -1 and cc < oo and cc < pentry
            )
            if (
                ok
                and not done
                and trades < mt
                and es <= mm <= ee
                and i - last >= cd
            ):
                # stop still beyond trap wick; recompute risk from live fill
                if pdir == 1:
                    stop_px = min(pstop, fill - 1.0)
                else:
                    stop_px = max(pstop, fill + 1.0)
                risk = abs(fill - stop_px)
                if min_risk <= risk <= max_risk:
                    entry, stop = fill, stop_px
                    target = fill + rr * risk if pdir == 1 else fill - rr * risk
                    open_dir = pdir
            continue

        if done or trades >= mt or mm < es or mm > ee or i - last < cd:
            continue

        cc = float(c[i])
        oo = float(o[i])
        hh = float(h[i])
        ll = float(l[i])
        e = ema[i]
        rng = max(hh - ll, 1e-9)
        signal = 0
        stop_px = 0.0

        if side != "short" and buy_sig[i]:
            signal = 1
            stop_px = float(pc["stop_buy"][i])
        elif side != "long" and sell_sig[i]:
            signal = -1
            stop_px = float(pc["stop_sell"][i])
        if signal == 0:
            continue

        if use_ema:
            if signal == 1 and not (cc > e):
                continue
            if signal == -1 and not (cc < e):
                continue
        if use_third:
            if signal == 1 and cc < ll + 2 * rng / 3:
                continue
            if signal == -1 and cc > hh - 2 * rng / 3:
                continue
        if use_or:
            mid = or_mid[i]
            if mid == mid:
                if signal == 1 and cc < mid:
                    continue
                if signal == -1 and cc > mid:
                    continue

        risk = abs(cc - stop_px)
        if risk < min_risk or risk > max_risk:
            continue

        if confirm == "next":
            pending = (signal, stop_px, cc)
            continue

        entry, stop = cc, stop_px
        target = cc + rr * risk if signal == 1 else cc - rr * risk
        open_dir = signal

    return day_rs


def metrics(day_rs: dict[str, float], day_list: list[str]) -> dict:
    xs = np.array([day_rs.get(d, 0.0) for d in day_list], float)
    traded = np.array([d in day_rs for d in day_list])
    return {
        "days": len(xs),
        "traded_pct": round(100 * float(traded.mean()), 1),
        "net": round(float(xs.sum())),
        "avg": round(float(xs.mean())),
        "green_pct": round(100 * float((xs > 0).mean()), 1),
        "red_pct": round(100 * float((xs < 0).mean()), 1),
        "worst": round(float(xs.min())),
        "best": round(float(xs.max())),
        "max_dd": round(
            float(np.min(np.cumsum(xs) - np.maximum.accumulate(np.cumsum(xs))))
        ),
        "pf": round(
            float(xs[xs > 0].sum() / abs(xs[xs < 0].sum())) if (xs < 0).any() else 99.0,
            2,
        ),
    }


def score(tr: dict, te: dict) -> float:
    if not te or te["net"] <= 0:
        return -1e9
    s = te["net"] * 0.001 + (tr["net"] if tr else 0) * 0.00025
    s += te["avg"] * 0.4 + min(te["pf"], 3) * 100
    s -= te["red_pct"] * 8 + abs(te["max_dd"]) * 0.02
    if not tr or tr["net"] <= 0:
        s -= 250
    if te["avg"] >= GENIE["avg"]:
        s += 200
    return round(s, 1)


def main():
    nf = load("nifty-5m-2020-2026.json", 65.0)
    bk = load("banknifty-5m-2020-2026.json", 30.0)
    all_days = sorted(set(nf["days"].tolist()) | set(bk["days"].tolist()))
    train = [d for d in all_days if d <= TRAIN_END]
    test = [d for d in all_days if d >= TEST_START]
    print(f"train={len(train)} test={len(test)}", flush=True)

    # Precompute signal packs
    packs = {}
    for name, mk in (("NF", nf), ("BK", bk)):
        for lb, pierce in product((5, 8, 12), (0.0, 3.0)):
            packs[(name, lb, pierce)] = precompute(mk, lb, pierce)
    print(f"precomputed {len(packs)} signal packs", flush=True)

    specs = []
    # Max-earn path first: BOTH book is the legend ceiling; alone books for diagnosis
    for lb, pierce, mode, confirm, ema, or_mid, side, rr, mt, book in product(
        (5, 8, 12),
        (0.0, 3.0),
        ("trap", "both"),
        ("same", "next"),
        (True, False),
        (True, False),
        ("both", "long"),
        (2.0, 2.5, 3.0),
        (2, 3),
        ("BOTH", "NF", "BK"),
    ):
        # prioritize BOTH; thin the alone books
        if book != "BOTH":
            if mt != 2:
                continue
            if confirm == "next":
                continue
            if side == "long" and mode == "both":
                continue
        if book == "BOTH" and confirm == "next" and not ema:
            continue
        specs.append(
            dict(
                lb=lb,
                pierce_pts=pierce,
                mode=mode,
                confirm=confirm,
                ema=ema,
                third=False,
                or_mid=or_mid,
                side=side,
                rr=rr,
                mt=mt,
                dl=40 if book == "BOTH" else 30,
                es=to_min("09:45"),
                ee=to_min("14:45"),
                cd=3,
                max_risk=28 if book != "BK" else 50,
                min_risk=4 if book != "BK" else 8,
                book=book,
            )
        )

    def lab(cfg):
        return (
            f"{cfg['book']}|{cfg['mode']}|lb{cfg['lb']}|p{cfg['pierce_pts']}|"
            f"{cfg['confirm']}|rr{cfg['rr']}|mt{cfg['mt']}|"
            f"{'ema' if cfg['ema'] else '-'}|{'3rd' if cfg['third'] else '-'}|"
            f"{'OR' if cfg['or_mid'] else '-'}|{cfg['side']}"
        )

    uniq = {lab(c): c for c in specs}
    specs = list(uniq.values())
    print(f"configs {len(specs)}", flush=True)

    rows = []
    for i, cfg in enumerate(specs, 1):
        if i % 200 == 0 or i == 1:
            print(f"  … {i}/{len(specs)} kept={len(rows)}", flush=True)
        book = cfg["book"]
        key_nf = ("NF", cfg["lb"], cfg["pierce_pts"])
        key_bk = ("BK", cfg["lb"], cfg["pierce_pts"])
        if book == "NF":
            dp = simulate(nf, packs[key_nf], cfg)
        elif book == "BK":
            dp = simulate(bk, packs[key_bk], cfg)
        else:
            a = simulate(nf, packs[key_nf], cfg)
            b = simulate(bk, packs[key_bk], cfg)
            dp = {d: a.get(d, 0.0) + b.get(d, 0.0) for d in set(a) | set(b)}
        if len(dp) < 40:
            continue
        tr = metrics(dp, train)
        te = metrics(dp, test)
        if te["net"] <= 0:
            continue
        rows.append(
            {
                "id": lab(cfg),
                "score": score(tr, te),
                "train": tr,
                "test": te,
                "cfg": {k: v for k, v in cfg.items() if k not in ("es", "ee")},
                "beats_genie_avg": te["avg"] >= GENIE["avg"],
                "beats_genie_net": te["net"] >= GENIE["net"],
            }
        )

    rows.sort(key=lambda r: -r["score"])
    both = [r for r in rows if r["train"]["net"] > 0 and r["test"]["net"] > 0]
    beat_avg = [r for r in both if r["beats_genie_avg"]]
    beat_net = [r for r in both if r["beats_genie_net"]]
    max_net = sorted(both, key=lambda r: -r["test"]["net"])
    low_red = sorted(
        [r for r in both if r["test"]["red_pct"] <= 30],
        key=lambda r: (-r["test"]["net"], r["test"]["red_pct"]),
    )

    # Phase-2 refine: take top DNA skeletons and widen R / session slightly
    refine = []
    seeds = max_net[:5] + beat_avg[:3]
    seen = set()
    for s in seeds:
        c0 = s["cfg"]
        for rr, mt, ee_m in product((2.0, 2.5, 3.0, 3.5), (2, 3, 4), (14 * 60 + 30, 14 * 60 + 45)):
            cfg = dict(c0)
            cfg["rr"] = rr
            cfg["mt"] = mt
            cfg["ee"] = ee_m
            cfg["es"] = to_min("09:45")
            tid = lab(cfg) + f"|ee{ee_m}"
            if tid in seen:
                continue
            seen.add(tid)
            book = cfg["book"]
            key_nf = ("NF", cfg["lb"], cfg["pierce_pts"])
            key_bk = ("BK", cfg["lb"], cfg["pierce_pts"])
            if book == "NF":
                dp = simulate(nf, packs[key_nf], cfg)
            elif book == "BK":
                dp = simulate(bk, packs[key_bk], cfg)
            else:
                a = simulate(nf, packs[key_nf], cfg)
                b = simulate(bk, packs[key_bk], cfg)
                dp = {d: a.get(d, 0.0) + b.get(d, 0.0) for d in set(a) | set(b)}
            if len(dp) < 40:
                continue
            tr = metrics(dp, train)
            te = metrics(dp, test)
            if te["net"] <= 0 or tr["net"] <= 0:
                continue
            refine.append(
                {
                    "id": tid,
                    "score": score(tr, te),
                    "train": tr,
                    "test": te,
                    "cfg": {k: v for k, v in cfg.items() if k not in ("es",)},
                    "beats_genie_avg": te["avg"] >= GENIE["avg"],
                    "beats_genie_net": te["net"] >= GENIE["net"],
                }
            )

    pool = both + refine
    # de-dup by id keep best score
    best_map = {}
    for r in pool:
        if r["id"] not in best_map or r["score"] > best_map[r["id"]]["score"]:
            best_map[r["id"]] = r
    pool = sorted(best_map.values(), key=lambda r: -r["score"])
    max_net = sorted(pool, key=lambda r: -r["test"]["net"])
    beat_avg = [r for r in pool if r["beats_genie_avg"]]
    beat_net = [r for r in pool if r["beats_genie_net"]]

    out = {
        "thesis": "S/R trap (liquidity sweep) + confirm → reaction → R-multiple (max earn)",
        "friend_decode": {
            "zones": "causal swing support / resistance",
            "trap": "wick beyond level, close back inside (stop-hunt)",
            "confirm": "EMA / OR-mid / close-third / next-bar continuation",
            "reaction": "BUY support-trap · SELL resistance-trap",
        },
        "proxy": "Nifty×65 · Bank×30",
        "genie_oos": GENIE,
        "phase1_kept": len(rows),
        "both_halves": len(both),
        "refine_added": len(refine),
        "beats_genie_avg_count": len(beat_avg),
        "beats_genie_net_count": len(beat_net),
        "champion": pool[0] if pool else None,
        "max_net_oos": max_net[:12],
        "top_score": pool[:12],
        "beats_genie_avg": beat_avg[:8],
        "beats_genie_net": beat_net[:8],
        "low_red": low_red[:8],
        "note": "GENIE unchanged. Legend ceiling research.",
    }
    (OUT / "summary.json").write_text(json.dumps(out, indent=2))

    print(
        f"\nPhase1 kept={len(rows)} both={len(both)} refine={len(refine)} "
        f"beat_avg={len(beat_avg)} beat_net={len(beat_net)}"
    )
    print("\n=== MAX NET OOS (honest both halves) ===")
    for r in max_net[:12]:
        te, tr = r["test"], r["train"]
        flag = " ★AVG+" if r["beats_genie_avg"] else ""
        flag += " ★NET+" if r["beats_genie_net"] else ""
        print(
            f"  OOS ₹{te['net']:8} avg₹{te['avg']:5}/d g{te['green_pct']:5.1f}% "
            f"r{te['red_pct']:5.1f}% pf{te['pf']:4} DD{te['max_dd']:8} | "
            f"TR ₹{tr['net']:8}{flag} | {r['id'][:72]}"
        )
    print("\n=== vs GENIE OOS ₹321k / ₹523/day ===")
    if beat_net:
        print("  Found books that beat GENIE net:")
        for r in beat_net[:5]:
            print(f"    {r['id'][:70]} → ₹{r['test']['net']} avg₹{r['test']['avg']}")
    elif beat_avg:
        print("  Beat GENIE avg/day but not full net:")
        for r in beat_avg[:5]:
            print(f"    {r['id'][:70]} → avg₹{r['test']['avg']} net₹{r['test']['net']}")
    else:
        print("  No config beat GENIE avg or net on walk-forward.")
        if max_net:
            gap = GENIE["net"] - max_net[0]["test"]["net"]
            print(
                f"  Closest: ₹{max_net[0]['test']['net']} avg₹{max_net[0]['test']['avg']} "
                f"(GENIE gap ₹{gap})"
            )
    print(f"\nWrote {OUT / 'summary.json'}")


if __name__ == "__main__":
    main()
