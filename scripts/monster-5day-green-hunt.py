#!/usr/bin/env python3
"""
Monster hunt — maximize ALL-5-TRADING-DAYS-GREEN weeks on combined desk.

Nifty + Bank Trap + Crude (charge-aware). Rank by:
  1) % of rolling 5-session windows that are all green after charges
  2) overall green%
  3) red% (lower better)
  4) net ₹/day

  python3 scripts/monster-5day-green-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from itertools import product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "monster-5day-green"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

_cspec = importlib.util.spec_from_file_location(
    "crude_hunt", ROOT / "scripts" / "crude-min-trade-max-profit-hunt.py"
)
ch = importlib.util.module_from_spec(_cspec)
assert _cspec and _cspec.loader
_cspec.loader.exec_module(ch)

OOS_IDX = "2025-01-01"
CHARGE_IDX = uh.CHARGE_IDX
CHARGE_CRUDE = 50.0


def day_net(trades: list[dict]) -> dict[str, float]:
    by: dict[str, float] = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    return dict(by)


def apply_desk_lock(nets: dict[str, float], lock_rs: float) -> dict[str, float]:
    if lock_rs <= 0:
        return nets
    return {d: min(v, lock_rs) for d, v in nets.items()}


def streak_stats(day_list: list[str], nets: dict[str, float]) -> dict:
    """day_list = sorted trading calendar; missing day => 0 (flat)."""
    vals = [nets.get(d, 0.0) for d in day_list]
    n = len(vals)
    if n == 0:
        return dict(
            days=0,
            green=0,
            red=0,
            flat=0,
            green_pct=0,
            red_pct=0,
            avg=0,
            p10=0,
            worst=0,
            best=0,
            ge1k=0,
            win5=0,
            win5_pct=0,
            max_green_streak=0,
            weeks_all_green=0,
            weeks=0,
        )
    green = sum(1 for v in vals if v > 0)
    red = sum(1 for v in vals if v < 0)
    flat = n - green - red
    # rolling 5
    win5 = 0
    total5 = max(0, n - 4)
    for i in range(total5):
        w = vals[i : i + 5]
        if all(x > 0 for x in w):
            win5 += 1
    # calendar weeks (Mon-Fri chunks by ISO week)
    by_week: dict[str, list[float]] = defaultdict(list)
    for d, v in zip(day_list, vals):
        # ISO year-week
        y, w, _ = __import__("datetime").date.fromisoformat(d).isocalendar()
        by_week[f"{y}-W{w:02d}"].append(v)
    weeks_all = 0
    weeks = 0
    for arr in by_week.values():
        if len(arr) < 4:  # need almost full week
            continue
        weeks += 1
        if all(x > 0 for x in arr):
            weeks_all += 1
    # max green streak
    best_streak = cur = 0
    for v in vals:
        if v > 0:
            cur += 1
            best_streak = max(best_streak, cur)
        else:
            cur = 0
    arr = sorted(vals)
    return dict(
        days=n,
        green=green,
        red=red,
        flat=flat,
        green_pct=round(100.0 * green / n, 1),
        red_pct=round(100.0 * red / n, 1),
        avg=round(sum(vals) / n, 1),
        p10=round(arr[max(0, int(0.10 * n) - 1)], 1),
        worst=round(min(vals), 1),
        best=round(max(vals), 1),
        ge1k=round(100.0 * sum(1 for v in vals if v >= 1000) / n, 1),
        win5=win5,
        win5_pct=round(100.0 * win5 / total5, 1) if total5 else 0.0,
        max_green_streak=best_streak,
        weeks_all_green=weeks_all,
        weeks=weeks,
        weeks_all_pct=round(100.0 * weeks_all / weeks, 1) if weeks else 0.0,
    )


def combine(n_map, b_map, c_map, days):
    out = {}
    for d in days:
        out[d] = n_map.get(d, 0.0) + b_map.get(d, 0.0) + c_map.get(d, 0.0)
    return out


def score(s: dict) -> float:
    if s["days"] < 40:
        return -1e18
    # Monster priority: 5-day all-green windows + crush red + keep some ₹
    return (
        s["win5_pct"] * 20.0
        + s["weeks_all_pct"] * 15.0
        + s["green_pct"] * 4.0
        - s["red_pct"] * 8.0
        + min(s["avg"], 4000) * 0.05
        + s["ge1k"] * 2.0
        + s["max_green_streak"] * 3.0
        + s["p10"] * 0.02
    )


def main() -> None:
    print("Loading caches…", flush=True)
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude_mk = ch.load(ch.CACHE)

    # Index OOS days from 2025; Crude only exists from 2026-03-23 — overlap for desk
    all_idx_days = sorted(set(str(d) for d in nifty["days"]))
    oos_idx_days = [d for d in all_idx_days if d >= OOS_IDX]
    crude_days = set(crude_mk["day_list"])
    overlap = sorted(d for d in oos_idx_days if d in crude_days)
    # Also keep longer index-only window for Trap ranking
    print(
        f"index OOS days={len(oos_idx_days)} crude days={len(crude_days)} overlap={len(overlap)} "
        f"{overlap[0] if overlap else '-'}→{overlap[-1] if overlap else '-'}",
        flush=True,
    )

    # --- Trap grid (green-monster) ---
    trap_cfgs = []
    for pierce, peak, soft, rr, max_tr, mode, day_stop in product(
        (3, 5, 8, 10, 12, 15),
        ((150, 75, 75), (200, 100, 100), (300, 150, 150), (400, 200, 200), (600, 300, 300)),
        ((0, 0, 0), (0.45, 0.6, 500)),
        (1.5, 2.0, 2.5, 3.0),
        (1, 2, 3, 0),
        ("both", "trap"),
        (40, 60, 80, 0),
    ):
        # prune explosion
        if max_tr == 0 and rr not in (2.0, 2.5):
            continue
        if mode == "trap" and pierce not in (5, 10, 15):
            continue
        if soft[0] > 0 and pierce not in (5, 10) and rr not in (2.0, 2.5):
            continue
        if day_stop == 0 and max_tr not in (1, 2):
            continue
        peak_arm, peak_lock, peak_gb = peak
        soft_frac, soft_max, soft_rs = soft
        name = (
            f"p{pierce}_pk{peak_arm}_s{soft_frac}_rr{rr}_m{max_tr}_{mode}_ds{day_stop}"
        )
        trap_cfgs.append(
            (
                name,
                dict(
                    pierce=pierce,
                    peak_arm=peak_arm,
                    peak_lock=peak_lock,
                    peak_gb=peak_gb,
                    soft_frac=soft_frac,
                    soft_max_mfe_r=soft_max,
                    soft_rs=soft_rs,
                    rr=rr,
                    max_trades=max_tr,
                    mode=mode,
                    day_stop=day_stop if day_stop > 0 else 9999,
                    protect_arm_r=1.0,
                ),
            )
        )

    # Baselines
    trap_cfgs = [
        (
            "wired_v161",
            dict(
                pierce=15,
                peak_arm=400,
                peak_lock=200,
                peak_gb=200,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                max_trades=0,
                mode="both",
                day_stop=80,
                protect_arm_r=1.0,
            ),
        ),
        (
            "doc32_green_champ",
            dict(
                pierce=3,
                peak_arm=0,
                peak_lock=0,
                peak_gb=0,
                soft_frac=0,
                soft_max_mfe_r=0,
                soft_rs=0,
                rr=2.0,
                max_trades=2,
                mode="both",
                day_stop=80,
                protect_arm_r=1.0,
            ),
        ),
    ] + trap_cfgs

    print(f"Trap configs={len(trap_cfgs)}", flush=True)

    trap_rows = []
    for i, (name, kw) in enumerate(trap_cfgs, 1):
        if i % 40 == 0:
            print(f"  trap …{i}/{len(trap_cfgs)} kept={len(trap_rows)}", flush=True)
        tn = day_net(
            [t for t in uh.sim_trap(nifty, min_risk=4, max_risk=28, **kw) if t["day"] >= OOS_IDX]
        )
        tb = day_net(
            [t for t in uh.sim_trap(bank, min_risk=8, max_risk=50, **kw) if t["day"] >= OOS_IDX]
        )
        # index combined
        idx_days = oos_idx_days
        idx_nets = {d: tn.get(d, 0.0) + tb.get(d, 0.0) for d in idx_days}
        # desk lock variants evaluated later; store raw maps
        s = streak_stats(idx_days, idx_nets)
        trap_rows.append(dict(name=name, cfg=kw, stats=s, n_map=tn, b_map=tb, idx_nets=idx_nets))

    trap_rows.sort(key=lambda r: score(r["stats"]), reverse=True)
    print("\n=== TOP 12 INDEX (N+B) by 5-day green score ===", flush=True)
    for i, r in enumerate(trap_rows[:12], 1):
        s = r["stats"]
        print(
            f"{i:2d}. {r['name']}  green={s['green_pct']}% red={s['red_pct']}% "
            f"win5={s['win5_pct']}% weeksAll={s['weeks_all_pct']}% "
            f"streak={s['max_green_streak']} avg={s['avg']} ge1k={s['ge1k']}% "
            f"worst={s['worst']}",
            flush=True,
        )

    # --- Crude grid (few trades, green) ---
    crude_cfgs = []
    for mode, sl, tp, max_day, lock, first_win, wname, entry in product(
        ("trap", "session_or"),
        (30, 40, 50, 60),
        (60, 100, 150, 200),
        (1, 2, 3, 4),
        (0, 800, 1000, 1500, 2000),
        (False, True),
        ("full10", "eve"),
        (None,),
    ):
        if tp < sl * 2:
            continue
        if first_win and max_day > 2:
            continue
        if mode == "session_or" and max_day > 3:
            continue
        if wname == "full10":
            entry_s, entry_e = 10 * 60, 23 * 60
        else:
            entry_s, entry_e = 18 * 60 + 30, 22 * 60
        crude_cfgs.append(
            dict(
                name=f"{mode}_sl{sl}_tp{tp}_m{max_day}_fw{int(first_win)}_lock{lock}_{wname}",
                mode=mode,
                sl=sl,
                tp=tp,
                day_loss=0,
                day_lock_rs=lock,
                max_day=max_day,
                entry_s=entry_s,
                entry_e=entry_e,
                pierce=0.0,
                max_or_width=0,
                first_win=first_win,
                confirm=True,
            )
        )
    # baselines
    crude_cfgs = [
        dict(
            name="wired_v163",
            mode="trap",
            sl=50,
            tp=200,
            day_loss=0,
            day_lock_rs=1000,
            max_day=4,
            entry_s=10 * 60,
            entry_e=23 * 60,
            pierce=0.0,
            max_or_width=0,
            first_win=False,
            confirm=True,
        ),
        dict(
            name="old_sl30_tp60_m2",
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
    ] + crude_cfgs

    print(f"\nCrude configs={len(crude_cfgs)}", flush=True)
    crude_rows = []
    for i, cfg in enumerate(crude_cfgs, 1):
        if i % 100 == 0:
            print(f"  crude …{i}/{len(crude_cfgs)} kept={len(crude_rows)}", flush=True)
        name = cfg["name"]
        kw = {k: v for k, v in cfg.items() if k != "name"}
        res = ch.simulate(crude_mk, **kw)
        if not res or res["trade_days"] < 20:
            continue
        # rebuild day nets from a light resim storing days — simulate doesn't return trades
        # Use summarize fields only for crude solo; for combine we need day map.
        # Re-simulate collecting day nets:
        # Patch: call internal by reusing simulate logic via trades — quick re-run collector
        crude_rows.append(dict(name=name, cfg=kw, solo=res))

    # Need day maps for crude — extend with collector
    def crude_day_map(kw) -> dict[str, float]:
        # local copy of simulate that returns by_day after charges
        mk = crude_mk
        o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
        days, mins, ema = mk["days"], mk["mins"], mk["ema"]
        or_hi, or_lo = mk["or_hi"], mk["or_lo"]
        sh, slv = mk["sh"], mk["slv"]
        mode = kw["mode"]
        sl, tp = kw["sl"], kw["tp"]
        day_loss = kw["day_loss"]
        day_lock_rs = kw["day_lock_rs"]
        max_day = kw["max_day"]
        entry_s, entry_e = kw["entry_s"], kw["entry_e"]
        pierce = kw["pierce"]
        max_or_width = kw["max_or_width"]
        first_win = kw["first_win"]
        confirm = kw["confirm"]
        EXIT_M = 23 * 60 + 10
        OR_END = 9 * 60 + 30
        RS = 10.0
        by_day: dict[str, float] = defaultdict(float)
        day_fills = 0
        day_net = 0.0
        won_today = False
        locked = False
        cur_day = None
        pending = None
        open_t = None
        for i in range(50, mk["n"]):
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
                        by_day[day] += pts * RS - CHARGE_CRUDE
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
                        by_day[day] += pts * RS - CHARGE_CRUDE
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
                if mm <= OR_END or day not in or_hi:
                    continue
                hi, lo = or_hi[day], or_lo[day]
                if max_or_width > 0 and (hi - lo) > max_or_width:
                    continue
                if float(c[i]) > hi + pierce and buy_ok:
                    signal, level = "BUY", hi
                elif float(c[i]) < lo - pierce and sell_ok:
                    signal, level = "SELL", lo
            else:
                if np.isnan(sh[i]):
                    continue
                if float(c[i]) > sh[i] + pierce and buy_ok:
                    signal, level = "BUY", float(sh[i])
                elif float(c[i]) < slv[i] - pierce and sell_ok:
                    signal, level = "SELL", float(slv[i])
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
        return dict(by_day)

    # Attach day maps for top crude by solo green_after
    crude_rows.sort(key=lambda r: (r["solo"]["green_after_pct"], r["solo"]["net_per_trade_day"]), reverse=True)
    print("\n=== TOP 10 CRUDE solo (green after charges) ===", flush=True)
    for i, r in enumerate(crude_rows[:10], 1):
        s = r["solo"]
        print(
            f"{i:2d}. {r['name']} greenA={s['green_after_pct']:.0f}% tpd={s['tpd']:.2f} "
            f"net₹/d={s['net_per_trade_day']:.0f} ≥1k={s['ge1k']:.0f}% PF={s['pf']:.2f}",
            flush=True,
        )

    # Precompute day maps for top crude + wired + first-win variants (limit CPU)
    crude_pick = []
    seen = set()
    for r in crude_rows:
        if r["name"] in seen:
            continue
        # keep high-green and wired family
        if (
            r["solo"]["green_after_pct"] >= 62
            or r["name"].startswith("wired")
            or (r["cfg"].get("first_win") and r["solo"]["green_after_pct"] >= 55)
        ):
            crude_pick.append(r)
            seen.add(r["name"])
        if len(crude_pick) >= 40:
            break
    # always include first-win max1/2 high-TP trap
    for r in crude_rows:
        if r["name"] in seen:
            continue
        c = r["cfg"]
        if c["mode"] == "trap" and c["first_win"] and c["tp"] >= 150:
            crude_pick.append(r)
            seen.add(r["name"])
        if len(crude_pick) >= 55:
            break

    print(f"Building crude day maps for {len(crude_pick)} candidates…", flush=True)
    for r in crude_pick:
        r["day_map"] = crude_day_map(r["cfg"])

    # --- Combined desk on overlap ---
    top_trap = trap_rows[:25]
    desk_rows = []
    for tr in top_trap:
        for cr in crude_pick:
            for desk_lock in (0, 2000, 3000, 5000):
                nets = combine(tr["n_map"], tr["b_map"], cr["day_map"], overlap)
                nets = apply_desk_lock(nets, desk_lock)
                s = streak_stats(overlap, nets)
                desk_rows.append(
                    dict(
                        name=f"{tr['name']}__{cr['name']}__dlock{desk_lock}",
                        trap=tr["name"],
                        crude=cr["name"],
                        desk_lock=desk_lock,
                        trap_cfg=tr["cfg"],
                        crude_cfg=cr["cfg"],
                        stats=s,
                        score=score(s),
                    )
                )

    desk_rows.sort(key=lambda r: r["score"], reverse=True)
    print("\n=== TOP 15 COMBINED DESK (overlap) — 5-day green monster ===", flush=True)
    for i, r in enumerate(desk_rows[:15], 1):
        s = r["stats"]
        print(
            f"{i:2d}. {r['name']}\n"
            f"    green={s['green_pct']}% red={s['red_pct']}% win5={s['win5_pct']}% "
            f"weeksAll={s['weeks_all_pct']}% ({s['weeks_all_green']}/{s['weeks']}) "
            f"streak={s['max_green_streak']} avg={s['avg']} ge1k={s['ge1k']}% "
            f"p10={s['p10']} worst={s['worst']}",
            flush=True,
        )

    winner = desk_rows[0] if desk_rows else None
    # Prefer among top 30: highest win5_pct with red_pct <= 25 and avg > 200
    robust = [
        r
        for r in desk_rows[:80]
        if r["stats"]["red_pct"] <= 25
        and r["stats"]["avg"] >= 200
        and r["stats"]["green_pct"] >= 55
    ]
    robust.sort(
        key=lambda r: (
            r["stats"]["win5_pct"],
            r["stats"]["weeks_all_pct"],
            r["stats"]["green_pct"],
            -r["stats"]["red_pct"],
            r["stats"]["avg"],
        ),
        reverse=True,
    )
    if robust:
        winner = robust[0]

    answer = {
        "goal": "Maximize all-5-trading-days-green probability on combined desk",
        "overlap_days": {"n": len(overlap), "from": overlap[0], "to": overlap[-1]},
        "charges": {"index_rt": CHARGE_IDX, "crude_rt": CHARGE_CRUDE},
        "top_index": [
            {"name": r["name"], "cfg": r["cfg"], "stats": r["stats"]} for r in trap_rows[:15]
        ],
        "top_crude": [
            {"name": r["name"], "cfg": r["cfg"], "solo": r["solo"]} for r in crude_rows[:15]
        ],
        "top_desk": [
            {
                "name": r["name"],
                "trap": r["trap"],
                "crude": r["crude"],
                "desk_lock": r["desk_lock"],
                "trap_cfg": r["trap_cfg"],
                "crude_cfg": r["crude_cfg"],
                "stats": r["stats"],
                "score": r["score"],
            }
            for r in desk_rows[:25]
        ],
        "winner": None
        if not winner
        else {
            "name": winner["name"],
            "trap": winner["trap"],
            "crude": winner["crude"],
            "desk_lock": winner["desk_lock"],
            "trap_cfg": winner["trap_cfg"],
            "crude_cfg": winner["crude_cfg"],
            "stats": winner["stats"],
        },
        "honest_ceiling": (
            "100% green every calendar week is not guaranteed. This hunt maximizes "
            "rolling-5 all-green rate and minimizes red days after charges."
        ),
    }
    (OUT / "summary.json").write_text(json.dumps(answer, indent=2))
    print(f"\nWrote {OUT / 'summary.json'}", flush=True)
    if winner:
        print("\n=== WINNER ===", flush=True)
        print(winner["name"], flush=True)
        print("TRAP", json.dumps(winner["trap_cfg"], indent=2), flush=True)
        print("CRUDE", json.dumps(winner["crude_cfg"], indent=2), flush=True)
        print("desk_lock", winner["desk_lock"], flush=True)
        print(json.dumps(winner["stats"], indent=2), flush=True)


if __name__ == "__main__":
    main()
