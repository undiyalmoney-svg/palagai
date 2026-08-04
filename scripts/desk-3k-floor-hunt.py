#!/usr/bin/env python3
"""
Hunt a Nifty + Bank + Crude desk config for ₹3000/day target.

Ranks by:
  1) % days with desk ₹ ≥ 3000
  2) P10 daily ₹ (floor-ish)
  3) avg ₹/day
  4) worst day (less bad)

Cash-day overlap only (days where index OOS + crude sample both exist).
Uses analyst-cache candles — never tokens.

  python3 scripts/desk-3k-floor-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
import itertools
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

# Import simulators from the upgrade hunt without executing main.
_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

TARGET = 3000.0
OOS = "2025-01-01"
CRUDE_FROM = "2026-03-23"


def day_map(trades: list[dict]) -> dict[str, float]:
    by: dict[str, float] = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    return dict(by)


def desk_stats(day_nets: list[float], label: str, meta: dict) -> dict:
    if not day_nets:
        return dict(label=label, days=0, **meta)
    arr = sorted(day_nets)
    n = len(arr)
    p10 = arr[max(0, int(0.10 * n) - 1)]
    return dict(
        label=label,
        days=n,
        avg=round(sum(arr) / n, 1),
        med=round(arr[n // 2], 1),
        green=round(sum(1 for x in arr if x > 0) / n * 100, 1),
        ge3=round(sum(1 for x in arr if x >= TARGET) / n * 100, 1),
        ge2=round(sum(1 for x in arr if x >= 2000) / n * 100, 1),
        p10=round(p10, 1),
        worst=round(min(arr), 1),
        best=round(max(arr), 1),
        **meta,
    )


def score(r: dict) -> tuple:
    # Prefer high ≥3k hit-rate, then higher P10, then avg, then less-bad worst.
    return (r.get("ge3", 0), r.get("p10", -1e9), r.get("avg", 0), r.get("worst", -1e9))


def main() -> None:
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude = uh.load(uh.CACHE / "crudeoilm-5m-merged.json", 10)

    # --- Trap DNA grid (wired peak400+soft as baseline + peers) ---
    trap_grid = [
        ("peak400_soft045", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_only", dict(peak_arm=400, peak_lock=200, peak_gb=200)),
        ("peak300_soft045", dict(peak_arm=300, peak_lock=150, peak_gb=150, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak500_soft045", dict(peak_arm=500, peak_lock=250, peak_gb=250, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_rr3", dict(rr=3.0, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_rr4", dict(rr=4.0, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_max2", dict(max_trades=2, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_max3", dict(max_trades=3, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_daystop50", dict(day_stop=50, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_entry_1015", dict(entry_s=10 * 60 + 15, entry_e=14 * 60 + 15, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_trap_only", dict(mode="trap", peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak600_legacy", dict()),
        ("no_soft_peak400", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0, soft_max_mfe_r=0, soft_rs=0)),
        ("soft035_peak400", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.35, soft_max_mfe_r=0.55, soft_rs=400)),
        ("soft055_peak400", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.55, soft_max_mfe_r=0.75, soft_rs=700)),
        ("peak200_tight", dict(peak_arm=200, peak_lock=100, peak_gb=100, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_pierce2", dict(pierce=2, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
        ("peak400_pierce5", dict(pierce=5, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500)),
    ]

    trap_days: dict[str, dict[str, float]] = {}
    for label, kw in trap_grid:
        tn = uh.filter_oos(uh.sim_trap(nifty, min_risk=4, max_risk=28, **kw), OOS)
        tb = uh.filter_oos(uh.sim_trap(bank, min_risk=8, max_risk=50, **kw), OOS)
        # keep nifty/bank separate so lots can scale independently
        trap_days[label] = {
            "nifty": day_map(tn),
            "bank": day_map(tb),
        }
        print(f"trap {label}: N days={len(trap_days[label]['nifty'])} B days={len(trap_days[label]['bank'])}")

    crude_grid = [
        ("sel_sl20_tp40_m2", dict(sl=20, tp=40, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl20_tp40_m1", dict(sl=20, tp=40, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=1, day_loss=40, first_win=False)),
        ("sel_sl15_tp30_m2", dict(sl=15, tp=30, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl25_tp50_m2", dict(sl=25, tp=50, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl30_tp60_m2", dict(sl=30, tp=60, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl40_tp80_or60_m1", dict(sl=40, tp=80, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
        ("sel_sl20_tp60_m2", dict(sl=20, tp=60, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl20_tp40_full", dict(sl=20, tp=40, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=60, first_win=False)),
        ("sel_sl20_tp40_m3", dict(sl=20, tp=40, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=3, day_loss=60, first_win=False)),
        ("allgreen_like_m4", dict(sl=15, tp=30, max_or=999, entry_s=10 * 60, entry_e=23 * 60, max_day=4, day_loss=80, first_win=False, confirm=True)),
        ("zero_crude", None),
    ]

    crude_days: dict[str, dict[str, float]] = {}
    for label, kw in crude_grid:
        if kw is None:
            crude_days[label] = {}
            continue
        tr = uh.filter_oos(uh.sim_crude(crude, **kw), CRUDE_FROM)
        crude_days[label] = day_map(tr)
        print(f"crude {label}: days={len(crude_days[label])} trades={len(tr)}")

    # Lot grid — keep realistic for MIS capital
    lot_grid = [
        (1, 1, 1),
        (2, 1, 1),
        (2, 2, 1),
        (2, 2, 2),
        (3, 2, 1),
        (3, 3, 1),
        (3, 3, 2),
        (4, 2, 1),
        (4, 3, 1),
        (4, 4, 1),
        (5, 3, 1),
        (5, 4, 1),
        (5, 5, 1),
        (6, 4, 1),
        (6, 6, 1),
    ]

    # Desk profit-lock / stop applied on combined ₹ (optional)
    risk_grid = [
        ("no_desk_risk", None, None),
        ("lock5k", 5000.0, None),
        ("lock3k", 3000.0, None),
        ("stop2950_lock5k", 5000.0, -2950.0),
        ("stop2k_lock5k", 5000.0, -2000.0),
    ]

    rows = []
    # Cash days with both index + crude MCX history in the sample window.
    index_calendar = {str(d) for d in nifty["days"] if str(d) >= CRUDE_FROM}
    crude_file_days = sorted({str(d) for d in crude["days"] if str(d) >= CRUDE_FROM})
    overlap_days = [d for d in crude_file_days if d in index_calendar]
    print(f"overlap cash days: {len(overlap_days)} ({overlap_days[0]} → {overlap_days[-1]})")

    for trap_label, books in trap_days.items():
        nmap, bmap = books["nifty"], books["bank"]
        for crude_label, cmap in crude_days.items():
            for ln, lb, lc in lot_grid:
                for risk_label, lock, stop in risk_grid:
                    nets = []
                    for d in overlap_days:
                        day_rs = nmap.get(d, 0.0) * ln + bmap.get(d, 0.0) * lb + cmap.get(d, 0.0) * lc
                        # Desk risk: clip continuing beyond lock/stop is approximated by clipping day total
                        # (proxy — real desk stops new entries; winners already banked can exceed slightly)
                        if stop is not None and day_rs < stop:
                            day_rs = stop
                        if lock is not None and day_rs > lock:
                            day_rs = lock
                        nets.append(day_rs)
                    label = f"{trap_label}|{crude_label}|{ln}/{lb}/{lc}|{risk_label}"
                    rows.append(
                        desk_stats(
                            nets,
                            label,
                            dict(
                                trap=trap_label,
                                crude=crude_label,
                                lots=f"{ln}/{lb}/{lc}",
                                risk=risk_label,
                            ),
                        )
                    )

    rows.sort(key=score, reverse=True)

    # Also report: best by P10, best with worst>=0, best ge3 with worst>=-1500
    best_ge3 = rows[0]
    best_p10 = max(rows, key=lambda r: (r["p10"], r["ge3"], r["avg"]))
    non_red = [r for r in rows if r["worst"] >= 0]
    best_non_red = max(non_red, key=score) if non_red else None
    bounded = [r for r in rows if r["worst"] >= -1500]
    best_bounded = max(bounded, key=score) if bounded else None
    # Can we get p10 >= 3000?
    floorish = [r for r in rows if r["p10"] >= TARGET]
    best_floorish = max(floorish, key=score) if floorish else None
    # ge3 >= 90%
    ge90 = [r for r in rows if r["ge3"] >= 90]
    best_ge90 = max(ge90, key=lambda r: (r["worst"], r["p10"], r["avg"])) if ge90 else None

    # Top without desk lock (honest path PnL) among no_desk_risk
    no_lock = [r for r in rows if r["risk"] == "no_desk_risk"]
    no_lock.sort(key=score, reverse=True)

    # Focus shortlist: no_desk_risk, worst>=-2000, prefer ge3
    practical = [
        r
        for r in no_lock
        if r["worst"] >= -2000 and r["lots"] in {"2/2/1", "3/2/1", "3/3/1", "4/3/1", "4/4/1", "5/3/1", "5/4/1", "2/1/1", "1/1/1"}
    ]
    practical.sort(key=score, reverse=True)

    out = {
        "target": TARGET,
        "overlap_days": len(overlap_days),
        "from": overlap_days[0] if overlap_days else None,
        "to": overlap_days[-1] if overlap_days else None,
        "n_configs": len(rows),
        "answer": {
            "hard_floor_p10_ge_3000_exists": best_floorish is not None,
            "best_floorish": best_floorish,
            "best_ge3_overall": best_ge3,
            "best_p10_overall": best_p10,
            "best_non_red": best_non_red,
            "best_bounded_worst_ge_m1500": best_bounded,
            "best_ge90": best_ge90,
            "best_practical_no_lock": practical[:15],
            "best_no_lock_top20": no_lock[:20],
        },
        "top50": rows[:50],
    }
    (OUT / "desk-3k-floor-hunt.json").write_text(json.dumps(out, indent=2))

    print("\n=== ANSWER ===")
    print(f"configs tested: {len(rows)} on {len(overlap_days)} overlap cash days")
    print(f"hard floor (P10≥{TARGET:.0f}) exists: {best_floorish is not None}")
    if best_floorish:
        print("best floorish:", best_floorish)
    print("\nbest ≥3k% overall:", {k: best_ge3[k] for k in ('label','ge3','p10','avg','worst','green')})
    print("best P10 overall:", {k: best_p10[k] for k in ('label','ge3','p10','avg','worst','green')})
    if best_non_red:
        print("best never-red:", {k: best_non_red[k] for k in ('label','ge3','p10','avg','worst','green')})
    if best_ge90:
        print("best ge3≥90:", {k: best_ge90[k] for k in ('label','ge3','p10','avg','worst','green')})
    print("\n=== PRACTICAL (no desk lock, worst≥-2000) TOP 12 ===")
    print(f"{'label':70} {'ge3':>6} {'p10':>8} {'avg':>8} {'worst':>8} {'green':>6}")
    for r in practical[:12]:
        print(f"{r['label'][:70]:70} {r['ge3']:6.1f} {r['p10']:8.1f} {r['avg']:8.1f} {r['worst']:8.1f} {r['green']:6.1f}")
    print(f"\nWrote {OUT / 'desk-3k-floor-hunt.json'}")


if __name__ == "__main__":
    main()
