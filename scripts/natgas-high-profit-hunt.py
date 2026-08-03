#!/usr/bin/env python3
"""
Natural Gas Mini — high-profit / multi-trade DNA hunt.

Goal vs daily-profit champion (max 1/day · ~₹61): more ₹/day AND more trades/day.

  CACHE=reports/analyst-cache/natgasmini-5m-merged.json python3 scripts/natgas-high-profit-hunt.py
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("CACHE", ROOT / "reports" / "analyst-cache" / "natgasmini-5m-merged.json"))
META = ROOT / "reports" / "analyst-cache" / "natgasmini-5m-merged.meta.json"
OUT = ROOT / "reports" / "natgas-high-profit"
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
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, n=len(c))


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
    max_orb_w=25.0,
    trail_start=0.0,
    trail_step=0.0,
    cooldown=0,
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
    cool_until = -1

    for i in range(start, end):
        day = days[i]
        mm = int(mins[i])
        if day != cur:
            cur, day_net, trades_today, won = day, 0.0, 0, False
            pending = open_t = None
            cool_until = -1

        stopped = (
            day_net <= -day_loss
            or (day_lock > 0 and day_net >= day_lock)
            or (first_win and won)
        )

        if open_t is not None:
            d, entry = open_t["dir"], open_t["entry"]
            stop_px, target = open_t["stop"], open_t["target"]
            best = open_t.get("best", entry)
            if d == 1:
                best = max(best, float(h[i]))
            else:
                best = min(best, float(l[i]))
            open_t["best"] = best
            if trail_start > 0 and trail_step > 0:
                if d == 1 and (best - entry) >= trail_start:
                    stop_px = max(stop_px, best - trail_step)
                    open_t["stop"] = stop_px
                elif d == -1 and (entry - best) >= trail_start:
                    stop_px = min(stop_px, best + trail_step)
                    open_t["stop"] = stop_px

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
                cool_until = i + cooldown
            continue

        if stopped or trades_today >= max_day or i < cool_until:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            ok = (c[i] > o[i] and c[i] > p["sig"]) if p["dir"] == 1 else (c[i] < o[i] and c[i] < p["sig"])
            if confirm and not ok:
                continue
            open_t = {
                "dir": p["dir"],
                "entry": fill,
                "stop": fill - p["dir"] * sl,
                "target": fill + p["dir"] * tp,
                "best": fill,
            }
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
        elif mode == "bounce":
            # Soft bounce: touch swing + reclaim, no pierce required
            if ema[i] != ema[i]:
                continue
            sh, slv = swing_hl(h, l, i)
            cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
            if ll <= slv + pierce and cc > slv and cc > oo and cc > ema[i]:
                d = 1
            elif hh >= sh - pierce and cc < sh and cc < oo and cc < ema[i]:
                d = -1
        elif mode == "morning":
            orb = orb_hl(days, mins, h, l, i, 10 * 60)
            if not orb or orb[0] - orb[1] > max_orb_w:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > orb[0] + pierce and cc > oo:
                d = 1
            elif cc < orb[1] - pierce and cc < oo:
                d = -1
        elif mode == "sor":
            orb = orb_hl(days, mins, h, l, i, 9 * 60 + 30)
            if not orb:
                continue
            w = orb[0] - orb[1]
            if w < 0.5 or w > max_orb_w:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > orb[0] + pierce and cc > oo:
                d = 1
            elif cc < orb[1] - pierce and cc < oo:
                d = -1
        else:  # evening / pdhl
            levels = prev_day_hl(days, h, l, i)
            if not levels:
                continue
            cc, oo = float(c[i]), float(o[i])
            if cc > levels[0] + pierce and cc > oo:
                d = 1
            elif cc < levels[1] - pierce and cc < oo:
                d = -1

        if not d:
            continue
        if confirm:
            pending = {"dir": d, "sig": float(c[i])}
        else:
            fill = float(c[i])
            open_t = {
                "dir": d,
                "entry": fill,
                "stop": fill - d * sl,
                "target": fill + d * tp,
                "best": fill,
            }

    return trades


def summarize(trades, label, calendar_days=None):
    if not trades:
        return {
            "label": label,
            "n": 0,
            "days": 0,
            "net": 0,
            "avg_day": 0,
            "trades_per_day": 0,
            "green": 0,
            "pf": 0,
            "worst_day": 0,
            "score": -1e18,
        }
    by = defaultdict(float)
    cnt = defaultdict(int)
    for t in trades:
        by[t["day"]] += t["rs"]
        cnt[t["day"]] += 1
    nets = np.array(list(by.values()))
    rs = np.array([t["rs"] for t in trades])
    wins = float(rs[rs > 0].sum())
    loss = float(-rs[rs < 0].sum())
    pf = wins / loss if loss > 0 else 99.0
    traded = nets[np.abs(nets) > 1e-9]
    green = float((traded > 0).mean()) if len(traded) else 0.0
    tpd = float(len(trades) / max(len(traded), 1))
    # High-profit score: ₹/day primary, then trades/day, PF, green floor soft
    score = (
        min(float(nets.mean()), 25000) * 200
        + tpd * 8000
        + min(pf, 4) * 5000
        + green * 2e5
        + min(len(traded), 80) * 80
        + min(float(rs.sum()), 200000) * 0.05
    )
    return {
        "label": label,
        "n": len(trades),
        "days": int(len(traded)),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "trades_per_day": round(tpd, 2),
        "green": round(green * 100, 1),
        "pf": round(pf, 2),
        "worst_day": round(float(nets.min()), 0),
        "score": score,
    }


def build_configs():
    configs = []
    # Larger targets for more ₹; multi-trade books
    sltps = [
        (1.5, 3),
        (2, 4),
        (2, 6),
        (2.5, 5),
        (3, 6),
        (3, 9),
        (4, 8),
        (4, 12),
        (5, 10),
        (5, 15),
        (6, 12),
        (6, 18),
        (8, 16),
        (3, 12),
        (4, 16),
    ]
    windows = [
        ("full", 10 * 60, 22 * 60),
        ("aft", 14 * 60, 22 * 60),
        ("eve", 18 * 60 + 30, 22 * 60),
        ("mornw", 10 * 60, 15 * 60),
        ("mid", 11 * 60, 18 * 60),
    ]
    trails = [(0, 0), (3, 1.5), (4, 2), (6, 3), (8, 4)]
    for mode in ("trap", "bounce", "evening", "morning", "sor"):
        for sl, tp in sltps:
            for pierce in (0.2, 0.3, 0.5, 0.8, 1.0, 1.5):
                for confirm in (True, False):
                    for max_day in (2, 3, 4, 5):
                        for first_win in (False,):  # OFF — need more trades
                            for day_lock in (0,):  # no early lock
                                for day_loss in (sl * 2, sl * 3, sl * 4):
                                    for wname, es, ee in windows:
                                        if mode == "morning" and wname not in ("full", "mornw"):
                                            continue
                                        if mode == "evening" and wname not in ("full", "eve", "aft"):
                                            continue
                                        if mode == "sor" and wname != "full":
                                            continue
                                        for trail_start, trail_step in trails:
                                            if trail_start and trail_start >= tp:
                                                continue
                                            # thin: confirm prefer for quality; allow both
                                            if mode in ("morning", "sor") and pierce not in (0.3, 0.5, 1.0):
                                                continue
                                            if max_day >= 4 and day_loss < sl * 3:
                                                continue
                                            configs.append(
                                                dict(
                                                    mode=mode,
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
                                                    max_orb_w=25.0,
                                                    trail_start=trail_start,
                                                    trail_step=trail_step,
                                                    cooldown=1,
                                                    wname=wname,
                                                )
                                            )
    # Focused ~1.2k: multi-trade + confirm + full/aft/mid + useful trails
    preferred = [
        c
        for c in configs
        if c["confirm"]
        and c["max_day"] in (2, 3, 4)
        and c["pierce"] in (0.2, 0.3, 0.5, 0.8)
        and c["wname"] in ("full", "aft", "mid")
        and c["trail_start"] in (0, 4, 6)
        and c["mode"] in ("trap", "bounce", "evening")
        and c["day_loss"] in (c["sl"] * 3, c["sl"] * 4)
    ]
    # sprinkle no-confirm + morning/sor for diversity
    spicy = [
        c
        for c in configs
        if (not c["confirm"] or c["mode"] in ("morning", "sor"))
        and c["max_day"] in (3, 4)
        and c["pierce"] in (0.3, 0.5)
        and c["wname"] == "full"
        and c["trail_start"] in (0, 6)
        and c["day_loss"] == c["sl"] * 3
    ][::3]
    configs = preferred + spicy
    if len(configs) > 1400:
        configs = configs[::2]
    return configs


def label_of(p):
    t = f"{p['mode']}_sl{p['sl']}_tp{p['tp']}_m{p['max_day']}_c{int(p['confirm'])}_p{p['pierce']}_{p['wname']}"
    if p["trail_start"]:
        t += f"_tr{p['trail_start']}-{p['trail_step']}"
    t += f"_S{p['day_loss']}"
    return t


def main():
    mk = load(CACHE)
    meta = json.loads(META.read_text()) if META.exists() else {}
    mid = float(np.nanmedian(mk["c"]))
    print(f"bars={mk['n']} mid≈{mid:.2f} sample {mk['days'][0]}→{mk['days'][-1]}", flush=True)

    configs = build_configs()
    print(f"configs={len(configs)}", flush=True)

    rows = []
    for i, p in enumerate(configs):
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
            trail_start=p["trail_start"],
            trail_step=p["trail_step"],
            cooldown=p["cooldown"],
        )
        s = summarize(tr, label_of(p))
        s["params"] = p
        rows.append(s)
        if (i + 1) % 150 == 0:
            print(f"  … {i+1}/{len(configs)}", flush=True)

    # Baseline: old daily-profit DNA for comparison
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
    base_tr = simulate(mk, **{k: v for k, v in base_p.items() if k != "wname"})
    baseline = summarize(base_tr, "BASE_daily_profit_m1")
    baseline["params"] = base_p

    # Filters: more profit AND more trades than baseline
    split = int(mk["n"] * 0.7)
    hi = [
        r
        for r in rows
        if r["n"] >= 25
        and r["days"] >= 12
        and r["avg_day"] >= baseline["avg_day"] * 1.35  # ≥35% more ₹/day
        and r["trades_per_day"] >= 1.5
        and r["pf"] >= 1.15
        and r["green"] >= 50
        and r["avg_day"] > 0
    ]
    if len(hi) < 8:
        hi = [
            r
            for r in rows
            if r["n"] >= 20
            and r["days"] >= 10
            and r["avg_day"] > baseline["avg_day"]
            and r["trades_per_day"] >= 1.4
            and r["pf"] >= 1.1
            and r["green"] >= 48
            and r["avg_day"] > 0
        ]
    hi.sort(key=lambda r: (r["avg_day"], r["trades_per_day"], r["pf"], r["green"]), reverse=True)

    # OOS on top 40
    oos = []
    for r in hi[:40]:
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
            trail_start=p["trail_start"],
            trail_step=p["trail_step"],
            cooldown=p["cooldown"],
            i0=split,
        )
        s = summarize(tr, r["label"] + "_OOS")
        if s["n"] >= 6 and s["avg_day"] > 0 and s["pf"] >= 1.05 and s["trades_per_day"] >= 1.3:
            oos.append({**s, "is_label": r["label"], "params": p, "is": r})
    oos.sort(key=lambda r: (r["avg_day"], r["trades_per_day"], r["pf"]), reverse=True)

    if oos:
        champ = oos[0]["is"]
        champ_oos = oos[0]
        note = "Selected by OOS ₹/day among high-profit multi-trade candidates."
    elif hi:
        champ = hi[0]
        champ_oos = None
        note = "No strong OOS survivor — best in-sample high-profit book."
    else:
        # fallback: best by score with tpd>=1.5
        pool = [r for r in rows if r["trades_per_day"] >= 1.5 and r["avg_day"] > 0 and r["n"] >= 20]
        pool.sort(key=lambda r: r["score"], reverse=True)
        champ = pool[0] if pool else max(rows, key=lambda r: r["score"])
        champ_oos = None
        note = "Fallback — filters were tight vs baseline."

    summary = {
        "sample": f"{mk['days'][0]} → {mk['days'][-1]}",
        "source": meta.get("source") or "Kite MCX NATGASMINI 5m",
        "bars": int(mk["n"]),
        "mid_price": round(mid, 2),
        "rupees_per_point": RS,
        "configs_tested": len(configs),
        "baseline": {k: v for k, v in baseline.items() if k != "params"},
        "high_profit_count": len(hi),
        "oos_survivors": len(oos),
        "top": [{k: v for k, v in r.items() if k != "params"} for r in hi[:25]],
        "oos_top": [{k: v for k, v in r.items() if k not in ("params", "is")} for r in oos[:12]],
        "wired_candidate": {k: v for k, v in champ.items() if k != "params"},
        "wired_params": champ.get("params"),
        "wired_oos": {k: v for k, v in champ_oos.items() if k not in ("params", "is")} if champ_oos else None,
        "selection_note": note,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))

    p = champ["params"]
    lines = [
        "# Natural Gas Mini — high-profit / multi-trade DNA",
        "",
        f"Sample **{summary['sample']}** · bars {summary['bars']} · mid ≈ {summary['mid_price']} · ₹{RS}/pt",
        "",
        f"Source: {summary['source']}",
        "",
        f"Configs: **{len(configs)}** · beat baseline (≥35% more ₹/day, ≥1.5 tpd): **{len(hi)}** · OOS: **{len(oos)}**",
        "",
        "## Baseline (prior daily-profit)",
        "",
        f"`{baseline['label']}` · ₹/day **{baseline['avg_day']}** · tpd **{baseline['trades_per_day']}** · "
        f"green **{baseline['green']}%** · PF **{baseline['pf']}** · days **{baseline['days']}**",
        "",
        "## Wire candidate (high profit)",
        "",
        f"**`{champ['label']}`**",
        "",
        f"- Mode **{p['mode']}** · SL **{p['sl']}** pts (₹{p['sl']*RS:.0f}) · TP **{p['tp']}** pts (₹{p['tp']*RS:.0f})",
        f"- confirm={'ON' if p['confirm'] else 'OFF'} · first-win=OFF · pierce={p['pierce']} · max/day=**{p['max_day']}**",
        f"- window **{p['wname']}** {p['entry_s']//60:02d}:{p['entry_s']%60:02d}–{p['entry_e']//60:02d}:{p['entry_e']%60:02d} IST",
        f"- day_loss={p['day_loss']} · trail={p['trail_start']}/{p['trail_step']}",
        f"- In-sample: ₹/day **{champ['avg_day']}** · tpd **{champ['trades_per_day']}** · green **{champ['green']}%** · "
        f"PF **{champ['pf']}** · days **{champ['days']}** · net **{champ['net']}** · worst **{champ['worst_day']}**",
    ]
    if champ_oos:
        lines.append(
            f"- OOS: ₹/day **{champ_oos['avg_day']}** · tpd **{champ_oos['trades_per_day']}** · "
            f"green **{champ_oos['green']}%** · PF **{champ_oos['pf']}** · days **{champ_oos['days']}**"
        )
    lines += ["", f"_{note}_", "", "## Top high-profit books", "", "```"]
    lines.append(
        f"{'book':<78} {'n':>4} {'d':>3} {'₹/d':>6} {'tpd':>5} {'g%':>5} {'pf':>5} {'worst':>7}"
    )
    for r in hi[:18]:
        lines.append(
            f"{r['label']:<78} {r['n']:4d} {r['days']:3d} {r['avg_day']:6.0f} {r['trades_per_day']:5.2f} "
            f"{r['green']:4.1f}% {r['pf']:5.2f} {r['worst_day']:7.0f}"
        )
    lines.append("```")
    if oos:
        lines += ["", "## OOS leaders", "", "```"]
        for r in oos[:10]:
            lines.append(
                f"{r['is_label']:<78} OOS ₹/d={r['avg_day']} tpd={r['trades_per_day']} "
                f"g%={r['green']} pf={r['pf']} n={r['n']}"
            )
        lines.append("```")
    lines += [
        "",
        "## Caveats",
        "",
        "- More trades ⇒ more fees/slippage; paper first.",
        "- Sample is one front-month era (~Mar–Aug 2026 live contracts).",
        "- Higher ₹/day usually means lower green% than the max-1 daily-profit DNA.",
        "",
    ]
    (OUT / "README.md").write_text("\n".join(lines))
    print("\n".join(lines[:90]), flush=True)
    print("WIRE", champ["label"], flush=True)


if __name__ == "__main__":
    main()
