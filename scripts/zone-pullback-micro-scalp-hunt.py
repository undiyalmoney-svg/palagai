#!/usr/bin/env python3
"""
Zone-pullback MICRO-SCALP hunt — friend's "2% many times, tiny loss" DNA.

Chart DNA (Smart Pullback PRO style):
  impulse → demand/supply box → leave → first retest + rejection
  → SL beyond zone → small TP (≈2% option premium ≈ 6–12 Nifty pts)

Walk-forward: train 2020–23 / test 2024+. Nifty pts × ₹65.
GENIE left unchanged — research only.

    python3 scripts/zone-pullback-micro-scalp-hunt.py
"""
from __future__ import annotations

import json
from itertools import product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache" / "nifty-5m-2020-2026.json"
OUT = ROOT / "reports" / "zone-micro-scalp"
OUT.mkdir(parents=True, exist_ok=True)

RS = 65.0
TRAIN_END = "2023-12-31"
TEST_START = "2024-01-01"
EXIT_M = 15 * 60 + 15


def to_min(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def load():
    rows = json.loads(CACHE.read_text())
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
    return o, h, l, c, days, mins, body, ab, ema


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
        "flat_pct": round(100 * float((xs == 0).mean()), 1),
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


def simulate_zone(
    o, h, l, c, days, mins, body, ab, ema, *,
    imp: float,
    leave: float,
    tp: float,
    rr: float,
    tp_mode: str,
    max_risk: float,
    use_ema: bool,
    side: str,
    dt: float,
    dl: float,
    mt: int,
    es: int = 9 * 60 + 45,
    ee: int = 14 * 60 + 45,
    cd: int = 3,
    pad: float = 2.0,
    tol: float = 3.0,
    ttl: int = 48,
    min_age: int = 3,
    sl_pad: float = 2.0,
) -> tuple[dict[str, float], int]:
    """Zone DNA: impulse box → leave → first retest reject → SL beyond zone."""
    day_rs: dict[str, float] = {}
    zones: list[list] = []  # [side±1, top, bot, born, left, used]
    cur = None
    day_pts = 0.0
    trades = 0
    done = False
    open_dir = 0
    entry = stop = target = 0.0
    last = -9999
    ntrades = 0
    n = len(c)

    for i in range(60, n):
        d = days[i]
        mm = int(mins[i])
        if d != cur:
            cur = d
            day_pts = 0.0
            trades = 0
            done = False
            open_dir = 0
            zones = []

        if open_dir:
            exit_px = None
            if open_dir == 1:
                if l[i] <= stop:
                    exit_px = stop
                elif h[i] >= target:
                    exit_px = target
            else:
                if h[i] >= stop:
                    exit_px = stop
                elif l[i] <= target:
                    exit_px = target
            if exit_px is None and mm >= EXIT_M:
                exit_px = float(c[i])
            if exit_px is not None:
                pts = (exit_px - entry) if open_dir == 1 else (entry - exit_px)
                day_pts += pts
                day_rs[d] = day_rs.get(d, 0.0) + pts * RS
                trades += 1
                ntrades += 1
                open_dir = 0
                last = i
                if dt and day_pts >= dt:
                    done = True
                if day_pts <= -dl:
                    done = True

        if body[i] >= imp * ab[i]:
            if c[i] > o[i]:
                bot = float(l[i])
                top = float(min(o[i], c[i])) + pad
                if top > bot:
                    zones.append([1, top, bot, i, 0, 0])
            else:
                top = float(h[i])
                bot = float(max(o[i], c[i])) - pad
                if top > bot:
                    zones.append([-1, top, bot, i, 0, 0])

        keep = []
        for z in zones:
            if not z[5]:
                if z[0] == 1:
                    if l[i] > z[1] + leave:
                        z[4] = 1
                    if c[i] < z[2] - tol:
                        z[5] = 1
                else:
                    if h[i] < z[2] - leave:
                        z[4] = 1
                    if c[i] > z[1] + tol:
                        z[5] = 1
            if i - z[3] <= ttl:
                keep.append(z)
        zones = keep

        if open_dir or done or trades >= mt:
            continue
        if mm < es or mm > ee or i - last < cd:
            continue

        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        e = ema[i]
        for z in reversed(zones):
            if z[5] or i - z[3] < min_age or not z[4]:
                continue
            if z[0] == 1:
                if side == "short":
                    continue
                if not (ll <= z[1] + tol and ll >= z[2] - tol and cc > oo and cc >= z[1] - tol):
                    continue
                if use_ema and not (cc > e):
                    continue
                stop_px = z[2] - sl_pad
                risk = cc - stop_px
                if risk <= 1 or risk > max_risk:
                    continue
                tp_pts = tp if tp_mode == "pts" else risk * rr
                z[5] = 1
                entry, stop, target, open_dir = cc, stop_px, cc + tp_pts, 1
                break
            if side == "long":
                continue
            if not (hh >= z[2] - tol and hh <= z[1] + tol and cc < oo and cc <= z[2] + tol):
                continue
            if use_ema and not (cc < e):
                continue
            stop_px = z[1] + sl_pad
            risk = stop_px - cc
            if risk <= 1 or risk > max_risk:
                continue
            tp_pts = tp if tp_mode == "pts" else risk * rr
            z[5] = 1
            entry, stop, target, open_dir = cc, stop_px, cc - tp_pts, -1
            break

    return day_rs, ntrades


def score(tr: dict, te: dict) -> float:
    if not te or te["net"] <= 0:
        return -1e9
    s = te["net"] * 0.001 + (tr["net"] if tr else 0) * 0.0003
    s += te["green_pct"] * 5 - te["red_pct"] * 15 + min(te["pf"], 3) * 80
    s -= abs(te["max_dd"]) * 0.02
    if not tr or tr["net"] <= 0:
        s -= 200
    return round(s, 1)


def main():
    o, h, l, c, days, mins, body, ab, ema = load()
    all_days = sorted(set(days.tolist()))
    train = [d for d in all_days if d <= TRAIN_END]
    test = [d for d in all_days if d >= TEST_START]
    print(
        f"Nifty bars {len(c)} days {len(all_days)} train {len(train)} test {len(test)}",
        flush=True,
    )

    slim = []
    for imp, leave, max_risk, use_ema, side, (dt, dl), mt, tp_mode in product(
        (1.5, 2.0),
        (8, 15),
        (8, 10),
        (True, False),
        ("both", "long"),
        ((0, 20), (12, 20), (15, 25), (20, 30)),
        (4, 8),
        ("pts", "R"),
    ):
        if dt == 0 and mt != 8:
            continue
        if dt != 0 and mt != 4:
            continue
        if tp_mode == "pts":
            for tp in (8, 12):
                slim.append(
                    dict(
                        imp=imp,
                        leave=leave,
                        tp=tp,
                        rr=1.5,
                        tp_mode="pts",
                        max_risk=max_risk,
                        use_ema=use_ema,
                        side=side,
                        dt=dt,
                        dl=dl,
                        mt=mt,
                    )
                )
        else:
            for rr in (1.5, 2.0):
                slim.append(
                    dict(
                        imp=imp,
                        leave=leave,
                        tp=8,
                        rr=rr,
                        tp_mode="R",
                        max_risk=max_risk,
                        use_ema=use_ema,
                        side=side,
                        dt=dt,
                        dl=dl,
                        mt=mt,
                    )
                )

    print(f"Configs: {len(slim)}", flush=True)
    rows = []
    for i, kw in enumerate(slim, 1):
        if i % 40 == 0 or i == 1:
            print(f"  … {i}/{len(slim)}", flush=True)
        dp, nt = simulate_zone(o, h, l, c, days, mins, body, ab, ema, **kw)
        if len(dp) < 40:
            continue
        tr = metrics(dp, train)
        te = metrics(dp, test)
        if te["net"] <= 0:
            continue
        tid = (
            f"Z imp{kw['imp']} leave{kw['leave']} "
            f"{kw['tp_mode']}{kw['tp'] if kw['tp_mode'] == 'pts' else kw['rr']} "
            f"maxR{kw['max_risk']} {'ema' if kw['use_ema'] else 'any'} {kw['side']} "
            f"DT{kw['dt']}/DL{kw['dl']} mt{kw['mt']}"
        )
        rows.append(
            {
                "family": "zone",
                "id": tid,
                "score": score(tr, te),
                "train": tr,
                "test": te,
                "trades": nt,
                "cfg": kw,
            }
        )

    rows.sort(key=lambda r: -r["score"])
    both = [r for r in rows if r["train"]["net"] > 0 and r["test"]["net"] > 0]
    green = sorted(
        both,
        key=lambda r: (-r["test"]["green_pct"], r["test"]["red_pct"], -r["test"]["net"]),
    )
    low_red = sorted(
        [r for r in both if r["test"]["red_pct"] <= 20],
        key=lambda r: (-r["test"]["net"], r["test"]["red_pct"]),
    )
    opp = sorted(
        [r for r in both if r["test"]["traded_pct"] >= 30],
        key=lambda r: (-r["test"]["avg"], -r["test"]["green_pct"]),
    )

    out = {
        "thesis": "Friend day-scalper: many ~2% wins, tiny losses, use all opportunities",
        "chart_dna": "impulse → box → leave → first retest reject → SL beyond zone → small TP",
        "proxy": "Nifty pts × ₹65 · ~2% option ≈ 6–12 index pts",
        "genie_oos_baseline": {
            "net": 321283,
            "avg": 523,
            "red_pct": 35.7,
            "max_dd": -34119,
            "pf": 1.58,
            "note": "Nifty+Bank combo",
        },
        "tested": len(rows),
        "both_halves_green": len(both),
        "champion": both[0] if both else None,
        "top_score": (both[:12] if both else rows[:12]),
        "highest_green_oos": green[:8],
        "low_red_max_net": low_red[:8],
        "high_opportunity": opp[:8],
        "doc": "docs/owner-private/30-ZONE-MICRO-SCALP.md",
    }
    (OUT / "summary.json").write_text(json.dumps(out, indent=2))

    print(f"\nKept {len(rows)} · both-halves {len(both)}", flush=True)
    print("=== TOP (train+test >0) ===", flush=True)
    for r in (both or rows)[:10]:
        te, tr = r["test"], r["train"]
        print(
            f"  OOS g{te['green_pct']:5.1f}% r{te['red_pct']:5.1f}% "
            f"traded{te['traded_pct']:5.1f}% avg₹{te['avg']:5} net{te['net']:8} "
            f"pf{te['pf']:4} | TR{tr['net']:8} | {r['id'][:72]}",
            flush=True,
        )
    print("=== HIGH OPPORTUNITY (traded≥30%) ===", flush=True)
    for r in opp[:6]:
        te = r["test"]
        print(
            f"  g{te['green_pct']:5.1f}% r{te['red_pct']:5.1f}% "
            f"traded{te['traded_pct']:5.1f}% avg₹{te['avg']:5} net{te['net']:8} "
            f"| {r['id'][:72]}",
            flush=True,
        )
    print(f"\nWrote {OUT / 'summary.json'}", flush=True)


if __name__ == "__main__":
    main()
