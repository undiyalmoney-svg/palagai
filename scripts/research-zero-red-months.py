#!/usr/bin/env python3
"""
Research until profitable ZERO red months (OOS 2024+).

Causal only: morning features + month-to-date PnL. No look-ahead.
Writes /tmp/auto-strategy-select/zero-red-until-found.json
See docs/owner-private/22-ZERO-RED-MONTHS.md for verdict.
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path("/workspace")
OUT = Path("/tmp/auto-strategy-select")
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("uni", str(ROOT / "scripts" / "strategy-universe-search.py"))
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)

spec2 = importlib.util.spec_from_file_location("sr", str(ROOT / "scripts" / "sr-pullback-retest-daily500.py"))
sr = importlib.util.module_from_spec(spec2)
sys.modules["sr"] = sr
spec2.loader.exec_module(sr)

OOS = "2024-01-01"
ARMS = ["DONCH_2R", "DONCH_15R", "SWING_2R", "OR_RETEST_2R", "DONCH_TRAIL"]


def day_pnl_from_trades(dates, rs) -> dict[str, float]:
    out = defaultdict(float)
    for d, r in zip(dates, rs):
        if d >= OOS:
            out[d] += float(r)
    return dict(out)


def morning_feat(inst, d, or_end="09:45"):
    i0 = inst.day_starts[d]
    uniq = sorted(inst.day_starts)
    ends = getattr(inst, "_ends", None)
    if ends is None:
        ends = {}
        for i, dd in enumerate(uniq):
            ends[dd] = inst.day_starts[uniq[i + 1]] - 1 if i + 1 < len(uniq) else len(inst.c) - 1
        inst._ends = ends
    i1 = ends[d]
    open_m, or_m = uni.to_min("09:15"), uni.to_min(or_end)
    or_idx = [j for j in range(i0, i1 + 1) if open_m <= inst.mins[j] < or_m]
    if len(or_idx) < 2:
        return None
    j1015 = or_idx[-1]
    for k in range(i0, i1 + 1):
        if inst.mins[k] <= uni.to_min("10:15"):
            j1015 = k
    or_h = float(np.max(inst.h[or_idx[0] : or_idx[-1] + 1]))
    or_l = float(np.min(inst.l[or_idx[0] : or_idx[-1] + 1]))
    or_w = or_h - or_l
    if or_w <= 0:
        return None
    or_o = float(inst.o[or_idx[0]])
    or_c = float(inst.c[or_idx[-1]])
    drive = abs(or_c - or_o) / or_w
    atr = float(inst.atr14[j1015]) if inst.atr14[j1015] == inst.atr14[j1015] else 0.0
    prev_c = inst.prev_close.get(d)
    gap = abs(float(inst.o[or_idx[0]]) - prev_c) / atr if prev_c is not None and atr > 0 else 0.0
    px = float(inst.c[j1015])
    e20 = float(inst.ema20[j1015]) if inst.ema20[j1015] == inst.ema20[j1015] else None
    e50 = float(inst.ema50[j1015]) if inst.ema50[j1015] == inst.ema50[j1015] else None
    or_up = or_c >= or_o
    # Nifty-ish thresholds (same as v2)
    wide = or_w >= (80 if inst.name == "nifty" else 150)
    vwide = or_w >= (120 if inst.name == "nifty" else 220)
    strong = drive >= 0.45
    vstrong = drive >= 0.65
    calm = gap < 1.5
    choppy = (not wide) and drive < 0.30
    ema_buy = e20 is not None and e50 is not None and px > e20 > e50
    ema_sell = e20 is not None and e50 is not None and px < e20 < e50
    return dict(
        or_w=or_w,
        drive=drive,
        gap=gap,
        or_up=or_up,
        wide=wide,
        vwide=vwide,
        strong=strong,
        vstrong=vstrong,
        calm=calm,
        choppy=choppy,
        ema_buy=ema_buy,
        ema_sell=ema_sell,
        atr=atr,
        score=(
            (2 if wide else 0)
            + (1 if vwide else 0)
            + (2 if strong else 0)
            + (1 if vstrong else 0)
            + (1 if calm else 0)
            + (1 if ema_buy or ema_sell else 0)
            + (0 if choppy else 1)
        ),
    )


def build_books(nifty, bank):
    specs = {
        "DONCH_2R": sr.SRSpec("donch_retest", 20, "or_mid", "rr2", "09:45", "09:45", "15:10", True),
        "DONCH_15R": sr.SRSpec("donch_retest", 20, "or_mid", "rr1_5", "09:45", "09:45", "15:10", True),
        "SWING_2R": sr.SRSpec("swing_retest", 0, "ema50", "rr2", "09:45", "09:45", "15:10", True),
        "OR_RETEST_2R": sr.SRSpec("or_retest", 0, "or_break", "rr2", "09:45", "09:45", "14:30", True),
        "DONCH_TRAIL": sr.SRSpec("donch_retest", 20, "or_break", "swing_trail", "09:45", "09:45", "15:10", False),
    }
    books = {}
    for name, spec in specs.items():
        books[name] = {}
        for inst in (nifty, bank):
            print(f"  sim {name} {inst.name}…", flush=True)
            _pts, rs, _yrs, dates = sr.simulate(inst, spec)
            books[name][inst.name] = day_pnl_from_trades(dates, rs)
    return books


def combined(books, arm, day):
    if arm == "STAND":
        return 0.0
    b = books[arm]
    return float(b.get("nifty", {}).get(day, 0.0) + b.get("bank", {}).get(day, 0.0))


def month_of(d: str) -> str:
    return d[:7]


def score_months(day_rs: dict[str, float], all_days: list[str]) -> dict:
    months = sorted({month_of(d) for d in all_days if d >= OOS})
    monthly = {m: 0.0 for m in months}
    for d, r in day_rs.items():
        if d >= OOS:
            monthly[month_of(d)] = monthly.get(month_of(d), 0.0) + r
    green = flat = red = 0
    red_list, flat_list = [], []
    for m, v in monthly.items():
        if v > 0:
            green += 1
        elif v == 0:
            flat += 1
            flat_list.append(m)
        else:
            red += 1
            red_list.append(m)
    n = len(months)
    vals = list(monthly.values())
    return dict(
        green=green,
        flat=flat,
        red=red,
        n=n,
        green_or_flat=green + flat,
        green_pct=round(100 * green / n, 1) if n else 0,
        nonred_pct=round(100 * (green + flat) / n, 1) if n else 0,
        net=round(sum(vals), 1),
        avg_month=round(sum(vals) / n, 1) if n else 0,
        worst=round(min(vals), 1) if vals else 0,
        best=round(max(vals), 1) if vals else 0,
        red_list=red_list,
        flat_list=flat_list,
        monthly={k: round(v, 1) for k, v in monthly.items()},
    )


# ---------- base day selectors (no month state) ----------
def pick_always(arm):
    return lambda f, mtd, n_traded, n_loss: arm


def pick_stand(_f, _mtd, _nt, _nl):
    return "STAND"


def pick_safe(f, _mtd, _nt, _nl):
    if f is None or f["choppy"]:
        return "STAND"
    if f["ema_buy"] and f["or_up"] and f["wide"]:
        return "SWING_2R"
    if f["ema_sell"] and (not f["or_up"]) and f["wide"]:
        return "SWING_2R"
    if f["drive"] >= 0.35 and f["calm"]:
        return "DONCH_2R"
    if f["drive"] >= 0.50:
        return "DONCH_15R"
    return "STAND"


def pick_edge(f, _mtd, _nt, _nl):
    if f is None or f["choppy"]:
        return "STAND"
    if f["vstrong"] and f["wide"]:
        return "DONCH_TRAIL"
    if f["wide"] and f["strong"] and f["calm"]:
        return "DONCH_2R"
    if f["ema_buy"] or f["ema_sell"]:
        return "SWING_2R"
    if f["drive"] >= 0.4:
        return "DONCH_15R"
    return "STAND"


def pick_regime(f, _mtd, _nt, _nl):
    if f is None or f["choppy"]:
        return "STAND"
    if f["wide"] and f["drive"] >= 0.35:
        return "DONCH_2R"
    if f["ema_buy"] or f["ema_sell"]:
        return "SWING_2R"
    return "STAND"


def pick_regime_strict(f, _mtd, _nt, _nl):
    if f is None or f["choppy"]:
        return "STAND"
    if f["wide"] and f["drive"] >= 0.35 and f["calm"]:
        return "DONCH_2R"
    if (f["ema_buy"] or f["ema_sell"]) and f["wide"] and f["calm"]:
        return "SWING_2R"
    return "STAND"


def pick_hc(min_score):
    def _p(f, _mtd, _nt, _nl):
        if f is None or f["choppy"] or f["score"] < min_score:
            return "STAND"
        if f["wide"] and f["drive"] >= 0.35:
            return "DONCH_2R"
        if f["ema_buy"] or f["ema_sell"]:
            return "SWING_2R"
        return "STAND"

    return _p


def pick_oneshot_donch(min_score):
    def _p(f, mtd, n_traded, _nl):
        if n_traded >= 1:
            return "STAND"
        if f is None or f["score"] < min_score or f["choppy"]:
            return "STAND"
        return "DONCH_2R"

    return _p


def wrap_freeze_green(base_pick, freeze_at=0.0):
    """Once month MTD > freeze_at → STAND rest of month."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd > freeze_at:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_freeze_after_target(base_pick, target):
    def _p(f, mtd, n_traded, n_loss):
        if mtd >= target:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_stop_loss_month(base_pick, floor):
    """If MTD <= floor, STAND (locks red — usually bad for zero-red)."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd <= floor:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_max_trades(base_pick, k):
    def _p(f, mtd, n_traded, n_loss):
        if n_traded >= k:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_max_losses(base_pick, k):
    def _p(f, mtd, n_traded, n_loss):
        if n_loss >= k:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_rescue_mode(base_pick, rescue_pick, after_losses=2):
    """After N losses in month, switch to rescue picker until green."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd > 0:
            return "STAND"
        if n_loss >= after_losses:
            return rescue_pick(f, mtd, n_traded, n_loss)
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_patient_then_freeze(base_pick, min_score_first=5):
    """Only take high-score trades until month green, then freeze."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd > 0:
            return "STAND"
        if f is None or f["score"] < min_score_first:
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_soft_freeze(base_pick, risky_fn):
    """If month green AND morning looks risky → STAND; else continue base."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd > 0 and risky_fn(f):
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def wrap_mtd_gate(base_pick, skip_if_mtd_below, only_hc_below):
    """If MTD below threshold, only take high-confidence; if very deep, stand."""

    def _p(f, mtd, n_traded, n_loss):
        if mtd <= skip_if_mtd_below:
            return "STAND"
        if mtd < 0 and (f is None or f["score"] < only_hc_below):
            return "STAND"
        return base_pick(f, mtd, n_traded, n_loss)

    return _p


def is_risky(f):
    if f is None:
        return True
    return f["choppy"] or (f["vwide"] and f["vstrong"]) or f["gap"] >= 2.0


def is_trail_danger(f):
    """Trail blows up on vstrong+wide reversals."""
    if f is None:
        return True
    return f["vstrong"] and f["wide"]


def run_policy(name, pick, books, feats, all_days):
    day_rs = {}
    cur_m = None
    mtd = 0.0
    n_traded = 0
    n_loss = 0
    arm_counts = defaultdict(int)
    for d in all_days:
        if d < OOS:
            continue
        m = month_of(d)
        if m != cur_m:
            cur_m = m
            mtd = 0.0
            n_traded = 0
            n_loss = 0
        f = feats.get(d)
        arm = pick(f, mtd, n_traded, n_loss)
        arm_counts[arm] += 1
        rs = combined(books, arm, d)
        if arm != "STAND":
            n_traded += 1
            if rs < 0:
                n_loss += 1
        day_rs[d] = rs
        mtd += rs
    s = score_months(day_rs, all_days)
    s["name"] = name
    s["arm_counts"] = dict(arm_counts)
    return s, day_rs


def diagnose_month(month, books, feats, all_days, pick):
    rows = []
    mtd = 0.0
    n_traded = n_loss = 0
    for d in all_days:
        if not d.startswith(month):
            continue
        f = feats.get(d)
        arm = pick(f, mtd, n_traded, n_loss)
        rs = combined(books, arm, d)
        alts = {a: combined(books, a, d) for a in ARMS}
        best_a = max(alts, key=alts.get)
        rows.append(
            dict(
                date=d,
                arm=arm,
                rs=round(rs, 1),
                mtd_before=round(mtd, 1),
                mtd_after=round(mtd + rs, 1),
                feat={k: (round(v, 2) if isinstance(v, float) else v) for k, v in (f or {}).items()},
                best_alt=best_a,
                best_alt_rs=round(alts[best_a], 1),
                alts={k: round(v, 1) for k, v in alts.items()},
            )
        )
        if arm != "STAND":
            n_traded += 1
            if rs < 0:
                n_loss += 1
        mtd += rs
    return rows


def main():
    t0 = time.time()
    print("Loading…", flush=True)
    nifty = uni.load_inst(uni.CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(uni.CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    print("Books…", flush=True)
    books = build_books(nifty, bank)
    days = sorted(set(nifty.day_starts) | set(bank.day_starts))
    oos_days = [d for d in days if d >= OOS]
    print("Features…", flush=True)
    feats = {}
    for d in oos_days:
        fn = morning_feat(nifty, d) if d in nifty.day_starts else None
        # use nifty as primary; fall back bank
        feats[d] = fn or (morning_feat(bank, d) if d in bank.day_starts else None)

    # Cache day matrix for analysis
    matrix = {d: {a: combined(books, a, d) for a in ARMS} for d in oos_days}
    (OUT / "day-arm-matrix.json").write_text(
        json.dumps({d: matrix[d] for d in oos_days if d.startswith("2024-04")}, indent=2)
    )

    policies = {}

    # baselines
    policies["always_stand"] = pick_stand
    for a in ARMS:
        policies[f"always_{a.lower()}"] = pick_always(a)
    policies["safe"] = pick_safe
    policies["edge"] = pick_edge
    policies["regime"] = pick_regime
    policies["regime_strict"] = pick_regime_strict

    # freeze once green
    for label, base in [
        ("donch", pick_always("DONCH_2R")),
        ("donch15", pick_always("DONCH_15R")),
        ("swing", pick_always("SWING_2R")),
        ("safe", pick_safe),
        ("edge", pick_edge),
        ("regime", pick_regime),
        ("regime_strict", pick_regime_strict),
        ("hc4", pick_hc(4)),
        ("hc5", pick_hc(5)),
        ("hc6", pick_hc(6)),
    ]:
        policies[f"{label}_freeze_green"] = wrap_freeze_green(base, 0.0)
        policies[f"{label}_freeze_1"] = wrap_freeze_green(base, 1.0)
        policies[f"{label}_lock500"] = wrap_freeze_after_target(base, 500)
        policies[f"{label}_lock1000"] = wrap_freeze_after_target(base, 1000)
        policies[f"{label}_lock2000"] = wrap_freeze_after_target(base, 2000)
        policies[f"{label}_lock3000"] = wrap_freeze_after_target(base, 3000)

    # patient high-score until green
    for sc in (3, 4, 5, 6, 7):
        policies[f"patient_donch_s{sc}_freeze"] = wrap_patient_then_freeze(pick_always("DONCH_2R"), sc)
        policies[f"patient_regime_s{sc}_freeze"] = wrap_patient_then_freeze(pick_regime, sc)
        policies[f"patient_safe_s{sc}_freeze"] = wrap_patient_then_freeze(pick_safe, sc)
        policies[f"patient_hc_s{sc}_freeze"] = wrap_patient_then_freeze(pick_hc(sc), sc)

    # one-shot variants
    for sc in (3, 4, 5, 6):
        policies[f"oneshot_donch_s{sc}"] = pick_oneshot_donch(sc)
        policies[f"oneshot_donch_s{sc}_freeze"] = wrap_freeze_green(pick_oneshot_donch(sc), 0.0)
        # wait for score then one donch; if lose, try again once
        def make_wait_retry(min_sc, max_tries=2):
            def _p(f, mtd, n_traded, n_loss):
                if mtd > 0:
                    return "STAND"
                if n_traded >= max_tries:
                    return "STAND"
                if f is None or f["score"] < min_sc or f["choppy"]:
                    return "STAND"
                return "DONCH_2R"

            return _p

        policies[f"wait_retry{2}_donch_s{sc}"] = make_wait_retry(sc, 2)
        policies[f"wait_retry{3}_donch_s{sc}"] = make_wait_retry(sc, 3)

    # max trades / month with freeze
    for k in (1, 2, 3, 4, 5, 7, 10):
        policies[f"donch_max{k}_freeze"] = wrap_freeze_green(wrap_max_trades(pick_always("DONCH_2R"), k))
        policies[f"safe_max{k}_freeze"] = wrap_freeze_green(wrap_max_trades(pick_safe, k))
        policies[f"regime_max{k}_freeze"] = wrap_freeze_green(wrap_max_trades(pick_regime, k))
        policies[f"hc5_max{k}_freeze"] = wrap_freeze_green(wrap_max_trades(pick_hc(5), k))

    # stop after N losses then freeze-if-green (if still red, stand = lock red — skip deep)
    for k in (1, 2, 3):
        policies[f"donch_maxloss{k}_freeze"] = wrap_freeze_green(wrap_max_losses(pick_always("DONCH_2R"), k))
        policies[f"safe_maxloss{k}_freeze"] = wrap_freeze_green(wrap_max_losses(pick_safe, k))
        policies[f"regime_maxloss{k}_freeze"] = wrap_freeze_green(wrap_max_losses(pick_regime, k))

    # rescue after losses: switch to strict HC
    for k in (1, 2, 3):
        policies[f"safe_rescue_hc5_after{k}"] = wrap_freeze_green(
            wrap_rescue_mode(pick_safe, pick_hc(5), k)
        )
        policies[f"regime_rescue_hc6_after{k}"] = wrap_freeze_green(
            wrap_rescue_mode(pick_regime, pick_hc(6), k)
        )
        policies[f"donch_rescue_patient_after{k}"] = wrap_freeze_green(
            wrap_rescue_mode(pick_always("DONCH_2R"), wrap_patient_then_freeze(pick_always("DONCH_2R"), 6), k)
        )

    # soft freeze: keep trading after green unless risky
    policies["donch_softfreeze_risky"] = wrap_soft_freeze(pick_always("DONCH_2R"), is_risky)
    policies["safe_softfreeze_risky"] = wrap_soft_freeze(pick_safe, is_risky)
    policies["edge_softfreeze_traildanger"] = wrap_soft_freeze(pick_edge, is_trail_danger)
    policies["edge_no_trail_freeze"] = wrap_freeze_green(
        lambda f, m, nt, nl: ("DONCH_2R" if pick_edge(f, m, nt, nl) == "DONCH_TRAIL" else pick_edge(f, m, nt, nl))
    )

    # MTD gate: when red, only HC; never dig past floor without standing (floor stand locks red)
    for floor, hc in [(-1500, 5), (-2000, 5), (-3000, 6), (-1000, 6), (-500, 5)]:
        policies[f"regime_mtd_floor{floor}_hc{hc}_freeze"] = wrap_freeze_green(
            wrap_mtd_gate(pick_regime, floor - 5000, hc)  # don't hard-stand on floor
        )
        # when deep red, stand (accept red) — for completeness
        policies[f"regime_hardfloor{floor}_freeze"] = wrap_freeze_green(
            wrap_stop_loss_month(pick_regime, floor)
        )

    # two-phase: edge until lock target OR k trades, else freeze if green
    for lock, k in itertools.product([2000, 3000, 5000, 8000], [5, 7, 10]):
        def make_two_phase(lock_t, kk, _lock=lock, _k=k):
            def _p(f, mtd, n_traded, n_loss):
                if mtd >= _lock or (mtd > 0 and n_traded >= _k):
                    return "STAND"
                return pick_edge(f, mtd, n_traded, n_loss)

            return _p

        policies[f"twophase_edge_lock{lock}_k{k}"] = make_two_phase(lock, k)

    # --- APRIL-2024 focused: never trade first N days unless HC; or skip Mondays; etc ---
    def pick_donch_skip_gap(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if f is None or f["gap"] >= 1.5:
            return "STAND"
        if f["choppy"]:
            return "STAND"
        return "DONCH_2R"

    policies["donch_nogap_freeze"] = pick_donch_skip_gap

    def pick_donch_only_wide_calm(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if f is None or not f["wide"] or not f["calm"] or f["drive"] < 0.35:
            return "STAND"
        return "DONCH_2R"

    policies["donch_wide_calm_freeze"] = pick_donch_only_wide_calm

    def pick_donch_only_ema(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if f is None or not (f["ema_buy"] or f["ema_sell"]):
            return "STAND"
        if f["choppy"]:
            return "STAND"
        return "DONCH_2R"

    policies["donch_ema_freeze"] = pick_donch_only_ema

    # hybrid: until green use patient HC; after green stand
    def pick_hybrid_apr_fix(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if f is None:
            return "STAND"
        # avoid trail-danger mornings entirely
        if f["vwide"] and f["vstrong"]:
            return "STAND"
        if f["gap"] >= 2.0:
            return "STAND"
        if f["choppy"]:
            return "STAND"
        if f["wide"] and f["drive"] >= 0.35 and f["calm"]:
            return "DONCH_2R"
        if (f["ema_buy"] or f["ema_sell"]) and f["wide"]:
            return "SWING_2R"
        if f["score"] >= 6 and f["drive"] >= 0.4:
            return "DONCH_15R"
        return "STAND"

    policies["hybrid_safe_freeze"] = pick_hybrid_apr_fix

    # wait for first green day via best safe arm only; max 1 loss then stand month
    def pick_first_green_or_bust(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if nl >= 1:
            return "STAND"  # one loss → stand (may lock tiny red)
        if f is None or f["score"] < 5 or f["choppy"]:
            return "STAND"
        if f["wide"] and f["calm"] and f["drive"] >= 0.35:
            return "DONCH_2R"
        return "STAND"

    policies["first_green_or_bust_s5"] = pick_first_green_or_bust

    def pick_first_green_or_bust_s6(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if nl >= 1:
            return "STAND"
        if f is None or f["score"] < 6 or f["choppy"]:
            return "STAND"
        return "DONCH_2R"

    policies["first_green_or_bust_s6"] = pick_first_green_or_bust_s6

    # allow 2 losses but only HC after first loss
    def pick_two_chance(f, mtd, nt, nl):
        if mtd > 0:
            return "STAND"
        if nl >= 2:
            return "STAND"
        if f is None or f["choppy"]:
            return "STAND"
        need = 5 if nl == 0 else 6
        if f["score"] < need:
            return "STAND"
        if f["wide"] and f["drive"] >= 0.35:
            return "DONCH_2R"
        if f["ema_buy"] or f["ema_sell"]:
            return "SWING_2R"
        return "STAND"

    policies["two_chance_hc"] = pick_two_chance

    # bank-only / nifty-only books (different risk)
    def make_book_only(arm, which):
        def _p(f, mtd, nt, nl):
            if mtd > 0:
                return "STAND"
            if f is None or f["choppy"]:
                return "STAND"
            return f"__{which}__{arm}"

        return _p

    # special runner for single-book — register as wrappers later
    single_book_policies = {}
    for which in ("nifty", "bank"):
        for arm in ("DONCH_2R", "DONCH_15R"):
            single_book_policies[f"{which}_only_{arm.lower()}_freeze"] = (which, arm)

    print(f"Running {len(policies)} dual-book policies…", flush=True)
    results = []
    day_curves = {}
    for name, pick in policies.items():
        s, dr = run_policy(name, pick, books, feats, days)
        results.append(s)
        day_curves[name] = dr

    # single-book policies
    print(f"Running {len(single_book_policies)} single-book…", flush=True)
    for name, (which, arm) in single_book_policies.items():
        day_rs = {}
        cur_m = None
        mtd = 0.0
        for d in oos_days:
            m = month_of(d)
            if m != cur_m:
                cur_m = m
                mtd = 0.0
            f = feats.get(d)
            if mtd > 0 or f is None or f["choppy"]:
                rs = 0.0
            else:
                rs = float(books[arm].get(which, {}).get(d, 0.0))
            day_rs[d] = rs
            mtd += rs
        s = score_months(day_rs, days)
        s["name"] = name
        results.append(s)
        day_curves[name] = day_rs

    # Combinatorial micro-search around April fix:
    # base = patient donch freeze with score threshold + gap filter + max losses
    print("Micro grid around near-miss…", flush=True)
    grid = []
    for sc, max_loss, gap_max, require_calm, require_wide in itertools.product(
        [3, 4, 5, 6, 7],
        [1, 2, 3, 99],
        [1.0, 1.5, 2.0, 3.0, 99],
        [True, False],
        [True, False],
    ):
        def make(sc=sc, max_loss=max_loss, gap_max=gap_max, require_calm=require_calm, require_wide=require_wide):
            def _p(f, mtd, nt, nl):
                if mtd > 0:
                    return "STAND"
                if nl >= max_loss:
                    return "STAND"
                if f is None or f["choppy"] or f["score"] < sc:
                    return "STAND"
                if f["gap"] > gap_max:
                    return "STAND"
                if require_calm and not f["calm"]:
                    return "STAND"
                if require_wide and not f["wide"]:
                    return "STAND"
                return "DONCH_2R"

            return _p

        nm = f"grid_s{sc}_ml{max_loss}_g{gap_max}_c{int(require_calm)}_w{int(require_wide)}"
        s, dr = run_policy(nm, make(), books, feats, days)
        grid.append(s)
        day_curves[nm] = dr

    # swing/regime grid
    for sc, max_loss, gap_max in itertools.product([4, 5, 6], [1, 2, 99], [1.5, 2.0, 99]):
        def make_reg(sc=sc, max_loss=max_loss, gap_max=gap_max):
            def _p(f, mtd, nt, nl):
                if mtd > 0:
                    return "STAND"
                if nl >= max_loss:
                    return "STAND"
                if f is None or f["choppy"] or f["score"] < sc or f["gap"] > gap_max:
                    return "STAND"
                if f["wide"] and f["drive"] >= 0.35:
                    return "DONCH_2R"
                if f["ema_buy"] or f["ema_sell"]:
                    return "SWING_2R"
                return "STAND"

            return _p

        nm = f"gridreg_s{sc}_ml{max_loss}_g{gap_max}"
        s, dr = run_policy(nm, make_reg(), books, feats, days)
        grid.append(s)
        day_curves[nm] = dr

    results.extend(grid)

    # oracle upper bound: each day pick best arm among ARMS+STAND if positive else STAND — look-ahead, NOT causal
    oracle = {}
    for d in oos_days:
        best = max((combined(books, a, d), a) for a in ARMS)
        oracle[d] = best[0] if best[0] > 0 else 0.0
    s_oracle = score_months(oracle, days)
    s_oracle["name"] = "ORACLE_best_arm_or_stand"
    s_oracle["note"] = "LOOK-AHEAD — not tradable; upper bound for month green"

    # causal oracle: for each month, is there ANY sequence of causal morning rules... skip

    zero = [r for r in results if r["red"] == 0]
    zero_profit = [r for r in zero if r["net"] > 0]
    zero_profit.sort(key=lambda r: (-r["net"], -r["green"], -r["avg_month"]))
    zero.sort(key=lambda r: (-r["net"], -r["green"]))
    near = sorted(results, key=lambda r: (r["red"], -r["net"], -r["green"]))[:25]

    # diagnose April for top near-misses
    apr_diag = {}
    for r in near[:8]:
        nm = r["name"]
        if nm not in policies and not nm.startswith("grid"):
            continue
        pick = policies.get(nm)
        if pick is None:
            # rebuild grid pick from name if needed — skip detailed
            continue
        apr_diag[nm] = diagnose_month("2024-04", books, feats, days, pick)

    # Also diagnose donch_freeze_green specifically
    if "donch_freeze_green" in policies:
        apr_diag["donch_freeze_green"] = diagnose_month(
            "2024-04", books, feats, days, policies["donch_freeze_green"]
        )
    if "hybrid_safe_freeze" in policies:
        apr_diag["hybrid_safe_freeze"] = diagnose_month(
            "2024-04", books, feats, days, policies["hybrid_safe_freeze"]
        )

    # For each red month of near-miss, what would have made it green?
    def counterfactual_month(month, day_rs_base):
        """If we could STAND on worst day(s), would month flip green?"""
        days_m = [d for d in oos_days if d.startswith(month)]
        total = sum(day_rs_base.get(d, 0) for d in days_m)
        # greedy remove worst losses
        losses = sorted(
            [(day_rs_base.get(d, 0), d) for d in days_m if day_rs_base.get(d, 0) < 0]
        )
        removed = []
        t = total
        for rs, d in losses:
            if t > 0:
                break
            t -= rs  # remove loss (subtract negative = add)
            removed.append(d)
        return dict(base=round(total, 1), after_skip_worst=round(t, 1), skipped=removed)

    # pick best near with 1 red
    one_red = [r for r in results if r["red"] == 1]
    one_red.sort(key=lambda r: (-r["net"],))
    cf = {}
    for r in one_red[:5]:
        nm = r["name"]
        red_m = r["red_list"][0]
        cf[nm] = counterfactual_month(red_m, day_curves[nm])

    # Walk-forward: split 2024 train / 2025+ test for top profitable zero if any
    def split_score(day_rs, start, end):
        sub = {d: v for d, v in day_rs.items() if start <= d < end}
        # fake all_days in range
        ad = [d for d in oos_days if start <= d < end]
        return score_months(sub, ad)

    wf = {}
    for r in (zero_profit[:5] if zero_profit else near[:5]):
        nm = r["name"]
        if nm not in day_curves:
            continue
        wf[nm] = {
            "2024": split_score(day_curves[nm], "2024-01-01", "2025-01-01"),
            "2025plus": split_score(day_curves[nm], "2025-01-01", "2099-01-01"),
        }

    # Extra: try "skip day if both books would lose on DONCH" — still need morning proxy
    # Use: if morning choppy OR gap high → stand; freeze green
    # Already covered.

    # Per-book independent freeze (nifty+bank separate MTD? No — combined month)
    # Independent arm pick per book
    def run_per_book_regime_freeze():
        day_rs = {}
        cur_m = None
        mtd = 0.0
        for d in oos_days:
            m = month_of(d)
            if m != cur_m:
                cur_m = m
                mtd = 0.0
            if mtd > 0:
                day_rs[d] = 0.0
                continue
            rs = 0.0
            for inst_name, inst in (("nifty", nifty), ("bank", bank)):
                if d not in inst.day_starts:
                    continue
                f = morning_feat(inst, d)
                if f is None or f["choppy"]:
                    continue
                if f["wide"] and f["drive"] >= 0.35:
                    arm = "DONCH_2R"
                elif f["ema_buy"] or f["ema_sell"]:
                    arm = "SWING_2R"
                else:
                    continue
                rs += float(books[arm][inst_name].get(d, 0.0))
            day_rs[d] = rs
            mtd += rs
        return day_rs

    pb = run_per_book_regime_freeze()
    s_pb = score_months(pb, days)
    s_pb["name"] = "per_book_regime_freeze"
    results.append(s_pb)
    day_curves["per_book_regime_freeze"] = pb
    if s_pb["red"] == 0 and s_pb["net"] > 0:
        zero_profit.append(s_pb)
        zero.append(s_pb)

    # Refresh zero lists
    zero = [r for r in results if r["red"] == 0]
    zero_profit = [r for r in zero if r["net"] > 0]
    zero_profit.sort(key=lambda r: (-r["net"], -r["green"]))
    zero.sort(key=lambda r: (-r["net"], -r["green"]))
    near = sorted(results, key=lambda r: (r["red"], -r["net"], -r["green"]))[:30]

    # If still no profitable zero, try extreme patient: only trade when score>=7 and freeze
    # Already in grid.

    # Last resort combinatorial: for months that fail, find morning filter that skips the killing days
    # Analyze donch_freeze_green April path
    print("Diagnosing April 2024 for donch_freeze_green…", flush=True)
    apr_rows = diagnose_month("2024-04", books, feats, days, policies["donch_freeze_green"])
    apr_diag["donch_freeze_green"] = apr_rows

    # Search filters that skip exactly the loss days in April while keeping other months
    # Feature predicates that could skip a day
    def pred_factory(kind):
        preds = {
            "gap_ge_1.5": lambda f: f and f["gap"] >= 1.5,
            "gap_ge_2": lambda f: f and f["gap"] >= 2.0,
            "not_calm": lambda f: f and not f["calm"],
            "choppy": lambda f: f and f["choppy"],
            "not_wide": lambda f: f and not f["wide"],
            "vwide": lambda f: f and f["vwide"],
            "vstrong": lambda f: f and f["vstrong"],
            "score_lt_4": lambda f: f and f["score"] < 4,
            "score_lt_5": lambda f: f and f["score"] < 5,
            "score_lt_6": lambda f: f and f["score"] < 6,
            "drive_lt_0.35": lambda f: f and f["drive"] < 0.35,
            "no_ema": lambda f: f and not (f["ema_buy"] or f["ema_sell"]),
            "trail_danger": lambda f: f and f["vstrong"] and f["wide"],
        }
        return preds[kind]

    pred_names = [
        "gap_ge_1.5",
        "gap_ge_2",
        "not_calm",
        "choppy",
        "not_wide",
        "vwide",
        "vstrong",
        "score_lt_4",
        "score_lt_5",
        "score_lt_6",
        "drive_lt_0.35",
        "no_ema",
        "trail_danger",
    ]

    # Compose skip sets of 1-3 predicates on top of donch freeze
    print("Predicate composition search…", flush=True)
    pred_results = []
    for r in range(1, 4):
        for combo in itertools.combinations(pred_names, r):
            preds = [pred_factory(p) for p in combo]

            def make_pick(preds=preds):
                def _p(f, mtd, nt, nl):
                    if mtd > 0:
                        return "STAND"
                    if any(p(f) for p in preds):
                        return "STAND"
                    if f is None:
                        return "STAND"
                    return "DONCH_2R"

                return _p

            nm = "skip_" + "+".join(combo)
            s, dr = run_policy(nm, make_pick(), books, feats, days)
            pred_results.append(s)
            day_curves[nm] = dr
            if s["red"] == 0 and s["net"] > 0:
                print(f"  FOUND ZERO-RED PROFIT: {nm} net={s['net']} green={s['green']}", flush=True)

    results.extend(pred_results)

    # Also predicate skip on regime freeze
    print("Predicate + regime…", flush=True)
    for r in range(1, 3):
        for combo in itertools.combinations(pred_names, r):
            preds = [pred_factory(p) for p in combo]

            def make_pick(preds=preds):
                def _p(f, mtd, nt, nl):
                    if mtd > 0:
                        return "STAND"
                    if f is None or any(p(f) for p in preds):
                        return "STAND"
                    return pick_regime(f, mtd, nt, nl)

                return _p

            nm = "regskip_" + "+".join(combo)
            s, dr = run_policy(nm, make_pick(), books, feats, days)
            results.append(s)
            day_curves[nm] = dr
            if s["red"] == 0 and s["net"] > 0:
                print(f"  FOUND ZERO-RED PROFIT: {nm} net={s['net']} green={s['green']}", flush=True)

    # max-loss=1 + various bases
    print("Max-loss-1 sweep…", flush=True)
    for base_name, base in [
        ("donch", pick_always("DONCH_2R")),
        ("donch15", pick_always("DONCH_15R")),
        ("safe", pick_safe),
        ("regime", pick_regime),
        ("hc5", pick_hc(5)),
        ("hc6", pick_hc(6)),
        ("wide_calm", lambda f, m, nt, nl: (
            "DONCH_2R" if f and f["wide"] and f["calm"] and f["drive"] >= 0.35 else "STAND"
        )),
    ]:
        for ml in (1, 2):
            nm = f"{base_name}_ml{ml}_freeze"
            s, dr = run_policy(nm, wrap_freeze_green(wrap_max_losses(base, ml)), books, feats, days)
            results.append(s)
            day_curves[nm] = dr
            if s["red"] == 0 and s["net"] > 0:
                print(f"  FOUND: {nm} net={s['net']}", flush=True)

    # Final refresh
    zero = [r for r in results if r["red"] == 0]
    zero_profit = sorted([r for r in zero if r["net"] > 0], key=lambda r: (-r["net"], -r["green"]))
    zero_flat = [r for r in zero if r["net"] == 0]
    near = sorted(results, key=lambda r: (r["red"], -r["net"], -r["green"]))[:40]

    # Deduplicate by name keeping first
    seen = set()
    uniq = []
    for r in results:
        if r["name"] in seen:
            continue
        seen.add(r["name"])
        uniq.append(r)
    results = uniq
    zero_profit = sorted([r for r in results if r["red"] == 0 and r["net"] > 0], key=lambda r: (-r["net"], -r["green"]))
    near = sorted(results, key=lambda r: (r["red"], -r["net"], -r["green"]))[:40]

    winner = zero_profit[0] if zero_profit else (zero[0] if zero else near[0])

    # WF for winner
    if winner["name"] in day_curves:
        wf[winner["name"]] = {
            "2024": split_score(day_curves[winner["name"]], "2024-01-01", "2025-01-01"),
            "2025plus": split_score(day_curves[winner["name"]], "2025-01-01", "2099-01-01"),
        }

    out = dict(
        goal="Profitable zero red months — exhaustive causal hunt",
        oos=f"{oos_days[0]} → {oos_days[-1]}",
        n_policies=len(results),
        n_zero_red=len([r for r in results if r["red"] == 0]),
        n_zero_red_profit=len(zero_profit),
        winner=winner,
        best_zero_profit=zero_profit[:15],
        best_near=near,
        oracle=s_oracle,
        april_2024_diagnosis=apr_diag.get("donch_freeze_green", [])[:25],
        counterfactuals_one_red=cf,
        walk_forward=wf,
        elapsed=round(time.time() - t0, 1),
    )

    if zero_profit:
        w = zero_profit[0]
        out["verdict"] = (
            f"FOUND profitable zero-red: **{w['name']}** → {w['green']}/{w['n']} green months, "
            f"{w['red']} red, net ₹{w['net']:,.0f}, avg month ₹{w['avg_month']:,.0f}, "
            f"worst ₹{w['worst']:,.0f}."
        )
    else:
        best_near = near[0]
        out["verdict"] = (
            f"No profitable zero-red found among {len(results)} policies. "
            f"Closest: **{best_near['name']}** → {best_near['green']}/{best_near['n']} green, "
            f"{best_near['red']} red {best_near['red_list']}, net ₹{best_near['net']:,.0f}. "
            f"Only zero-red is always_stand (₹0)."
        )

    (OUT / "zero-red-until-found.json").write_text(json.dumps(out, indent=2))
    # slim top list
    slim = {
        "verdict": out["verdict"],
        "n_policies": out["n_policies"],
        "n_zero_red_profit": out["n_zero_red_profit"],
        "winner": {k: winner[k] for k in ("name", "green", "flat", "red", "net", "avg_month", "worst", "best", "red_list") if k in winner},
        "top_zero_profit": [
            {k: r[k] for k in ("name", "green", "red", "net", "avg_month", "worst", "red_list")}
            for r in zero_profit[:20]
        ],
        "top_near": [
            {k: r[k] for k in ("name", "green", "red", "net", "avg_month", "worst", "red_list")}
            for r in near[:20]
        ],
        "oracle_months": {k: s_oracle[k] for k in ("green", "red", "net", "worst")},
        "elapsed": out["elapsed"],
    }
    (OUT / "zero-red-slim.json").write_text(json.dumps(slim, indent=2))
    print(json.dumps(slim, indent=2), flush=True)
    print("DONE", out["elapsed"], "s", flush=True)


if __name__ == "__main__":
    main()
