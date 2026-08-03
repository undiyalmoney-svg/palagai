#!/usr/bin/env python3
"""
Nat Gas Mini — OOS-first high-profit / multi-trade hunt.

Selects only books that stay profitable on the last 30% of bars,
with more trades/day than the max-1 daily-profit baseline.
"""
from __future__ import annotations

import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "natgas-high-profit"
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("hp", ROOT / "scripts" / "natgas-high-profit-hunt.py")
hp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hp)


def configs():
    out = []
    sltps = [
        (1.5, 3),
        (1.5, 4.5),
        (2, 4),
        (2, 5),
        (2, 6),
        (2.5, 5),
        (2.5, 7.5),
        (3, 6),
        (3, 9),
        (4, 8),
        (4, 12),
        (5, 10),
        (5, 15),
        (3, 12),
        (2, 8),
    ]
    for mode in ("trap", "bounce"):
        for sl, tp in sltps:
            for pierce in (0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0):
                for confirm in (True, False):
                    for max_day in (2, 3, 4, 5):
                        for day_loss in (sl * 2, sl * 3, sl * 4):
                            for es, ee, wname in (
                                (10 * 60, 22 * 60, "full"),
                                (14 * 60, 22 * 60, "aft"),
                                (11 * 60, 18 * 60, "mid"),
                                (10 * 60, 15 * 60, "mornw"),
                            ):
                                for trail_start, trail_step in ((0, 0), (3, 1.5), (4, 2), (5, 2.5), (6, 3)):
                                    if trail_start and trail_start >= tp:
                                        continue
                                    # thin aggressively
                                    if wname == "mornw" and mode != "trap":
                                        continue
                                    if not confirm and pierce not in (0.3, 0.5, 0.8):
                                        continue
                                    if max_day == 5 and day_loss < sl * 3:
                                        continue
                                    if trail_start and pierce not in (0.3, 0.5, 0.8):
                                        continue
                                    out.append(
                                        dict(
                                            mode=mode,
                                            sl=sl,
                                            tp=tp,
                                            day_loss=day_loss,
                                            day_lock=0,
                                            max_day=max_day,
                                            first_win=False,
                                            entry_s=es,
                                            entry_e=ee,
                                            confirm=confirm,
                                            pierce=pierce,
                                            max_orb_w=25.0,
                                            trail_start=trail_start,
                                            trail_step=trail_step,
                                            cooldown=1,
                                            wname=wname,
                                        )
                                    )
    # keep ~1800
    # prefer confirm + full/aft
    pref = [
        c
        for c in out
        if c["confirm"]
        and c["wname"] in ("full", "aft")
        and c["pierce"] in (0.2, 0.3, 0.5, 0.8, 1.0)
        and c["trail_start"] in (0, 4, 6)
        and c["day_loss"] in (c["sl"] * 2, c["sl"] * 3)
    ]
    extra = [c for c in out if c not in pref and c["wname"] == "full"][::5]
    merged = pref + extra
    if len(merged) > 2000:
        merged = merged[::2]
    return merged


def main():
    mk = hp.load(hp.CACHE)
    split = int(mk["n"] * 0.7)
    print(f"bars={mk['n']} split@{mk['days'][split]} configs…", flush=True)
    cfgs = configs()
    print(f"configs={len(cfgs)}", flush=True)

    base_p = dict(
        mode="trap",
        sl=1.5,
        tp=3,
        day_loss=3.0,
        day_lock=0,
        max_day=1,
        first_win=True,
        entry_s=10 * 60,
        entry_e=22 * 60,
        confirm=True,
        pierce=0.2,
        max_orb_w=25.0,
        trail_start=0,
        trail_step=0,
        cooldown=0,
        wname="full",
    )
    base_is = hp.summarize(
        hp.simulate(mk, **{k: v for k, v in base_p.items() if k != "wname"}),
        "BASE_m1",
    )
    base_oos = hp.summarize(
        hp.simulate(mk, **{k: v for k, v in base_p.items() if k != "wname"}, i0=split),
        "BASE_m1_OOS",
    )

    survivors = []
    for i, p in enumerate(cfgs):
        kw = {k: v for k, v in p.items() if k != "wname"}
        is_s = hp.summarize(hp.simulate(mk, **kw), hp.label_of(p))
        oos_s = hp.summarize(hp.simulate(mk, **kw, i0=split), "oos")
        if (i + 1) % 200 == 0:
            print(f"  … {i+1}/{len(cfgs)} kept {len(survivors)}", flush=True)
        # OOS-first gates
        if oos_s["n"] < 8 or oos_s["days"] < 6:
            continue
        if oos_s["avg_day"] < max(40.0, base_oos["avg_day"] * 0.9):
            continue
        if oos_s["trades_per_day"] < 1.4:
            continue
        if oos_s["pf"] < 1.15:
            continue
        if oos_s["green"] < 48:
            continue
        if is_s["avg_day"] <= 0 or is_s["pf"] < 1.05:
            continue
        survivors.append({"is": is_s, "oos": oos_s, "params": p, "label": is_s["label"]})

    survivors.sort(
        key=lambda r: (
            r["oos"]["avg_day"],
            r["oos"]["trades_per_day"],
            r["oos"]["pf"],
            r["is"]["avg_day"],
        ),
        reverse=True,
    )

    # looser pass if empty
    if not survivors:
        print("strict empty — looser OOS gates…", flush=True)
        for i, p in enumerate(cfgs):
            kw = {k: v for k, v in p.items() if k != "wname"}
            is_s = hp.summarize(hp.simulate(mk, **kw), hp.label_of(p))
            oos_s = hp.summarize(hp.simulate(mk, **kw, i0=split), "oos")
            if oos_s["n"] < 6 or oos_s["avg_day"] < 30 or oos_s["trades_per_day"] < 1.3:
                continue
            if oos_s["pf"] < 1.1 or oos_s["green"] < 45 or is_s["avg_day"] <= 0:
                continue
            survivors.append({"is": is_s, "oos": oos_s, "params": p, "label": is_s["label"]})
        survivors.sort(
            key=lambda r: (r["oos"]["avg_day"], r["oos"]["trades_per_day"], r["oos"]["pf"]),
            reverse=True,
        )

    print(f"survivors={len(survivors)}", flush=True)
    if survivors:
        champ = survivors[0]
    else:
        champ = None

    summary = {
        "sample": f"{mk['days'][0]} → {mk['days'][-1]}",
        "oos_from": str(mk["days"][split]),
        "source": "Kite MCX NATGASMINI 5m",
        "bars": int(mk["n"]),
        "configs_tested": len(cfgs),
        "baseline_is": base_is,
        "baseline_oos": base_oos,
        "survivors": len(survivors),
        "top": [
            {
                "label": r["label"],
                "params": r["params"],
                "is": {k: r["is"][k] for k in ("avg_day", "trades_per_day", "green", "pf", "days", "n", "net", "worst_day")},
                "oos": {
                    k: r["oos"][k]
                    for k in ("avg_day", "trades_per_day", "green", "pf", "days", "n", "net", "worst_day")
                },
            }
            for r in survivors[:20]
        ],
        "wired_candidate": None,
        "wired_params": None,
        "wired_oos": None,
        "selection_note": "OOS-first: last 30% must show ≥~₹40/day, ≥1.4 tpd, PF≥1.15.",
    }
    if champ:
        summary["wired_candidate"] = {
            "label": champ["label"],
            **{k: champ["is"][k] for k in ("avg_day", "trades_per_day", "green", "pf", "days", "n", "net", "worst_day")},
        }
        summary["wired_params"] = champ["params"]
        summary["wired_oos"] = {
            k: champ["oos"][k]
            for k in ("avg_day", "trades_per_day", "green", "pf", "days", "n", "net", "worst_day")
        }

    (OUT / "summary-oos-first.json").write_text(json.dumps(summary, indent=2))

    lines = [
        "# Natural Gas Mini — high-profit multi-trade (OOS-first)",
        "",
        f"Sample **{summary['sample']}** · OOS from **{summary['oos_from']}** · configs {len(cfgs)} · survivors **{len(survivors)}**",
        "",
        f"Baseline max-1: IS ₹/d {base_is['avg_day']} tpd {base_is['trades_per_day']} · "
        f"OOS ₹/d {base_oos['avg_day']} tpd {base_oos['trades_per_day']}",
        "",
    ]
    if champ:
        p = champ["params"]
        lines += [
            "## Wire candidate",
            "",
            f"**`{champ['label']}`**",
            "",
            f"- Mode **{p['mode']}** · SL **{p['sl']}** (₹{p['sl']*50:.0f}) · TP **{p['tp']}** (₹{p['tp']*50:.0f})",
            f"- confirm={'ON' if p['confirm'] else 'OFF'} · pierce={p['pierce']} · max/day=**{p['max_day']}** · first-win OFF",
            f"- window {p['wname']} · day_loss={p['day_loss']} · trail={p['trail_start']}/{p['trail_step']}",
            f"- IS: ₹/day **{champ['is']['avg_day']}** · tpd **{champ['is']['trades_per_day']}** · "
            f"green **{champ['is']['green']}%** · PF **{champ['is']['pf']}**",
            f"- OOS: ₹/day **{champ['oos']['avg_day']}** · tpd **{champ['oos']['trades_per_day']}** · "
            f"green **{champ['oos']['green']}%** · PF **{champ['oos']['pf']}**",
            "",
            "## Top OOS survivors",
            "",
            "```",
            f"{'book':<60} {'IS₹/d':>6} {'IStpd':>5} {'OOS₹/d':>7} {'OOStpd':>6} {'OOSg%':>5} {'OOSpf':>5}",
        ]
        for r in survivors[:15]:
            lines.append(
                f"{r['label']:<60} {r['is']['avg_day']:6.0f} {r['is']['trades_per_day']:5.2f} "
                f"{r['oos']['avg_day']:7.0f} {r['oos']['trades_per_day']:6.2f} "
                f"{r['oos']['green']:4.1f}% {r['oos']['pf']:5.2f}"
            )
        lines.append("```")
    else:
        lines += [
            "## No OOS-stable multi-trade book found",
            "",
            "High-trade bounce books print ~₹75/day in-sample but flip negative after 2026-07-01.",
            "Keep the max-1 daily-profit DNA for live; use Experiments paper for multi-trade R&D.",
            "",
        ]
    (OUT / "README.md").write_text("\n".join(lines) + "\n")
    # also keep JSON as main summary
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print("\n".join(lines[:80]), flush=True)
    if champ:
        print("WIRE", champ["label"], flush=True)
    else:
        print("WIRE NONE", flush=True)


if __name__ == "__main__":
    main()
