#!/usr/bin/env python3
"""
Natural Gas Mini daily-profit DNA hunt.

Default cache: reports/analyst-cache/natgasmini-60m-proxy.json (Yahoo NG=F × 85, ₹50/pt)
Override: CACHE=.../natgasmini-5m-merged.json python3 scripts/natgas-daily-profit-hunt.py

  python3 scripts/natgas-daily-profit-hunt.py
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("CACHE", ROOT / "reports" / "analyst-cache" / "natgasmini-60m-proxy.json"))
META = ROOT / "reports" / "analyst-cache" / "natgasmini-5m-merged.meta.json"
OUT = ROOT / "reports" / "natgas-daily-profit"
OUT.mkdir(parents=True, exist_ok=True)
RS = 50.0
EXIT_M = 23 * 60 + 10


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path) -> dict:
    rows = json.loads(path.read_text())
    for r in rows:
        r["date"] = str(r["date"]).replace("T", " ").split("+")[0]
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"]).replace("T", " ")[11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    ema[49] = float(c[:50].mean())
    for i in range(50, len(c)):
        ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c), path=str(path))


def swing_hl(h, l, i, lb=5):
    start = max(0, i - lb)
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
    return None if pdh < -1e17 else (pdh, pdl)


def orb_hl(days, mins, h, l, i, orb_end=10 * 60):
    day = days[i]
    hi, lo = -1e18, 1e18
    j = i
    while j >= 0 and days[j] == day:
        mm = int(mins[j])
        if 9 * 60 <= mm <= orb_end:
            hi = max(hi, float(h[j]))
            lo = min(lo, float(l[j]))
        j -= 1
    return None if hi < -1e17 else (hi, lo)


def simulate(
    mk,
    *,
    mode,
    sl,
    tp,
    day_loss,
    day_lock,
    max_day,
    first_win,
    entry_s,
    entry_e,
    confirm,
    pierce=0.5,
    max_orb_w=12.0,
    i0=None,
    i1=None,
):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n = mk["n"]
    start = 50 if i0 is None else max(50, i0)
    end = n if i1 is None else min(n, i1)
    trades = []
    pending = open_t = None
    day_net = 0.0
    trades_today = 0
    won = False
    cur = None

    for i in range(start, end):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None

        stopped = day_net <= -day_loss or (day_lock > 0 and day_net >= day_lock) or (first_win and won)

        if open_t is not None:
            d, entry, stop_px, target = open_t["dir"], open_t["entry"], open_t["stop"], open_t["target"]
            exit_px = reason = None
            if d == 1:
                if l[i] <= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif h[i] >= target:
                    exit_px, reason = target, "tp"
            else:
                if h[i] >= stop_px:
                    exit_px, reason = stop_px, "sl"
                elif l[i] <= target:
                    exit_px, reason = target, "tp"
            if exit_px is None and mm >= EXIT_M:
                exit_px, reason = float(c[i]), "eod"
            if exit_px is not None:
                pts = d * (exit_px - entry)
                trades.append({"day": day, "pts": pts, "rs": pts * RS, "reason": reason})
                day_net += pts
                trades_today += 1
                if pts > 0:
                    won = True
                open_t = None
            continue

        if stopped or trades_today >= max_day:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if confirm and not ok:
                continue
            open_t = {"dir": p["dir"], "entry": fill, "stop": fill - p["dir"] * sl, "target": fill + p["dir"] * tp}
            continue

        if not (entry_s <= mm <= entry_e):
            continue

        d = 0
        if mode == "trap":
            if ema[i] != ema[i]:
                continue
            j0 = i
            while j0 > 0 and days[j0 - 1] == day:
                j0 -= 1
            if i - j0 < 3:
                continue
            sh, slv = swing_hl(h, l, i)
            cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
            if ll < slv - pierce and cc > slv and cc > oo and cc > ema[i]:
                d = 1
            elif hh > sh + pierce and cc < sh and cc < oo and cc < ema[i]:
                d = -1
        elif mode == "morning":
            orb = orb_hl(days, mins, h, l, i, 10 * 60)
            if not orb or orb[0] - orb[1] > max_orb_w:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > orb[0] and cc > oo:
                d = 1
            elif cc < orb[1] and cc < oo:
                d = -1
        elif mode == "sor":
            orb = orb_hl(days, mins, h, l, i, 9 * 60 + 30)
            if not orb:
                continue
            w = orb[0] - orb[1]
            if w < 0.4 or w > max_orb_w:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > orb[0] and cc > oo:
                d = 1
            elif cc < orb[1] and cc < oo:
                d = -1
        else:
            levels = prev_day_hl(days, h, l, i)
            if not levels:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > levels[0] and cc > oo:
                d = 1
            elif cc < levels[1] and cc < oo:
                d = -1

        if not d:
            continue
        if confirm:
            pending = {"dir": d, "sig": float(c[i])}
        else:
            fill = float(c[i])
            open_t = {"dir": d, "entry": fill, "stop": fill - d * sl, "target": fill + d * tp}

    return trades


def summarize(trades, label):
    if not trades:
        return {
            "label": label,
            "n": 0,
            "days": 0,
            "net": 0,
            "avg_day": 0,
            "green": 0,
            "non_red": 0,
            "pf": 0,
            "worst_day": 0,
            "score": -1e18,
            "all_green": False,
        }
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
    non_red = float((traded >= 0).mean()) if len(traded) else 0.0
    all_green = bool(len(traded) >= 12 and (traded > 0).all())
    # Prefer high green%, positive avg, enough days, PF — not just rare all-green spikes
    score = (
        green * 1e6
        + non_red * 2e5
        + min(float(nets.mean()), 8000) * 100
        + min(pf, 5) * 1e4
        + min(len(traded), 200) * 50
        + (1e8 if all_green else 0)
    )
    return {
        "label": label,
        "n": len(trades),
        "days": int(len(traded)),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "non_red": round(non_red * 100, 1),
        "pf": round(pf, 2),
        "worst_day": round(float(nets.min()), 0),
        "score": score,
        "all_green": all_green,
    }


def build_configs():
    configs = []
    # Trap / PDHL evening / morning / SOR — tight daily-income style
    for sl, tp in [(1.5, 3), (2, 4), (2, 6), (2.5, 5), (3, 6), (3, 9), (4, 8), (5, 10)]:
        for day_lock in (0, tp, tp * 2):
            for day_loss in (sl, sl * 2, sl * 3):
                for first_win in (True, False):
                    for confirm in (True, False):
                        configs.append(("trap", sl, tp, day_loss, day_lock, 2, first_win, 10 * 60, 22 * 60, confirm, 0.5, 12.0))
                        configs.append(("eve", sl, tp, day_loss, day_lock, 2, first_win, 18 * 60 + 30, 21 * 60, confirm, 0.5, 12.0))
                        configs.append(("morn", sl, tp, day_loss, day_lock, 2, first_win, 10 * 60, 13 * 60, confirm, 0.5, 12.0))
                        configs.append(("sor", sl, tp, day_loss, day_lock, 1, True, 9 * 60 + 35, 22 * 60, confirm, 0.5, 12.0))
    for pierce in (0.3, 0.5, 0.8, 1.2, 2.0):
        for sl, tp in [(1.5, 3), (2, 4), (2.5, 5), (3, 6), (4, 8)]:
            for first_win in (True, False):
                for day_lock in (0, tp):
                    configs.append(("trap", sl, tp, sl * 2, day_lock, 1, first_win, 10 * 60, 22 * 60, True, pierce, 12.0))
                    configs.append(("trap", sl, tp, sl * 2, day_lock, 2, first_win, 14 * 60, 22 * 60, True, pierce, 12.0))
    # Cap if explosion
    if len(configs) > 900:
        configs = configs[::2]
    return configs


def run_grid(mk, configs, tag_suffix=""):
    mode_map = {"trap": "trap", "eve": "evening", "morn": "morning", "sor": "sor"}
    rows = []
    for i, (tag, sl, tp, day_loss, day_lock, max_day, first_win, es, ee, confirm, pierce, ow) in enumerate(configs):
        tr = simulate(
            mk,
            mode=mode_map[tag],
            sl=sl,
            tp=tp,
            day_loss=day_loss,
            day_lock=day_lock,
            max_day=max_day,
            first_win=first_win,
            entry_s=es,
            entry_e=ee,
            confirm=confirm,
            pierce=pierce,
            max_orb_w=ow,
        )
        label = f"{tag}_sl{sl}_tp{tp}_L{day_lock}_S{day_loss}_fw{int(first_win)}_c{int(confirm)}"
        if tag == "trap":
            label += f"_p{pierce}"
        if tag_suffix:
            label += tag_suffix
        rows.append(
            {
                **summarize(tr, label),
                "params": {
                    "tag": tag,
                    "mode": mode_map[tag],
                    "sl": sl,
                    "tp": tp,
                    "day_loss": day_loss,
                    "day_lock": day_lock,
                    "max_day": max_day,
                    "first_win": first_win,
                    "confirm": confirm,
                    "pierce": pierce,
                    "entry_s": es,
                    "entry_e": ee,
                    "max_orb_w": ow,
                },
            }
        )
        if (i + 1) % 80 == 0:
            print(f"  … {i+1}/{len(configs)}", flush=True)
    return rows


def parse_dna(label: str) -> dict:
    # best-effort parse for wire table
    out = {"raw": label}
    parts = label.split("_")
    out["family"] = parts[0]
    for p in parts[1:]:
        if p.startswith("sl"):
            out["sl"] = p[2:]
        elif p.startswith("tp"):
            out["tp"] = p[2:]
        elif p.startswith("L") and p[1:2].isdigit() or (len(p) > 1 and p[0] == "L"):
            out["day_lock"] = p[1:]
        elif p.startswith("S") and p[1:2].replace(".", "").isdigit():
            out["day_loss"] = p[1:]
        elif p.startswith("fw"):
            out["first_win"] = p[2:] == "1"
        elif p.startswith("c") and p[1:].isdigit():
            out["confirm"] = p[1:] == "1"
        elif p.startswith("p"):
            out["pierce"] = p[1:]
    return out


def main():
    mk = load(CACHE)
    meta = json.loads(META.read_text()) if META.exists() else {}
    mid = float(np.nanmedian(mk["c"]))
    print(f"cache={CACHE.name} bars={mk['n']} mid≈{mid:.2f} RS=₹{RS}", flush=True)
    print(f"sample {mk['days'][0]} → {mk['days'][-1]}", flush=True)

    configs = build_configs()
    print(f"configs={len(configs)}", flush=True)
    rows = run_grid(mk, configs)

    # Walk-forward on top candidates (last 30% bars)
    split = int(mk["n"] * 0.7)
    print(f"walk-forward split @ {split} ({mk['days'][split]})", flush=True)

    dailyish = [
        r
        for r in rows
        if r["n"] >= 20 and r["days"] >= 15 and r["avg_day"] > 0 and r["green"] >= 65 and r["pf"] >= 1.2
    ]
    viable = [
        r for r in rows if r["n"] >= 15 and r["days"] >= 12 and r["avg_day"] > 0 and r["green"] >= 58 and r["pf"] >= 1.1
    ]
    if not viable:
        viable = [r for r in rows if r["n"] >= 10 and r["avg_day"] > 0 and r["green"] >= 55]
    if not viable:
        viable = [r for r in rows if r["n"] >= 8 and r["avg_day"] > 0]
    pool = dailyish if dailyish else viable
    pool.sort(key=lambda r: r["score"], reverse=True)

    # OOS refine top 40
    oos_rows = []
    for r in pool[:40]:
        p = r["params"]
        tr = simulate(
            mk,
            mode=p["mode"],
            sl=p["sl"],
            tp=p["tp"],
            day_loss=p["day_loss"],
            day_lock=p["day_lock"],
            max_day=p["max_day"],
            first_win=p["first_win"],
            entry_s=p["entry_s"],
            entry_e=p["entry_e"],
            confirm=p["confirm"],
            pierce=p["pierce"],
            max_orb_w=p["max_orb_w"],
            i0=split,
        )
        s = summarize(tr, r["label"] + "_OOS")
        oos_rows.append({**s, "params": p, "is_label": r["label"], "is_green": r["green"], "is_avg": r["avg_day"]})
    oos_ok = [r for r in oos_rows if r["n"] >= 5 and r["avg_day"] > 0 and r["green"] >= 55]
    oos_ok.sort(key=lambda r: (r["green"], r["avg_day"], r["pf"]), reverse=True)

    # Champion: prefer OOS-ok, else best in-sample dailyish/viable
    if oos_ok:
        champ_oos = oos_ok[0]
        champ = next(r for r in pool if r["label"] == champ_oos["is_label"])
        champ_note = "Selected by OOS green% among top in-sample daily-profit candidates."
    else:
        champ = pool[0]
        champ_note = "No strong OOS survivor — best in-sample only (use with caution)."
        champ_oos = None

    top = pool[:20]
    summary = {
        "sample": f"{mk['days'][0]} → {mk['days'][-1]}",
        "cache": str(CACHE),
        "source": meta.get("source"),
        "warning": meta.get("warning"),
        "bars": int(mk["n"]),
        "mid_price": round(mid, 2),
        "rupees_per_point": RS,
        "configs_tested": len(configs),
        "dailyish_count": len(dailyish),
        "top": [{k: v for k, v in r.items() if k != "params"} for r in top],
        "oos_top": [{k: v for k, v in r.items() if k != "params"} for r in oos_ok[:10]],
        "wired_candidate": {k: v for k, v in champ.items() if k != "params"},
        "wired_params": champ["params"],
        "wired_oos": {k: v for k, v in champ_oos.items() if k != "params"} if champ_oos else None,
        "selection_note": champ_note,
        "dna": {
            "instrument": "NATGASMINI",
            "rupees_per_point": 50,
            "label": champ["label"],
            "params": champ["params"],
            "map_to_desk": "Experiments → Nat Gas Mini → Trap/PDHL style with confirm + first-win lock as wired",
            "notes": "Proxy Yahoo NG=F×85. Refresh .kite-auth + fetch-natgasmini-history.ts before live.",
        },
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))

    lines = [
        f"{'book':<72} {'n':>4} {'d':>3} {'net':>8} {'₹/d':>6} {'g%':>5} {'nr%':>5} {'pf':>5} {'worst':>7}"
    ]
    for r in top[:15]:
        tag = " ★" if r.get("all_green") else ""
        lines.append(
            f"{r['label']:<72} {r['n']:4d} {r['days']:3d} {r['net']:8.0f} {r['avg_day']:6.0f} "
            f"{r['green']:4.1f}% {r['non_red']:4.1f}% {r['pf']:5.2f} {r.get('worst_day', 0):7.0f}{tag}"
        )

    oos_lines = []
    for r in oos_ok[:8]:
        oos_lines.append(
            f"{r['is_label']:<72} OOS n={r['n']} d={r['days']} ₹/d={r['avg_day']} g%={r['green']} pf={r['pf']}"
        )

    p = champ["params"]
    wire_human = (
        f"Family **{p['tag']}** ({p['mode']}) · SL **{p['sl']} pts** (₹{p['sl']*RS:.0f}) · "
        f"TP **{p['tp']} pts** (₹{p['tp']*RS:.0f}) · confirm={'ON' if p['confirm'] else 'OFF'} · "
        f"first-win={'ON' if p['first_win'] else 'OFF'} · day_lock={p['day_lock']} · "
        f"day_loss={p['day_loss']} · max_trades/day={p['max_day']}"
    )
    if p["tag"] == "trap":
        wire_human += f" · pierce={p['pierce']}"

    report = (
        "# Natural Gas Mini — daily-profit DNA hunt\n\n"
        f"Sample **{summary['sample']}** · bars {summary['bars']} · mid ≈ {summary['mid_price']} · ₹{RS}/pt\n\n"
        f"Cache: `{CACHE.name}`\n\n"
        f"Source: {summary.get('source')}\n\n"
        f"{('> ⚠️ ' + summary['warning'] + '\n\n') if summary.get('warning') else ''}"
        f"Configs tested: **{len(configs)}** · daily-profit-ish (≥65% green, ≥15 days): **{len(dailyish)}**\n\n"
        "## In-sample top\n\n"
        "```\n" + "\n".join(lines) + "\n```\n\n"
        "## Walk-forward (last 30%) survivors\n\n"
        + ("```\n" + "\n".join(oos_lines) + "\n```\n\n" if oos_lines else "_None cleared OOS bar._\n\n")
        + f"## Wire candidate\n\n"
        f"**`{champ['label']}`**\n\n"
        f"{wire_human}\n\n"
        f"- In-sample: green **{champ['green']}%** · non-red **{champ['non_red']}%** · ₹/day **{champ['avg_day']}** · "
        f"PF **{champ['pf']}** · days **{champ['days']}** · worst **{champ.get('worst_day')}**\n"
        + (
            f"- OOS: green **{champ_oos['green']}%** · ₹/day **{champ_oos['avg_day']}** · PF **{champ_oos['pf']}** · days **{champ_oos['days']}**\n"
            if champ_oos
            else ""
        )
        + f"\n_{champ_note}_\n"
    )
    (OUT / "README.md").write_text(report)
    print(report, flush=True)
    print("WIRE", champ["label"], flush=True)


if __name__ == "__main__":
    main()
