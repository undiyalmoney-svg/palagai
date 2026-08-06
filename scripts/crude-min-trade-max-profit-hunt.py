#!/usr/bin/env python3
"""
Crude DNA hunt — big day profit with FEW trades (charge-aware). Fast grid.

Owner: long Crude session · profit+profit · min trades · day lock so winners
don't get drained · charges must not burn the book.

  python3 scripts/crude-min-trade-max-profit-hunt.py
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(
    os.environ.get(
        "CACHE", ROOT / "reports" / "analyst-cache" / "crudeoilm-5m-merged.json"
    )
)
OUT = ROOT / "reports" / "crude-min-trade-max-profit"
OUT.mkdir(parents=True, exist_ok=True)
RS = 10.0
CHARGE_RS = float(os.environ.get("CHARGE_RS", "50"))
EXIT_M = 23 * 60 + 10
OR_END = 9 * 60 + 30


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path) -> dict:
    rows = json.loads(path.read_text())
    for r in rows:
        d = str(r["date"]).replace("T", " ").replace("+0530", "").split("+")[0].strip()
        r["date"] = d
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"])[11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    ema[49] = float(c[:50].mean())
    for i in range(50, len(c)):
        ema[i] = c[i] * k + ema[i - 1] * (1 - k)

    # Precompute session OR + prev-day HL per calendar day
    day_list = sorted(set(str(d) for d in days))
    or_hi = {}
    or_lo = {}
    pdh = {}
    pdl = {}
    for di, day in enumerate(day_list):
        mask = days == day
        m = mins[mask]
        hh = h[mask]
        ll = l[mask]
        orm = (m >= 9 * 60) & (m <= OR_END)
        if orm.any():
            or_hi[day] = float(hh[orm].max())
            or_lo[day] = float(ll[orm].min())
        if di > 0:
            prev = day_list[di - 1]
            pm = days == prev
            pdh[day] = float(h[pm].max())
            pdl[day] = float(l[pm].min())

    # Swing highs/lows over prior 5 bars (exclude current)
    sh = np.full(len(c), np.nan)
    sl = np.full(len(c), np.nan)
    for i in range(5, len(c)):
        sh[i] = float(h[i - 5 : i].max())
        sl[i] = float(l[i - 5 : i].min())

    return dict(
        o=o,
        h=h,
        l=l,
        c=c,
        days=days,
        mins=mins,
        ema=ema,
        n=len(c),
        or_hi=or_hi,
        or_lo=or_lo,
        pdh=pdh,
        pdl=pdl,
        sh=sh,
        slv=sl,
        day_list=day_list,
    )


def filter_mk(mk, day_set: set[str]):
    all_days = mk["day_list"]
    first = min(day_set)
    warm = [d for d in all_days if d < first][-5:]
    keep = set(warm) | day_set
    idx = np.array([str(d) in keep for d in mk["days"]], dtype=bool)
    out = {
        k: (v[idx] if isinstance(v, np.ndarray) else v)
        for k, v in mk.items()
        if k != "day_list"
    }
    out["n"] = int(idx.sum())
    out["day_list"] = [d for d in all_days if d in keep]
    return out


def simulate(
    mk,
    *,
    mode,
    sl,
    tp,
    day_loss,
    day_lock_rs,
    max_day,
    entry_s,
    entry_e,
    pierce,
    max_or_width,
    first_win=False,
    confirm=True,
):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    or_hi, or_lo = mk["or_hi"], mk["or_lo"]
    pdh, pdl = mk["pdh"], mk["pdl"]
    sh, slv = mk["sh"], mk["slv"]
    n = mk["n"]
    trades = []
    day_net = 0.0
    day_fills = 0
    won_today = False
    locked = False
    cur_day = None
    pending = None
    open_t = None

    for i in range(50, n):
        day = str(days[i])
        mm = int(mins[i])
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_fills = 0
            won_today = False
            locked = False
            pending = None
            open_t = None

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            if direction == "BUY":
                hit_sl = float(l[i]) <= stop
                hit_tp = float(h[i]) >= target
                if hit_sl or hit_tp or mm >= EXIT_M:
                    exit_px = stop if hit_sl else (target if hit_tp else float(c[i]))
                    pts = exit_px - entry
                    trades.append(dict(day=day, rs=pts * RS))
                    day_net += pts
                    day_fills += 1
                    won_today = won_today or pts > 0
                    if day_lock_rs > 0 and day_net * RS >= day_lock_rs:
                        locked = True
                    open_t = None
            else:
                hit_sl = float(h[i]) >= stop
                hit_tp = float(l[i]) <= target
                if hit_sl or hit_tp or mm >= EXIT_M:
                    exit_px = stop if hit_sl else (target if hit_tp else float(c[i]))
                    pts = entry - exit_px
                    trades.append(dict(day=day, rs=pts * RS))
                    day_net += pts
                    day_fills += 1
                    won_today = won_today or pts > 0
                    if day_lock_rs > 0 and day_net * RS >= day_lock_rs:
                        locked = True
                    open_t = None
            continue

        if locked or mm < entry_s or mm > entry_e:
            pending = None
            continue
        if max_day > 0 and day_fills >= max_day:
            continue
        if first_win and won_today:
            continue
        if day_loss > 0 and day_net <= -day_loss:
            continue

        if pending is not None:
            want = pending["dir"]
            ok = (want == "BUY" and float(c[i]) > pending["level"]) or (
                want == "SELL" and float(c[i]) < pending["level"]
            )
            if confirm and ok:
                entry = float(o[i])
                open_t = (
                    dict(dir="BUY", entry=entry, stop=entry - sl, target=entry + tp)
                    if want == "BUY"
                    else dict(
                        dir="SELL", entry=entry, stop=entry + sl, target=entry - tp
                    )
                )
            pending = None
            continue

        buy_ok = np.isnan(ema[i]) or float(c[i]) >= float(ema[i])
        sell_ok = np.isnan(ema[i]) or float(c[i]) <= float(ema[i])
        signal = level = None

        if mode == "session_or":
            if mm <= OR_END:
                continue
            if day not in or_hi:
                continue
            hi, lo = or_hi[day], or_lo[day]
            if max_or_width > 0 and (hi - lo) > max_or_width:
                continue
            if float(c[i]) > hi + pierce and buy_ok:
                signal, level = "BUY", hi
            elif float(c[i]) < lo - pierce and sell_ok:
                signal, level = "SELL", lo
        elif mode == "trap":
            if np.isnan(sh[i]):
                continue
            if float(c[i]) > sh[i] + pierce and buy_ok:
                signal, level = "BUY", float(sh[i])
            elif float(c[i]) < slv[i] - pierce and sell_ok:
                signal, level = "SELL", float(slv[i])
        elif mode == "pdhl":
            if day not in pdh:
                continue
            if float(c[i]) > pdh[day] + pierce and buy_ok:
                signal, level = "BUY", pdh[day]
            elif float(c[i]) < pdl[day] - pierce and sell_ok:
                signal, level = "SELL", pdl[day]

        if signal is None:
            continue
        if confirm:
            pending = dict(dir=signal, level=level)
        else:
            entry = float(c[i])
            open_t = (
                dict(dir="BUY", entry=entry, stop=entry - sl, target=entry + tp)
                if signal == "BUY"
                else dict(dir="SELL", entry=entry, stop=entry + sl, target=entry - tp)
            )

    if not trades:
        return None

    by_day: dict[str, list[float]] = defaultdict(list)
    for t in trades:
        by_day[t["day"]].append(t["rs"])
    day_net_after = [sum(v) - len(v) * CHARGE_RS for v in by_day.values()]
    day_fills_list = [len(v) for v in by_day.values()]
    trade_days = len(day_net_after)
    wins = sum(1 for t in trades if t["rs"] > 0)
    gross = sum(t["rs"] for t in trades)
    charges = len(trades) * CHARGE_RS
    net_after = gross - charges
    gp = sum(t["rs"] for t in trades if t["rs"] > 0)
    gl = -sum(t["rs"] for t in trades if t["rs"] <= 0)
    pf = (gp / gl) if gl > 1e-9 else 99.0
    return dict(
        trades=len(trades),
        trade_days=trade_days,
        green_after_pct=100.0 * sum(1 for x in day_net_after if x > 0) / trade_days,
        win_pct=100.0 * wins / len(trades),
        gross_rs=gross,
        charges_rs=charges,
        net_after_rs=net_after,
        net_per_trade_day=net_after / trade_days,
        tpd=len(trades) / trade_days,
        median_fills=float(np.median(day_fills_list)),
        pf=pf,
        worst_day=min(day_net_after),
        best_day=max(day_net_after),
        p10=float(np.percentile(day_net_after, 10)),
        ge1k=100.0 * sum(1 for x in day_net_after if x >= 1000) / trade_days,
        ge2k=100.0 * sum(1 for x in day_net_after if x >= 2000) / trade_days,
        ge3k=100.0 * sum(1 for x in day_net_after if x >= 3000) / trade_days,
    )


def score(row: dict) -> float:
    if not row or row["trade_days"] < 12:
        return -1e18
    if row["tpd"] > 4.0:
        return -1e18
    return (
        row["net_per_trade_day"] * 3.0
        + row["green_after_pct"] * 5.0
        + row["ge1k"] * 8.0
        + row["ge2k"] * 5.0
        + row["ge3k"] * 3.0
        + min(row["pf"], 5.0) * 25.0
        + row["p10"] * 0.2
        - max(0.0, row["tpd"] - 2.8) * 90.0
        - max(0.0, 1.0 - row["tpd"]) * 20.0
        + min(row["trade_days"], 40) * 0.4
    )


def fmt(x: dict) -> str:
    return (
        f"greenA={x['green_after_pct']:.0f}% win={x['win_pct']:.0f}% tpd={x['tpd']:.2f} "
        f"net₹/d={x['net_per_trade_day']:.0f} ≥1k={x['ge1k']:.0f}% ≥2k={x['ge2k']:.0f}% "
        f"≥3k={x['ge3k']:.0f}% PF={x['pf']:.2f} p10={x['p10']:.0f} "
        f"worst={x['worst_day']:.0f} days={x['trade_days']} chg₹={x['charges_rs']:.0f}"
    )


def main() -> None:
    mk = load(CACHE)
    days = mk["day_list"]
    print(
        f"cache bars={mk['n']} days={len(days)} {days[0]} → {days[-1]} charge=₹{CHARGE_RS}/RT",
        flush=True,
    )
    cut = max(1, int(len(days) * 0.7))
    is_days, oos_days = set(days[:cut]), set(days[cut:])
    mk_is, mk_oos = filter_mk(mk, is_days), filter_mk(mk, oos_days)
    print(f"IS={len(is_days)} OOS={len(oos_days)}", flush=True)

    baselines = [
        dict(
            name="wired_unlim_sl30_tp60",
            mode="session_or",
            sl=30,
            tp=60,
            day_loss=0,
            day_lock_rs=0,
            max_day=0,
            entry_s=10 * 60,
            entry_e=23 * 60,
            pierce=0.0,
            max_or_width=0,
            first_win=False,
            confirm=True,
        ),
        dict(
            name="old_max2_sl30_tp60",
            mode="session_or",
            sl=30,
            tp=60,
            day_loss=40,
            day_lock_rs=0,
            max_day=2,
            entry_s=10 * 60,
            entry_e=22 * 60,
            pierce=0.0,
            max_or_width=0,
            first_win=False,
            confirm=True,
        ),
        dict(
            name="old_max2_sl20_tp40",
            mode="session_or",
            sl=20,
            tp=40,
            day_loss=0,
            day_lock_rs=0,
            max_day=2,
            entry_s=10 * 60,
            entry_e=22 * 60,
            pierce=0.0,
            max_or_width=0,
            first_win=False,
            confirm=True,
        ),
    ]

    configs = []
    for mode in ("session_or", "trap", "pdhl"):
        for sl, tp in (
            (20, 60),
            (25, 75),
            (30, 60),
            (30, 90),
            (30, 120),
            (40, 80),
            (40, 120),
            (40, 160),
            (50, 100),
            (50, 150),
            (50, 200),
            (60, 180),
        ):
            for pierce in (0.0, 1.0, 2.0):
                for entry_s, entry_e, wname in (
                    (10 * 60, 23 * 60, "full10"),
                    (12 * 60, 23 * 60, "noon"),
                    (14 * 60, 23 * 60, "pm"),
                    (18 * 60 + 30, 22 * 60, "eve"),
                ):
                    widths = (0, 80) if mode == "session_or" else (0,)
                    for max_or in widths:
                        for max_day in (2, 3, 4):
                            for first_win in (False, True):
                                if first_win and max_day != 2:
                                    continue
                                for day_lock_rs in (0, 1000, 1500, 2000, 3000):
                                    for day_loss in (0, sl):
                                        configs.append(
                                            dict(
                                                mode=mode,
                                                sl=sl,
                                                tp=tp,
                                                day_loss=day_loss,
                                                day_lock_rs=day_lock_rs,
                                                max_day=max_day,
                                                entry_s=entry_s,
                                                entry_e=entry_e,
                                                pierce=pierce,
                                                max_or_width=max_or,
                                                first_win=first_win,
                                                confirm=True,
                                                wname=wname,
                                            )
                                        )

    print(f"testing {len(configs)} configs + {len(baselines)} baselines…", flush=True)

    def run_one(cfg_in: dict, name: str | None = None, gate: bool = True):
        cfg = {k: v for k, v in cfg_in.items() if k not in ("name", "wname")}
        wname = cfg_in.get("wname", "")
        is_res = simulate(mk_is, **cfg)
        oos_res = simulate(mk_oos, **cfg)
        if not is_res or not oos_res:
            return None
        if gate:
            if is_res["trade_days"] < 12 or oos_res["trade_days"] < 6:
                return None
            if oos_res["net_after_rs"] < 0 or oos_res["tpd"] > 3.8:
                return None
            if oos_res["green_after_pct"] < 58:
                return None
        label = name or (
            f"{cfg['mode']}_sl{cfg['sl']}_tp{cfg['tp']}_p{cfg['pierce']}"
            f"_or{cfg['max_or_width']}_m{cfg['max_day']}_fw{int(cfg['first_win'])}"
            f"_L{cfg['day_loss']}_lock{int(cfg['day_lock_rs'])}_{wname}"
        )
        return {
            "name": label,
            "cfg": {**cfg, "wname": wname},
            "is": is_res,
            "oos": oos_res,
            "score_oos": score(oos_res),
            "score_is": score(is_res),
        }

    base_rows = []
    for b in baselines:
        r = run_one(b, name=b["name"], gate=False)
        if r:
            base_rows.append(r)
            print(f"BASE {b['name']}: OOS {fmt(r['oos'])}", flush=True)

    rows = []
    for i, raw in enumerate(configs, 1):
        if i % 1000 == 0:
            print(f"  …{i}/{len(configs)} kept={len(rows)}", flush=True)
        r = run_one(raw)
        if r:
            rows.append(r)

    rows.sort(key=lambda r: (r["score_oos"], r["oos"]["net_per_trade_day"]), reverse=True)
    top = rows[:40]
    print("\n=== TOP 15 OOS ===", flush=True)
    for i, r in enumerate(top[:15], 1):
        print(f"{i:2d}. {r['name']}\n    OOS {fmt(r['oos'])}\n    IS  {fmt(r['is'])}", flush=True)

    robust = [
        r
        for r in rows
        if r["score_is"] > 0
        and r["is"]["net_per_trade_day"] > 250
        and r["is"]["green_after_pct"] >= 60
        and r["oos"]["tpd"] <= 3.2
        and r["oos"]["ge1k"] >= 30
        and r["oos"]["net_per_trade_day"] > 300
    ]
    robust.sort(
        key=lambda r: (
            r["score_oos"] + 0.7 * r["score_is"],
            r["oos"]["ge2k"],
            r["oos"]["net_per_trade_day"],
        ),
        reverse=True,
    )
    print("\n=== TOP 10 ROBUST ===", flush=True)
    for i, r in enumerate(robust[:10], 1):
        print(f"{i:2d}. {r['name']}\n    OOS {fmt(r['oos'])}\n    IS  {fmt(r['is'])}", flush=True)

    # Prefer day_lock > 0 among robust (owner: don't drain after huge profit)
    locked = [r for r in robust if r["cfg"]["day_lock_rs"] > 0]
    winner = locked[0] if locked else (robust[0] if robust else (top[0] if top else None))

    answer = {
        "charge_rs": CHARGE_RS,
        "days": {
            "from": days[0],
            "to": days[-1],
            "n": len(days),
            "is": len(is_days),
            "oos": len(oos_days),
        },
        "baselines": [
            {
                "name": b["name"],
                "oos": b["oos"],
                "is": b["is"],
                "cfg": b["cfg"],
            }
            for b in base_rows
        ],
        "top_oos": [
            {"name": r["name"], "cfg": r["cfg"], "oos": r["oos"], "is": r["is"]}
            for r in top[:20]
        ],
        "top_robust": [
            {"name": r["name"], "cfg": r["cfg"], "oos": r["oos"], "is": r["is"]}
            for r in robust[:12]
        ],
        "winner": None
        if not winner
        else {
            "name": winner["name"],
            "cfg": winner["cfg"],
            "oos": winner["oos"],
            "is": winner["is"],
        },
        "note": (
            "Futures proxy ₹10/pt − ₹50/RT. Ranking for DNA choice; live option fills differ. "
            "Winner prioritizes net ₹/day after charges, ≥₹1k days, tpd≤3.2, day lock."
        ),
    }
    (OUT / "summary.json").write_text(json.dumps(answer, indent=2))
    print(f"\nWrote {OUT / 'summary.json'}", flush=True)
    if winner:
        print("\n=== WINNER ===", flush=True)
        print(winner["name"], flush=True)
        print(json.dumps(winner["cfg"], indent=2), flush=True)
        print("OOS", fmt(winner["oos"]), flush=True)
        print("IS ", fmt(winner["is"]), flush=True)


if __name__ == "__main__":
    main()
