#!/usr/bin/env python3
"""
1-lot desk hunt — find DNA that lands ₹1,000–₹3,000/day (or ≥₹1k) with lots 1/1/1.

Nifty + Bank Trap + Crude Selective peers. Fixed lots. Wide DNA grid.

  python3 scripts/desk-1lot-1k-3k-hunt.py
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "upgrade_hunt", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

OOS = "2025-01-01"
CRUDE_FROM = "2026-03-23"
LOTS = (1, 1, 1)  # N/B/C — one lot each


def day_map(trades: list[dict]) -> dict[str, float]:
    by: dict[str, float] = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    return dict(by)


def stats(nets: list[float], label: str, meta: dict) -> dict:
    if not nets:
        return dict(label=label, days=0, **meta)
    arr = sorted(nets)
    n = len(arr)
    p10 = arr[max(0, int(0.10 * n) - 1)]
    p25 = arr[max(0, int(0.25 * n) - 1)]
    band = sum(1 for x in arr if 1000 <= x <= 3000) / n * 100
    ge1 = sum(1 for x in arr if x >= 1000) / n * 100
    ge2 = sum(1 for x in arr if x >= 2000) / n * 100
    ge3 = sum(1 for x in arr if x >= 3000) / n * 100
    # "usable" = in 1k-3k OR above 3k (hit the need)
    hit = sum(1 for x in arr if x >= 1000) / n * 100
    return dict(
        label=label,
        days=n,
        avg=round(sum(arr) / n, 1),
        med=round(arr[n // 2], 1),
        green=round(sum(1 for x in arr if x > 0) / n * 100, 1),
        band_1_3k=round(band, 1),
        ge1=round(ge1, 1),
        ge2=round(ge2, 1),
        ge3=round(ge3, 1),
        hit_ge1k=round(hit, 1),
        p10=round(p10, 1),
        p25=round(p25, 1),
        worst=round(min(arr), 1),
        best=round(max(arr), 1),
        zeroish=round(sum(1 for x in arr if abs(x) < 1) / n * 100, 1),
        **meta,
    )


def main() -> None:
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    crude = uh.load(uh.CACHE / "crudeoilm-5m-merged.json", 10)

    # Wide Trap DNA — keep confirm ON in most; also test confirm-off via soft/max only
    # (sim_trap always confirms; "no confirm" would need engine change — skip for now)
    trap_grid: list[tuple[str, dict]] = []
    for pierce in (2, 3, 4, 5, 6, 8):
        for peak_arm, peak_lock, peak_gb in (
            (200, 100, 100),
            (300, 150, 150),
            (400, 200, 200),
            (500, 250, 250),
            (600, 300, 300),
        ):
            for soft in (
                dict(soft_frac=0.35, soft_max_mfe_r=0.55, soft_rs=400),
                dict(soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500),
                dict(soft_frac=0.55, soft_max_mfe_r=0.75, soft_rs=700),
                dict(soft_frac=0, soft_max_mfe_r=0, soft_rs=0),
            ):
                for rr in (2.0, 2.5, 3.0, 3.5, 4.0):
                    for mode in ("both", "trap"):
                        for max_tr in (0, 2, 3):
                            # prune: don't explode — sample key combos
                            if max_tr == 2 and rr not in (3.0, 3.5):
                                continue
                            if mode == "trap" and pierce not in (3, 5) and soft["soft_frac"] not in (0.45, 0):
                                continue
                            if pierce in (2, 6, 8) and soft["soft_frac"] not in (0.45, 0) and rr != 3.5:
                                continue
                            if peak_arm in (200, 500, 600) and soft["soft_frac"] not in (0.45, 0) and rr != 3.5:
                                continue
                            label = (
                                f"p{pierce}_pk{peak_arm}_s{soft['soft_frac']}_rr{rr}_{mode}_m{max_tr}"
                            )
                            trap_grid.append(
                                (
                                    label,
                                    dict(
                                        pierce=pierce,
                                        peak_arm=peak_arm,
                                        peak_lock=peak_lock,
                                        peak_gb=peak_gb,
                                        rr=rr,
                                        mode=mode,
                                        max_trades=max_tr,
                                        **soft,
                                    ),
                                )
                            )

    # Deduplicate labels
    seen = set()
    uniq = []
    for lab, kw in trap_grid:
        if lab in seen:
            continue
        seen.add(lab)
        uniq.append((lab, kw))
    trap_grid = uniq
    print(f"trap configs: {len(trap_grid)}")

    # Extra hand-picked consistency DNA
    extras = [
        ("wired_v151", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5)),
        ("wired_pierce3", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=3)),
        ("tight_daystop40", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, day_stop=40)),
        ("daystop30", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, day_stop=30)),
        ("entry_1000_1400", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, entry_s=10 * 60, entry_e=14 * 60)),
        ("entry_1015_1415", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, entry_s=10 * 60 + 15, entry_e=14 * 60 + 15)),
        ("rr2_peak400_p5", dict(rr=2.0, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5)),
        ("rr15_peak400_p5", dict(rr=1.5, peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5)),
        ("minrisk6_p5", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, min_risk=6, max_risk=24)),
        ("maxrisk20_p5", dict(peak_arm=400, peak_lock=200, peak_gb=200, soft_frac=0.45, soft_max_mfe_r=0.6, soft_rs=500, pierce=5, max_risk=20)),
    ]
    for lab, kw in extras:
        if lab not in seen:
            trap_grid.append((lab, kw))
            seen.add(lab)

    trap_maps: dict[str, tuple[dict[str, float], dict[str, float]]] = {}
    for i, (lab, kw) in enumerate(trap_grid):
        # allow min/max risk overrides in kw
        n_kw = {k: v for k, v in kw.items() if k not in ("min_risk", "max_risk")}
        n_min = kw.get("min_risk", 4)
        n_max = kw.get("max_risk", 28)
        b_min = max(8, int(n_min * 2))
        b_max = max(50, int(n_max * 1.8)) if "max_risk" in kw else 50
        tn = uh.filter_oos(uh.sim_trap(nifty, min_risk=n_min, max_risk=n_max, **n_kw), OOS)
        tb = uh.filter_oos(uh.sim_trap(bank, min_risk=b_min, max_risk=b_max, **n_kw), OOS)
        trap_maps[lab] = (day_map(tn), day_map(tb))
        if (i + 1) % 40 == 0:
            print(f"  trap {i+1}/{len(trap_grid)}")

    crude_grid = [
        ("sel_eve_m2", dict(sl=20, tp=40, max_or=999, entry_s=18 * 60 + 30, entry_e=21 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_full_m2", dict(sl=20, tp=40, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_full_m1", dict(sl=20, tp=40, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=1, day_loss=40, first_win=False)),
        ("sel_sl15_tp30_m2", dict(sl=15, tp=30, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl25_tp50_m2", dict(sl=25, tp=50, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl30_tp60_m2", dict(sl=30, tp=60, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl20_tp60_m2", dict(sl=20, tp=60, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=2, day_loss=40, first_win=False)),
        ("sel_sl10_tp20_m3", dict(sl=10, tp=20, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=3, day_loss=40, first_win=False)),
        ("sel_sl20_tp40_m3", dict(sl=20, tp=40, max_or=999, entry_s=10 * 60, entry_e=22 * 60, max_day=3, day_loss=60, first_win=False)),
        ("sel_or60_classic", dict(sl=40, tp=80, max_or=60, entry_s=18 * 60 + 30, entry_e=22 * 60, max_day=1, day_loss=40)),
        ("zero", None),
    ]
    crude_maps: dict[str, dict[str, float]] = {}
    for lab, kw in crude_grid:
        crude_maps[lab] = {} if kw is None else day_map(uh.filter_oos(uh.sim_crude(crude, **kw), CRUDE_FROM))
        print(f"crude {lab}: days={len(crude_maps[lab])}")

    idx_cal = {str(d) for d in nifty["days"] if str(d) >= CRUDE_FROM}
    crude_cal = sorted({str(d) for d in crude["days"] if str(d) >= CRUDE_FROM})
    ov = [d for d in crude_cal if d in idx_cal]
    # Also full OOS index-only (crude=0) for longer sample
    idx_days = sorted({str(d) for d in nifty["days"] if str(d) >= OOS})
    print(f"overlap={len(ov)} oos_index={len(idx_days)}")

    ln, lb, lc = LOTS
    rows_ov = []
    rows_oos = []

    for tlab, (nm, bm) in trap_maps.items():
        for clab, cm in crude_maps.items():
            nets_ov = [nm.get(d, 0) * ln + bm.get(d, 0) * lb + cm.get(d, 0) * lc for d in ov]
            rows_ov.append(stats(nets_ov, f"{tlab}|{clab}", dict(trap=tlab, crude=clab, universe="overlap")))
            # index-only OOS (ignore crude for long sample; use zero crude)
            if clab == "zero":
                nets_oos = [nm.get(d, 0) * ln + bm.get(d, 0) * lb for d in idx_days]
                rows_oos.append(stats(nets_oos, f"{tlab}|index_only", dict(trap=tlab, crude="index_only", universe="oos_index")))

    # Rank: primary = hit_ge1k, then band_1_3k, then p10, then green, then worst
    def rank_key(r):
        return (r["hit_ge1k"], r["ge2"], r["band_1_3k"], r["p10"], r["green"], r["worst"], r["avg"])

    rows_ov.sort(key=rank_key, reverse=True)
    rows_oos.sort(key=rank_key, reverse=True)

    # Special: P10 >= 1000?
    floor1 = [r for r in rows_ov if r["p10"] >= 1000]
    floor1_oos = [r for r in rows_oos if r["p10"] >= 1000]
    # ge1 >= 80% with worst >= -1500
    consistent = [r for r in rows_ov if r["hit_ge1k"] >= 70 and r["worst"] >= -1500]
    consistent.sort(key=rank_key, reverse=True)
    # Best band concentration (many days IN 1k-3k, not just above)
    band_best = sorted(rows_ov, key=lambda r: (r["band_1_3k"], r["hit_ge1k"], r["p10"]), reverse=True)

    # Desk lock at 3000 on best DNA — does it create a usable 1k-3k band?
    lock_rows = []
    top_traps = list(dict.fromkeys([r["trap"] for r in rows_ov[:30]]))[:12]
    for tlab in top_traps:
        nm, bm = trap_maps[tlab]
        for clab in ("sel_full_m2", "sel_eve_m2", "zero"):
            cm = crude_maps[clab]
            nets = []
            for d in ov:
                x = nm.get(d, 0) * ln + bm.get(d, 0) * lb + cm.get(d, 0) * lc
                if x > 3000:
                    x = 3000.0  # profit lock proxy
                if x < -1500:
                    x = -1500.0
                nets.append(x)
            lock_rows.append(
                stats(nets, f"{tlab}|{clab}|lock3k", dict(trap=tlab, crude=clab, universe="overlap_lock3k"))
            )
    lock_rows.sort(key=rank_key, reverse=True)

    out = {
        "lots": "1/1/1",
        "target": "1000-3000 INR/day",
        "overlap_days": len(ov),
        "oos_index_days": len(idx_days),
        "trap_configs": len(trap_maps),
        "crude_configs": len(crude_maps),
        "n_overlap_rows": len(rows_ov),
        "answer": {
            "p10_ge_1000_overlap_exists": len(floor1) > 0,
            "p10_ge_1000_oos_exists": len(floor1_oos) > 0,
            "best_hit_ge1k_overlap": rows_ov[0],
            "best_band_1_3k_overlap": band_best[0],
            "best_consistent_ge70_worst_m1500": consistent[0] if consistent else None,
            "best_lock3k": lock_rows[0] if lock_rows else None,
            "best_oos_index_only": rows_oos[0] if rows_oos else None,
            "top15_overlap_hit_ge1k": rows_ov[:15],
            "top15_band_1_3k": band_best[:15],
            "top10_oos_index": rows_oos[:10],
            "top10_lock3k": lock_rows[:10],
            "floor1_overlap_top": floor1[:5],
            "floor1_oos_top": floor1_oos[:5],
        },
    }
    (OUT / "desk-1lot-1k-3k-hunt.json").write_text(json.dumps(out, indent=2))

    print("\n=== 1-LOT ANSWER (N/B/C = 1/1/1) ===")
    print(f"configs: {len(rows_ov)} overlap · {len(rows_oos)} oos-index")
    print(f"P10≥₹1000 on overlap: {len(floor1)>0} · on OOS index: {len(floor1_oos)>0}")
    b = rows_ov[0]
    print(
        f"BEST ≥₹1k%: {b['trap']} + {b['crude']} → ge1={b['ge1']}% band1-3k={b['band_1_3k']}% "
        f"ge2={b['ge2']}% ge3={b['ge3']}% p10={b['p10']} avg={b['avg']} worst={b['worst']} green={b['green']}%"
    )
    bb = band_best[0]
    print(
        f"BEST in-band 1-3k: {bb['trap']} + {bb['crude']} → band={bb['band_1_3k']}% ge1={bb['ge1']}% "
        f"p10={bb['p10']} avg={bb['avg']} worst={bb['worst']}"
    )
    if consistent:
        c = consistent[0]
        print(
            f"BEST consistent (≥70% ≥1k, worst≥-1500): {c['trap']} + {c['crude']} → "
            f"ge1={c['ge1']}% p10={c['p10']} avg={c['avg']} worst={c['worst']}"
        )
    if lock_rows:
        L = lock_rows[0]
        print(
            f"BEST with desk lock₹3k: {L['trap']} + {L['crude']} → ge1={L['ge1']}% band={L['band_1_3k']}% "
            f"p10={L['p10']} avg={L['avg']} worst={L['worst']}"
        )
    if rows_oos:
        o = rows_oos[0]
        print(
            f"BEST OOS index-only: {o['trap']} → ge1={o['ge1']}% band={o['band_1_3k']}% "
            f"p10={o['p10']} avg={o['avg']} worst={o['worst']} green={o['green']}%"
        )

    print("\n=== TOP 12 overlap by ≥₹1k% ===")
    print(f"{'trap':40} {'crude':16} {'ge1':>6} {'band':>6} {'ge2':>6} {'p10':>8} {'avg':>8} {'worst':>8}")
    for r in rows_ov[:12]:
        print(
            f"{r['trap'][:40]:40} {r['crude'][:16]:16} {r['ge1']:6.1f} {r['band_1_3k']:6.1f} "
            f"{r['ge2']:6.1f} {r['p10']:8.1f} {r['avg']:8.1f} {r['worst']:8.1f}"
        )
    print(f"\nWrote {OUT / 'desk-1lot-1k-3k-hunt.json'}")


if __name__ == "__main__":
    main()
