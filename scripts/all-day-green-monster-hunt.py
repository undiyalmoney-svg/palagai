#!/usr/bin/env python3
"""
ALL-DAY-GREEN monster hunt — maximize green days (day net > 0 after charges).

Primary rank: green% → red% (lower) → no-red% → avg ₹ → ≥₹1k%.
Also reports rolling-5 all-green and longest green streak.

Uses Kite cache. Index proxy ₹65/₹30 · Crude ₹10 + charges.

  python3 scripts/all-day-green-monster-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "all-day-green"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

OOS = "2025-01-01"
OVERLAP = "2026-03-23"  # crude cache start
RECENT = "2026-06-01"
DESK_LOCK = 3000.0


def day_map(trades: list[dict]) -> dict[str, float]:
    by: dict[str, float] = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    return dict(by)


def merge(*maps: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for m in maps:
        for d, v in m.items():
            out[d] += v
    return dict(out)


def lock(nets: dict[str, float], rs: float) -> dict[str, float]:
    if rs <= 0:
        return nets
    return {d: min(v, rs) if v > 0 else v for d, v in nets.items()}


def metrics(nets: dict[str, float], days: list[str], label: str, meta: dict) -> dict:
    vals = [nets.get(d, 0.0) for d in days]
    n = len(vals)
    if n == 0:
        return dict(label=label, days=0, **meta)
    green = sum(1 for x in vals if x > 0)
    red = sum(1 for x in vals if x < 0)
    flat = sum(1 for x in vals if abs(x) < 1e-9)
    # rolling 5 all green
    win5 = 0
    win5_n = 0
    for i in range(n - 4):
        win5_n += 1
        if all(vals[i + k] > 0 for k in range(5)):
            win5 += 1
    # streak
    streak = best = 0
    for x in vals:
        if x > 0:
            streak += 1
            best = max(best, streak)
        else:
            streak = 0
    arr = sorted(vals)
    return dict(
        label=label,
        days=n,
        green_pct=round(100 * green / n, 2),
        red_pct=round(100 * red / n, 2),
        flat_pct=round(100 * flat / n, 2),
        no_red_pct=round(100 * (green + flat) / n, 2),
        avg=round(sum(vals) / n, 1),
        med=round(arr[n // 2], 1),
        p10=round(arr[max(0, int(0.10 * n) - 1)], 1),
        worst=round(min(vals), 1),
        best=round(max(vals), 1),
        ge1k=round(100 * sum(1 for x in vals if x >= 1000) / n, 1),
        ge2k=round(100 * sum(1 for x in vals if x >= 2000) / n, 1),
        win5_pct=round(100 * win5 / max(1, win5_n), 1),
        max_green_streak=best,
        red_days=red,
        **meta,
    )


def main() -> None:
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude = uh.load(uh.CACHE / "crudeoilm-5m-merged.json", 10)

    # DNA grid biased to ALL-GREEN: fewer trades, early lock, tight day stop, confirm ON.
    trap_grid: list[tuple[str, dict, dict]] = []
    for pierce, bank_pierce in ((10, 10), (12, 12), (15, 30), (18, 35), (20, 40)):
        for peak_arm, peak_lock, peak_gb in (
            (100, 50, 50),
            (150, 75, 75),
            (200, 100, 100),
            (400, 200, 200),
        ):
            for rr in (1.5, 2.0, 2.5):
                for max_tr in (1, 2, 3):
                    for day_stop in (30, 40, 60, 80):
                        for mode in ("both", "trap"):
                            # prune explosion
                            if max_tr == 3 and pierce not in (15, 12):
                                continue
                            if peak_arm == 400 and max_tr == 1 and rr != 2.0:
                                continue
                            if mode == "trap" and pierce not in (15, 10):
                                continue
                            label = (
                                f"p{pierce}/B{bank_pierce} peak{peak_arm} rr{rr} "
                                f"max{max_tr} stop{day_stop} {mode}"
                            )
                            params = dict(
                                pierce=pierce,
                                peak_arm=peak_arm,
                                peak_lock=peak_lock,
                                peak_gb=peak_gb,
                                soft_frac=0,
                                soft_max_mfe_r=0,
                                soft_rs=0,
                                rr=rr,
                                mode=mode,
                                max_trades=max_tr,
                                day_stop=day_stop,
                            )
                            trap_grid.append((label, params, dict(bank_pierce=bank_pierce)))

    crude_cfgs = [
        ("crude OFF", None),
        (
            "crude SL50/TP200 max2 firstWin",
            dict(
                sl=50,
                tp=200,
                max_or=10_000,
                entry_s=10 * 60,
                entry_e=23 * 60,
                max_day=2,
                day_loss=10_000,
                confirm=True,
                first_win=True,
                rs=10.0,
            ),
        ),
        (
            "crude SL30/TP60 max1 firstWin eve",
            dict(
                sl=30,
                tp=60,
                max_or=10_000,
                entry_s=18 * 60 + 30,
                entry_e=22 * 60,
                max_day=1,
                day_loss=10_000,
                confirm=True,
                first_win=True,
                rs=10.0,
            ),
        ),
        (
            "crude SL50/TP200 max1 firstWin",
            dict(
                sl=50,
                tp=200,
                max_or=10_000,
                entry_s=10 * 60,
                entry_e=23 * 60,
                max_day=1,
                day_loss=10_000,
                confirm=True,
                first_win=True,
                rs=10.0,
            ),
        ),
    ]

    print(f"Grid: {len(trap_grid)} trap × {len(crude_cfgs)} crude = {len(trap_grid)*len(crude_cfgs)}", flush=True)

    # Precompute trap day maps
    trap_maps: list[tuple[str, dict[str, float], dict]] = []
    for label, params, extra in trap_grid:
        n_p = dict(params)
        b_p = dict(params)
        b_p["pierce"] = extra["bank_pierce"]
        b_p["min_risk"] = 8
        b_p["max_risk"] = 50
        n_tr = uh.sim_trap(nifty, **n_p)
        b_tr = uh.sim_trap(bank, **b_p)
        trap_maps.append((label, merge(day_map(n_tr), day_map(b_tr)), params | extra))

    crude_maps: list[tuple[str, dict[str, float]]] = []
    for clabel, cfg in crude_cfgs:
        if cfg is None:
            crude_maps.append((clabel, {}))
        else:
            crude_maps.append((clabel, day_map(uh.sim_crude(crude, **cfg))))

    rows = []
    for tlabel, tmap, tmeta in trap_maps:
        for clabel, cmap in crude_maps:
            merged = merge(tmap, cmap)
            for window_name, start in (
                ("OOS>=2025", OOS),
                ("overlap>=2026-03-23", OVERLAP),
                ("recent>=2026-06", RECENT),
            ):
                days = sorted(d for d in merged if d >= start)
                # For overlap/recent also include index-only days with 0 crude
                if window_name != "OOS>=2025":
                    # use union of index days in window
                    idx_days = sorted({d for d in tmap if d >= start} | {d for d in cmap if d >= start})
                    days = idx_days
                locked = lock(merged, DESK_LOCK)
                m = metrics(
                    locked,
                    days,
                    f"{tlabel} | {clabel} | lock3k",
                    dict(window=window_name, trap=tmeta, crude=clabel, day_lock=DESK_LOCK),
                )
                rows.append(m)

    def score(r: dict) -> tuple:
        # Prefer perfect/near-perfect green, then few reds, then money
        return (
            r.get("green_pct", 0),
            -r.get("red_pct", 100),
            r.get("no_red_pct", 0),
            r.get("win5_pct", 0),
            r.get("ge1k", 0),
            r.get("avg", 0),
        )

    # Best per window
    summary = {}
    for window in ("OOS>=2025", "overlap>=2026-03-23", "recent>=2026-06"):
        pool = [r for r in rows if r["window"] == window and r["days"] >= 20]
        pool.sort(key=score, reverse=True)
        summary[window] = pool[:15]
        print(f"\n=== TOP {window} (lock ₹3k) ===", flush=True)
        for r in pool[:10]:
            print(
                f"green={r['green_pct']:6}% red={r['red_pct']:5}% noRed={r['no_red_pct']:6}% "
                f"win5={r['win5_pct']:5}% avg={r['avg']:8} worst={r['worst']:8} "
                f"streak={r['max_green_streak']} | {r['label'][:90]}",
                flush=True,
            )

    # Perfect green (100%) if any
    perfect = [r for r in rows if r.get("green_pct", 0) >= 99.999 and r["days"] >= 20]
    near = [r for r in rows if r.get("green_pct", 0) >= 99.0 and r["days"] >= 20]
    no_red_perfect = [r for r in rows if r.get("no_red_pct", 0) >= 99.999 and r["days"] >= 20]

    out = dict(
        note=(
            "Green = day net > 0 after charges + day lock. "
            "Proxy ≠ live option fills. Hunt seeks maximum green%; "
            "100% on long OOS is the ask."
        ),
        perfect_green=perfect[:20],
        near_99_green=near[:20],
        perfect_no_red=no_red_perfect[:20],
        top_by_window=summary,
        tested=len(rows),
    )
    path = OUT / "all-day-green-monster-hunt.json"
    path.write_text(json.dumps(out, indent=2))
    print(f"\nPerfect 100% green configs: {len(perfect)}")
    print(f">=99% green configs: {len(near)}")
    print(f"Perfect no-red configs: {len(no_red_perfect)}")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
