#!/usr/bin/env python3
"""
Trap wide-range day research — Jul quiet vs Aug directional.

Compares wired pierce10 peak150 softOFF rr2 confirm vs:
  - pierce bumps
  - Bank-specific pierce
  - OR-scaled bounce pierce
  - counter-trend skips / confirm-off (negative controls)

  python3 scripts/trap-wide-range-day-research.py

Writes: reports/daily-profit-research/trap-wide-range-day-answer.json
See: docs/owner-private/45-TRAP-WIDE-RANGE-DAYS.md
"""
from __future__ import annotations

import importlib.util
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "daily-profit-research"
OUT.mkdir(parents=True, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "uh", ROOT / "scripts" / "daily-profit-upgrade-hunt.py"
)
uh = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(uh)

EXIT_IDX = 15 * 60 + 15
CHARGE = 40.0
QUIET = ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"]
WIDE = ["2026-08-03", "2026-08-04"]


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


def day_feats(mk, day):
    idx = [i for i, d in enumerate(mk["days"]) if str(d) == day]
    if not idx:
        return None
    o, h, l, c, mins = mk["o"], mk["h"], mk["l"], mk["c"], mk["mins"]
    sess = [i for i in idx if 9 * 60 + 15 <= int(mins[i]) <= 15 * 60 + 30]
    if not sess:
        return None
    or_bars = [i for i in sess if int(mins[i]) <= 9 * 60 + 45]
    day_o = float(o[sess[0]])
    day_c = float(c[sess[-1]])
    day_hi = float(h[sess].max())
    day_lo = float(l[sess].min())
    or_w = (
        float(h[or_bars].max()) - float(l[or_bars].min()) if or_bars else day_hi - day_lo
    )
    rng = day_hi - day_lo
    ret = day_c - day_o
    last = int(mins[sess[-1]])
    return dict(
        range=round(rng, 1),
        ret=round(ret, 1),
        ret_frac=round(ret / max(rng, 1e-9), 2),
        or_w=round(or_w, 1),
        last=f"{last // 60:02d}:{last % 60:02d}",
        bars=len(sess),
    )


def sim_trap(
    mk,
    *,
    pierce=10,
    bank_pierce=None,
    rr=2.0,
    peak_arm=150,
    peak_lock=75,
    peak_gb=75,
    mode="both",
    confirm=True,
    min_risk=4,
    max_risk=28,
    entry_s=9 * 60 + 45,
    entry_e=14 * 60 + 45,
    day_stop=80,
    only_days=None,
    bounce_or_mult=None,
    bounce_cap=None,
    skip_counter_day_ret=None,
    is_bank=False,
    book="?",
):
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, rs = mk["days"], mk["mins"], mk["ema"], mk["rs"]
    n = mk["n"]
    trades = []
    pending = None
    open_t = None
    day_net = 0.0
    day_stopped = False
    cur_day = None
    or_cache = {}
    day_open = {}
    base_pierce = bank_pierce if (is_bank and bank_pierce is not None) else pierce

    for i in range(50, n):
        day = str(days[i])
        mm = int(mins[i])
        if only_days and day not in only_days:
            continue
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            day_stopped = False
            pending = None
            open_t = None
            hi, lo = -1e18, 1e18
            first_o = None
            j = i
            while j >= 0 and str(days[j]) == day:
                m2 = int(mins[j])
                if 9 * 60 + 15 <= m2 <= 9 * 60 + 45:
                    hi = max(hi, float(h[j]))
                    lo = min(lo, float(l[j]))
                first_o = float(o[j])
                j -= 1
            or_cache[day] = None if hi < -1e17 else (hi, lo)
            day_open[day] = first_o if first_o is not None else float(o[i])

        or_w = 0.0
        if or_cache.get(day):
            or_w = or_cache[day][0] - or_cache[day][1]
        day_ret = float(c[i]) - day_open.get(day, float(o[i]))

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            risk = open_t["risk"]
            peak_r = open_t["peak_r"]
            peak_rs = open_t["peak_rs"]
            if d == 1:
                mfe_pts = max(0.0, float(h[i]) - entry)
            else:
                mfe_pts = max(0.0, entry - float(l[i]))
            mfe_r = mfe_pts / risk if risk > 0 else 0
            peak_r = max(peak_r, mfe_r)
            peak_rs = max(peak_rs, mfe_pts * rs)
            if peak_r >= 1.0:
                stop = max(stop, entry) if d == 1 else min(stop, entry)
            if peak_arm > 0 and peak_rs >= peak_arm:
                floor_pts = max(peak_lock, peak_rs - peak_gb) / rs
                stop = (
                    max(stop, entry + floor_pts)
                    if d == 1
                    else min(stop, entry - floor_pts)
                )
            hit_sl = float(l[i]) <= stop if d == 1 else float(h[i]) >= stop
            hit_tp = float(h[i]) >= target if d == 1 else float(l[i]) <= target
            if hit_sl or hit_tp or mm >= EXIT_IDX:
                if hit_sl:
                    exit_px = stop
                    reason = "PEAK_TRAIL" if peak_rs >= peak_arm else "SL"
                elif hit_tp:
                    exit_px, reason = target, "TP"
                else:
                    exit_px, reason = float(c[i]), "EOD"
                pts = (exit_px - entry) if d == 1 else (entry - exit_px)
                trades.append(
                    dict(
                        day=day,
                        time=f"{mm // 60:02d}:{mm % 60:02d}",
                        side="CE" if d == 1 else "PE",
                        rs=pts * rs - CHARGE,
                        reason=reason,
                        book=book,
                        mfe_rs=round(peak_rs, 1),
                    )
                )
                day_net += pts
                if day_net <= -day_stop:
                    day_stopped = True
                open_t = None
            else:
                open_t.update(stop=stop, peak_r=peak_r, peak_rs=peak_rs)
            continue

        if day_stopped:
            continue

        if pending is not None:
            p = pending
            pending = None
            if mm < entry_s or mm > entry_e:
                continue
            bull = p["dir"] == 1 and c[i] > o[i] and c[i] > p["sig"]
            bear = p["dir"] == -1 and c[i] < o[i] and c[i] < p["sig"]
            if confirm and not (bull or bear):
                continue
            fill = float(o[i])
            stop = min(p["stop"], fill - 1) if p["dir"] == 1 else max(p["stop"], fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                continue
            target = fill + risk * rr if p["dir"] == 1 else fill - risk * rr
            open_t = dict(
                dir=p["dir"],
                entry=fill,
                stop=stop,
                target=target,
                risk=risk,
                peak_r=0.0,
                peak_rs=0.0,
            )
            continue

        if mm < entry_s or mm > entry_e or np.isnan(ema[i]):
            continue

        trap_p = base_pierce
        bounce_p = base_pierce
        if bounce_or_mult is not None and or_w > 0:
            bounce_p = max(base_pierce, or_w * bounce_or_mult)
            if bounce_cap is not None:
                bounce_p = min(bounce_p, bounce_cap)

        sh, sl = swing_hl(h, l, i, 5)
        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        trap_buy = ll < sl - trap_p and cc > sl and cc > oo
        trap_sell = hh > sh + trap_p and cc < sh and cc < oo
        rng = max(hh - ll, 1e-9)
        bounce_buy = (
            ll <= sl + bounce_p
            and ll >= sl - bounce_p * 2
            and cc > oo
            and cc >= sl
            and (hh - cc) / rng < 0.35
        )
        bounce_sell = (
            hh >= sh - bounce_p
            and hh <= sh + bounce_p * 2
            and cc < oo
            and cc <= sh
            and (cc - ll) / rng < 0.35
        )
        direction = 0
        stop = 0.0
        if trap_buy or (mode == "both" and bounce_buy):
            if cc > float(ema[i]):
                direction = 1
                stop = ll - 2
        elif trap_sell or (mode == "both" and bounce_sell):
            if cc < float(ema[i]):
                direction = -1
                stop = hh + 2
        if not direction:
            continue

        if skip_counter_day_ret is not None:
            thr = skip_counter_day_ret if not is_bank else skip_counter_day_ret * 2
            if direction == 1 and day_ret < -thr:
                continue
            if direction == -1 and day_ret > thr:
                continue

        risk = abs(cc - stop)
        if risk < min_risk or risk > max_risk:
            continue

        if not confirm:
            fill = cc
            stop = min(stop, fill - 1) if direction == 1 else max(stop, fill + 1)
            risk = abs(fill - stop)
            if risk < min_risk or risk > max_risk:
                continue
            target = fill + risk * rr if direction == 1 else fill - risk * rr
            open_t = dict(
                dir=direction,
                entry=fill,
                stop=stop,
                target=target,
                risk=risk,
                peak_r=0.0,
                peak_rs=0.0,
            )
        else:
            pending = dict(dir=direction, stop=stop, sig=cc)

    return trades


def run_pair(nifty, bank, kw, days):
    only = set(days)
    tn = sim_trap(
        nifty, min_risk=4, max_risk=28, book="Nifty", only_days=only, is_bank=False, **kw
    )
    tb = sim_trap(
        bank, min_risk=8, max_risk=50, book="Bank", only_days=only, is_bank=True, **kw
    )
    return tn + tb


def day_stats(trades, days):
    by = defaultdict(float)
    for t in trades:
        by[t["day"]] += t["rs"]
    xs = np.array([by.get(d, 0.0) for d in days], float)
    if not len(xs):
        return {}
    return dict(
        n=int(len(xs)),
        sum=round(float(xs.sum()), 1),
        avg=round(float(xs.mean()), 1),
        p10=round(float(np.percentile(xs, 10)), 1),
        worst=round(float(xs.min()), 1),
        ge1k_pct=round(float((xs >= 1000).mean()) * 100, 1),
        tpd=round(len(trades) / len(xs), 2),
    )


def main():
    nifty = uh.load(uh.CACHE / "nifty-5m-2020-2026.json", 65)
    bank = uh.load(uh.CACHE / "banknifty-5m-2020-2026.json", 30)
    all_days = sorted({str(d) for d in nifty["days"]})
    oos = [d for d in all_days if d >= "2025-01-01"]
    jul26 = [d for d in all_days if d.startswith("2026-07")]

    feats = {
        "nifty": {d: day_feats(nifty, d) for d in QUIET + WIDE},
        "bank": {d: day_feats(bank, d) for d in QUIET + WIDE},
    }

    variants = [
        ("wired_pierce10", dict(pierce=10, confirm=True)),
        ("no_confirm", dict(pierce=10, confirm=False)),
        ("pierce15", dict(pierce=15, confirm=True)),
        ("bank_pierce30", dict(pierce=10, bank_pierce=30, confirm=True)),
        ("nifty15_bank30", dict(pierce=15, bank_pierce=30, confirm=True)),
        (
            "bounce_or20_cap35",
            dict(pierce=10, bounce_or_mult=0.20, bounce_cap=35, confirm=True),
        ),
        (
            "bounce_or25_cap40",
            dict(pierce=10, bounce_or_mult=0.25, bounce_cap=40, confirm=True),
        ),
        ("skip_dump_ret60", dict(pierce=10, skip_counter_day_ret=60, confirm=True)),
    ]

    rows = []
    wired_aug_trades = None
    for name, kw in variants:
        tq = run_pair(nifty, bank, kw, QUIET)
        tw = run_pair(nifty, bank, kw, WIDE)
        tj = run_pair(nifty, bank, kw, jul26)
        to = run_pair(nifty, bank, kw, oos)
        if name == "wired_pierce10":
            wired_aug_trades = [
                dict(
                    day=t["day"],
                    time=t["time"],
                    book=t["book"],
                    side=t["side"],
                    reason=t["reason"],
                    rs=round(t["rs"], 1),
                    mfe_rs=t["mfe_rs"],
                )
                for t in sorted(tw, key=lambda x: (x["day"], x["time"], x["book"]))
            ]
        rows.append(
            dict(
                variant=name,
                jul28_31=round(sum(t["rs"] for t in tq), 1),
                aug3_4=round(sum(t["rs"] for t in tw), 1),
                aug3=round(sum(t["rs"] for t in tw if t["day"] == "2026-08-03"), 1),
                aug4=round(sum(t["rs"] for t in tw if t["day"] == "2026-08-04"), 1),
                aug4_bank_fills=sum(
                    1 for t in tw if t["day"] == "2026-08-04" and t["book"] == "Bank"
                ),
                jul2026=day_stats(tj, jul26),
                oos_2025=day_stats(to, oos),
            )
        )

    answer = dict(
        question="Trap DNA for wide-range Aug 3-4 without wrecking Jul 28-31",
        baseline="pierce10 peak150 softOFF rr2 confirm ON 1-lot N+B",
        coverage={"aug4_cache_last": feats["nifty"]["2026-08-04"]["last"]},
        day_features=feats,
        wired_aug_trades=wired_aug_trades,
        finding={
            "aug_ce_stops": "peak-trail profit locks, not hard SL (hardSL=0 on Aug3-4 wired)",
            "aug4_gap": "Bank silent at pierce10 vs Bank OR~418; Nifty PE worked",
            "confirm_off": "does not raise Aug ₹; hurts Jul + OOS",
        },
        recommend=[
            dict(
                id="A",
                title="OR-scaled bounce pierce (preferred)",
                params=dict(bounceOrPierceMult=0.20, bounceOrPierceCap=35),
                files=[
                    "src/app/core/strategy-manager/engines/sr-trap-confirm.engine.ts",
                    "src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy.ts",
                    "src/app/core/strategy-manager/config/strategy-dna-caps.ts",
                ],
            ),
            dict(
                id="B",
                title="DNA pierce bump (+ Bank pierce)",
                params=dict(piercePts=15, bankPiercePts=30),
                files=[
                    "src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy.ts",
                    "src/app/core/strategy-manager/config/strategy-dna-caps.ts",
                ],
            ),
        ],
        do_not=[
            "Turn off next-bar confirm globally",
            "Skip CE on dump / below OR (hurts OOS — dump-day CE bounces net win)",
            "trapMode=trap only on wide OR",
            "Enable regimeFilterEnabled on Trap",
            "minConfirmBody>=8",
        ],
        variants=rows,
    )

    out = OUT / "trap-wide-range-day-answer.json"
    out.write_text(json.dumps(answer, indent=2))
    print(json.dumps(answer, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
