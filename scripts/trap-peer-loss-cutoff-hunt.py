#!/usr/bin/env python3
"""
Trap peer hunt — can anything match Trap *with* researched loss cutoffs?

Books (Nifty×₹65 + Bank×₹30, 1 lot each):
  trap_bare              — Trap DNA, hard SL / 3.5R / EOD only (+1R→BE)
  trap_protect           — + peak-trail arm₹600 / lock₹300 / gb₹300 + soft SL confirm
  trap_protect_dayloss   — protect + day ₹ loss cap (research grid)
  trap_protect_bankquit  — protect + bank & quit day ₹ target
  genie_protect          — Genie-proxy legs + same protect DNA
  kutty_fixed            — Kutty ₹600/₹200 trap+bounce (both books)
  donch_proxy            — Donch-retest proxy (break→retest OR-mid · 2R · day stop)

Data:
  Prefer reports/analyst-cache/nifty-5m-2020-2026.json (+ bank)
  Else Yahoo recent dumps nifty_yahoo.json / bank_yahoo.json

Usage:
  python3 scripts/trap-peer-loss-cutoff-hunt.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "trap-peer-loss-cutoff"
OUT.mkdir(parents=True, exist_ok=True)
EXIT_M = 15 * 60 + 15

# Wired Trap protect DNA (paper-loss-giveback-cutoff champion)
TRAP_PEAK = (600.0, 300.0, 300.0)  # arm / lock / giveback ₹
TRAP_SOFT = (0.55, 700.0, 0.75)  # fracR / softRs / maxMfeR


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path, rs: float) -> dict:
    rows = json.loads(path.read_text())
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([str(r["date"])[:10] for r in rows])
    mins = np.array([to_min(str(r["date"])[11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    if len(c) >= 50:
        ema[49] = float(c[:50].mean())
        for i in range(50, len(c)):
            ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, rs=rs, n=len(c))


def resolve_cache() -> tuple[Path, Path, str, str]:
    full_n = CACHE / "nifty-5m-2020-2026.json"
    full_b = CACHE / "banknifty-5m-2020-2026.json"
    if full_n.exists() and full_b.exists():
        return full_n, full_b, "kite_full", "2024-01-01"
    y_n = CACHE / "nifty_yahoo.json"
    y_b = CACHE / "bank_yahoo.json"
    if y_n.exists() and y_b.exists():
        # Recent window only — not a walk-forward claim
        return y_n, y_b, "yahoo_recent", "2026-05-07"
    raise SystemExit(f"No candle cache in {CACHE}")


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


def simulate_trap(
    mk: dict,
    *,
    rr: float = 3.5,
    max_trades: int = 3,
    day_stop_pts: float = 80,
    min_risk: float = 4,
    max_risk: float = 28,
    entry_s: int = 9 * 60 + 45,
    entry_e: int = 14 * 60 + 45,
    peak_trail: tuple[float, float, float] | None = None,
    soft: tuple[float, float, float] | None = None,
    day_loss_rs: float | None = None,
    day_bank_rs: float | None = None,
    first_win_lock: bool = False,
    kutty_mode: bool = False,
) -> list[dict]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema = mk["days"], mk["mins"], mk["ema"]
    n, rs = mk["n"], mk["rs"]
    trades: list[dict] = []
    pending = None
    open_t = None
    day_net_pts = 0.0
    day_net_rs = 0.0
    trades_today = 0
    won_today = False
    cur_day = None
    tp_rs = 600.0 if kutty_mode else None
    sl_rs = 200.0 if kutty_mode else None

    for i in range(50, n):
        day = days[i]
        if day != cur_day:
            cur_day = day
            day_net_pts = 0.0
            day_net_rs = 0.0
            trades_today = 0
            won_today = False
            pending = None
            open_t = None

        mm = int(mins[i])
        day_stopped = day_net_pts <= -day_stop_pts
        if day_loss_rs is not None and day_net_rs <= -day_loss_rs:
            day_stopped = True
        if day_bank_rs is not None and day_net_rs >= day_bank_rs:
            day_stopped = True
        if first_win_lock and won_today:
            day_stopped = True

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            risk0 = open_t["risk"]

            fav = (h[i] - entry) if d == 1 else (entry - l[i])
            adv = (entry - l[i]) if d == 1 else (h[i] - entry)
            open_t["mfe"] = max(open_t["mfe"], max(0.0, float(fav)))
            open_t["mae"] = max(open_t["mae"], max(0.0, float(adv)))
            mfe = open_t["mfe"]
            mae = open_t["mae"]

            # 1R → BE (Trap / Kutty skip — fixed ₹ stops)
            if not kutty_mode and mfe >= 1.0 * risk0:
                lock_stop = entry
                if d == 1 and lock_stop > stop:
                    stop = lock_stop
                elif d == -1 and lock_stop < stop:
                    stop = lock_stop
                open_t["stop"] = stop

            if peak_trail and not kutty_mode:
                arm_rs, lock_rs, gb_rs = peak_trail
                peak_rs = mfe * rs
                if peak_rs >= arm_rs:
                    floor_rs = max(lock_rs, peak_rs - max(0.0, gb_rs))
                    floor_pts = floor_rs / rs
                    lock_stop = entry + d * floor_pts
                    if d == 1 and lock_stop > stop:
                        stop = lock_stop
                    elif d == -1 and lock_stop < stop:
                        stop = lock_stop
                    open_t["stop"] = stop

            reason = ""
            exit_px = None

            if soft and risk0 > 0 and exit_px is None and not kutty_mode:
                frac_r, soft_rs, max_mfe_r = soft
                against = (c[i] < entry) if d == 1 else (c[i] > entry)
                conf = (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                if mfe < max_mfe_r * risk0:
                    hit_frac = mae >= frac_r * risk0
                    hit_soft = soft_rs > 0 and mae * rs >= soft_rs
                    if (hit_frac or hit_soft) and against and conf:
                        exit_px = float(c[i])
                        reason = "cutoff_soft"

            if exit_px is None:
                if d == 1:
                    if l[i] <= stop:
                        if peak_trail and not kutty_mode and mfe * rs >= peak_trail[0] and stop > entry:
                            exit_px, reason = stop, "peak_trail"
                        else:
                            exit_px, reason = stop, "sl"
                    elif h[i] >= target:
                        exit_px, reason = target, "tp"
                else:
                    if h[i] >= stop:
                        if peak_trail and not kutty_mode and mfe * rs >= peak_trail[0] and stop < entry:
                            exit_px, reason = stop, "peak_trail"
                        else:
                            exit_px, reason = stop, "sl"
                    elif l[i] <= target:
                        exit_px, reason = target, "tp"
                if exit_px is None and mm >= EXIT_M:
                    exit_px, reason = float(c[i]), "eod"

            if exit_px is not None:
                pts = d * (exit_px - entry)
                rs_pnl = pts * rs
                trades.append(
                    {
                        "day": day,
                        "pts": float(pts),
                        "rs": float(rs_pnl),
                        "reason": reason,
                        "mfe": mfe,
                        "mae": mae,
                        "risk": risk0,
                    }
                )
                day_net_pts += pts
                day_net_rs += rs_pnl
                trades_today += 1
                if rs_pnl > 0:
                    won_today = True
                open_t = None
            continue

        if day_stopped or trades_today >= max_trades:
            pending = None
            continue

        if pending is not None:
            p = pending
            pending = None
            fill = float(o[i])
            stop = float(p["stop"])
            if p["dir"] == 1:
                stop = min(stop, fill - 1)
            else:
                stop = max(stop, fill + 1)
            risk = abs(fill - stop)
            if kutty_mode:
                # Fixed ₹ target/stop in pts
                risk = sl_rs / rs
                stop = fill - p["dir"] * risk
                target = fill + p["dir"] * (tp_rs / rs)
            else:
                if risk < min_risk or risk > max_risk:
                    continue
                target = fill + p["dir"] * risk * rr
            open_t = {
                "dir": p["dir"],
                "entry": fill,
                "stop": stop,
                "target": target,
                "risk": risk,
                "mfe": 0.0,
                "mae": 0.0,
            }
            continue

        if not (entry_s <= mm <= entry_e) or ema[i] != ema[i]:
            continue
        j0 = i
        while j0 > 0 and days[j0 - 1] == day:
            j0 -= 1
        if i - j0 < 5:
            continue
        sh, slv = swing_hl(h, l, i, 5)
        pierce, slpad = 3.0, 2.0
        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        trap_buy = ll < slv - pierce and cc > slv and cc > oo
        trap_sell = hh > sh + pierce and cc < sh and cc < oo
        rng = max(hh - ll, 1e-9)
        bounce_buy = (
            ll <= slv + pierce
            and ll >= slv - pierce * 2
            and cc > oo
            and cc >= slv
            and (hh - cc) / rng < 0.35
        )
        bounce_sell = (
            hh >= sh - pierce
            and hh <= sh + pierce * 2
            and cc < oo
            and cc <= sh
            and (cc - ll) / rng < 0.35
        )
        d = 0
        stop = 0.0
        if (trap_buy or bounce_buy) and cc > ema[i]:
            d = 1
            stop = ll - slpad
        elif (trap_sell or bounce_sell) and cc < ema[i]:
            d = -1
            stop = hh + slpad
        if not d:
            continue
        risk = abs(cc - stop)
        if not kutty_mode and (risk < min_risk or risk > max_risk):
            continue
        pending = {"dir": d, "stop": stop, "sig": cc}

    return trades


def simulate_donch_proxy(
    mk: dict,
    *,
    rr: float = 2.0,
    max_trades: int = 4,
    day_stop_pts: float = 40,
    donch: int = 20,
    peak_trail: tuple[float, float, float] | None = None,
    soft: tuple[float, float, float] | None = None,
) -> list[dict]:
    """Lightweight Donch-20 break → later retest · OR-mid · RR exit (research proxy)."""
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins = mk["days"], mk["mins"]
    n, rs = mk["n"], mk["rs"]
    trades: list[dict] = []
    armed = None  # {dir, level, stop}
    open_t = None
    day_net = 0.0
    trades_today = 0
    cur_day = None
    or_hi = or_lo = None

    for i in range(donch + 2, n):
        day = days[i]
        mm = int(mins[i])
        if day != cur_day:
            cur_day = day
            day_net = 0.0
            trades_today = 0
            armed = None
            open_t = None
            or_hi = or_lo = None

        # Build OR until 09:45
        if mm < 9 * 60 + 45:
            or_hi = float(h[i]) if or_hi is None else max(or_hi, float(h[i]))
            or_lo = float(l[i]) if or_lo is None else min(or_lo, float(l[i]))
            continue
        if or_hi is None or or_lo is None:
            continue
        or_mid = 0.5 * (or_hi + or_lo)

        if open_t is not None:
            d = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            target = open_t["target"]
            risk0 = open_t["risk"]
            fav = (h[i] - entry) if d == 1 else (entry - l[i])
            adv = (entry - l[i]) if d == 1 else (h[i] - entry)
            open_t["mfe"] = max(open_t["mfe"], max(0.0, float(fav)))
            open_t["mae"] = max(open_t["mae"], max(0.0, float(adv)))
            mfe, mae = open_t["mfe"], open_t["mae"]

            if peak_trail:
                arm_rs, lock_rs, gb_rs = peak_trail
                peak_rs = mfe * rs
                if peak_rs >= arm_rs:
                    floor_pts = max(lock_rs, peak_rs - gb_rs) / rs
                    lock_stop = entry + d * floor_pts
                    if d == 1 and lock_stop > stop:
                        stop = lock_stop
                    elif d == -1 and lock_stop < stop:
                        stop = lock_stop
                    open_t["stop"] = stop

            exit_px = reason = None
            if soft and risk0 > 0:
                frac_r, soft_rs, max_mfe_r = soft
                against = (c[i] < entry) if d == 1 else (c[i] > entry)
                conf = (c[i] < o[i]) if d == 1 else (c[i] > o[i])
                if mfe < max_mfe_r * risk0 and against and conf:
                    if mae >= frac_r * risk0 or mae * rs >= soft_rs:
                        exit_px, reason = float(c[i]), "cutoff_soft"
            if exit_px is None:
                if d == 1:
                    if l[i] <= stop:
                        exit_px, reason = stop, "sl"
                    elif h[i] >= target:
                        exit_px, reason = target, "tp"
                else:
                    if h[i] >= stop:
                        exit_px, reason = stop, "sl"
                    elif l[i] <= target:
                        exit_px, reason = target, "tp"
                if exit_px is None and mm >= EXIT_M:
                    exit_px, reason = float(c[i]), "eod"
            if exit_px is not None:
                pts = d * (exit_px - entry)
                trades.append({"day": day, "pts": pts, "rs": pts * rs, "reason": reason, "mfe": mfe, "mae": mae, "risk": risk0})
                day_net += pts
                trades_today += 1
                open_t = None
            continue

        if day_net <= -day_stop_pts or trades_today >= max_trades or mm > 15 * 60 + 10:
            continue

        # Donchian break arm
        up = float(h[i - donch : i].max())
        dn = float(l[i - donch : i].min())
        cc = float(c[i])
        if cc > up and cc >= or_mid:
            armed = {"dir": 1, "level": up, "stop": float(l[i])}
        elif cc < dn and cc <= or_mid:
            armed = {"dir": -1, "level": dn, "stop": float(h[i])}

        # Retest: touch level then reject
        if armed is not None:
            d = armed["dir"]
            lvl = armed["level"]
            if d == 1 and float(l[i]) <= lvl <= float(h[i]) and cc > lvl and cc > float(o[i]):
                fill = cc
                stop = min(armed["stop"], fill - 1)
                risk = abs(fill - stop)
                if 3 <= risk <= 35:
                    open_t = {
                        "dir": 1,
                        "entry": fill,
                        "stop": stop,
                        "target": fill + risk * rr,
                        "risk": risk,
                        "mfe": 0.0,
                        "mae": 0.0,
                    }
                    armed = None
            elif d == -1 and float(l[i]) <= lvl <= float(h[i]) and cc < lvl and cc < float(o[i]):
                fill = cc
                stop = max(armed["stop"], fill + 1)
                risk = abs(fill - stop)
                if 3 <= risk <= 50:
                    open_t = {
                        "dir": -1,
                        "entry": fill,
                        "stop": stop,
                        "target": fill - risk * rr,
                        "risk": risk,
                        "mfe": 0.0,
                        "mae": 0.0,
                    }
                    armed = None

    return trades


def summarize(trades: list[dict], label: str, oos_from: str) -> dict:
    t = [x for x in trades if x["day"] >= oos_from]
    if not t:
        return {"label": label, "n": 0, "net": 0, "avg_day": 0, "green": 0, "red": 0, "pf": 0}
    by: dict[str, float] = defaultdict(float)
    for x in t:
        by[x["day"]] += x["rs"]
    nets = np.array(list(by.values()))
    rs = np.array([x["rs"] for x in t])
    wins = float(rs[rs > 0].sum())
    loss = float(-rs[rs < 0].sum())
    pf = wins / loss if loss > 0 else 99.0
    traded_days = nets[np.abs(nets) > 1e-9]
    green = float((traded_days > 0).mean()) if len(traded_days) else 0.0
    red = float((traded_days < 0).mean()) if len(traded_days) else 0.0
    big = [x for x in t if x["rs"] <= -900]
    return {
        "label": label,
        "n": len(t),
        "days": len(by),
        "net": round(float(rs.sum()), 0),
        "avg_day": round(float(nets.mean()), 1),
        "green": round(green * 100, 1),
        "red": round(red * 100, 1),
        "pf": round(float(pf), 2),
        "avg_loss": round(float(rs[rs < 0].mean()), 0) if (rs < 0).any() else 0,
        "worst_day": round(float(nets.min()), 0),
        "big_loss_n": len(big),
        "cuts": sum(1 for x in t if str(x.get("reason", "")).startswith("cutoff")),
        "trails": sum(1 for x in t if x.get("reason") == "peak_trail"),
        "sls": sum(1 for x in t if x.get("reason") == "sl"),
    }


def combine(tn: list[dict], tb: list[dict]) -> list[dict]:
    return tn + tb


def main() -> None:
    n_path, b_path, source, oos_from = resolve_cache()
    nifty = load(n_path, 65.0)
    bank = load(b_path, 30.0)

    books: list[tuple[str, list[dict]]] = []

    # 1) Trap bare
    books.append(
        (
            "trap_bare",
            combine(
                simulate_trap(nifty, min_risk=4, max_risk=28),
                simulate_trap(bank, min_risk=8, max_risk=50),
            ),
        )
    )
    # 2) Trap + wired protect
    books.append(
        (
            "trap_protect",
            combine(
                simulate_trap(nifty, min_risk=4, max_risk=28, peak_trail=TRAP_PEAK, soft=TRAP_SOFT),
                simulate_trap(bank, min_risk=8, max_risk=50, peak_trail=TRAP_PEAK, soft=TRAP_SOFT),
            ),
        )
    )

    # 3) Day-loss / bank-quit grid on protect DNA
    for dl in (1500, 2000, 2500, 3000):
        books.append(
            (
                f"trap_protect_dayloss_{dl}",
                combine(
                    simulate_trap(
                        nifty,
                        min_risk=4,
                        max_risk=28,
                        peak_trail=TRAP_PEAK,
                        soft=TRAP_SOFT,
                        day_loss_rs=float(dl),
                    ),
                    simulate_trap(
                        bank,
                        min_risk=8,
                        max_risk=50,
                        peak_trail=TRAP_PEAK,
                        soft=TRAP_SOFT,
                        day_loss_rs=float(dl),
                    ),
                ),
            )
        )
    for bq in (800, 1000, 1200, 1500):
        books.append(
            (
                f"trap_protect_bankquit_{bq}",
                combine(
                    simulate_trap(
                        nifty,
                        min_risk=4,
                        max_risk=28,
                        peak_trail=TRAP_PEAK,
                        soft=TRAP_SOFT,
                        day_bank_rs=float(bq),
                        day_loss_rs=2000.0,
                        max_trades=2,
                        rr=2.0,
                    ),
                    simulate_trap(
                        bank,
                        min_risk=8,
                        max_risk=50,
                        peak_trail=TRAP_PEAK,
                        soft=TRAP_SOFT,
                        day_bank_rs=float(bq),
                        day_loss_rs=2000.0,
                        max_trades=2,
                        rr=2.0,
                    ),
                ),
            )
        )

    # 4) Genie-proxy (same entry DNA as Trap hunt's genie stand-in: tighter window, lower RR)
    books.append(
        (
            "genie_protect",
            combine(
                simulate_trap(
                    nifty,
                    rr=3.0,
                    max_trades=2,
                    day_stop_pts=60,
                    entry_s=10 * 60 + 15,
                    entry_e=14 * 60 + 30,
                    peak_trail=TRAP_PEAK,
                    soft=TRAP_SOFT,
                ),
                simulate_trap(
                    bank,
                    rr=1.5,
                    max_trades=1,
                    day_stop_pts=60,
                    min_risk=8,
                    max_risk=45,
                    entry_s=10 * 60 + 15,
                    entry_e=14 * 60 + 30,
                    peak_trail=TRAP_PEAK,
                    soft=TRAP_SOFT,
                ),
            ),
        )
    )

    # 5) Kutty fixed
    books.append(
        (
            "kutty_fixed",
            combine(
                simulate_trap(
                    nifty,
                    kutty_mode=True,
                    max_trades=2,
                    entry_s=10 * 60,
                    entry_e=14 * 60 + 30,
                    day_stop_pts=40,
                ),
                simulate_trap(
                    bank,
                    kutty_mode=True,
                    max_trades=2,
                    entry_s=10 * 60,
                    entry_e=14 * 60 + 30,
                    day_stop_pts=40,
                    min_risk=8,
                    max_risk=50,
                ),
            ),
        )
    )

    # 6) Donch proxy ± protect
    books.append(
        (
            "donch_bare",
            combine(simulate_donch_proxy(nifty), simulate_donch_proxy(bank)),
        )
    )
    books.append(
        (
            "donch_protect",
            combine(
                simulate_donch_proxy(nifty, peak_trail=TRAP_PEAK, soft=TRAP_SOFT),
                simulate_donch_proxy(bank, peak_trail=TRAP_PEAK, soft=TRAP_SOFT),
            ),
        )
    )

    # Stack: Trap protect + Kutty (independent — approximate by summing day nets)
    trap_p = dict(books)["trap_protect"]
    kutty = dict(books)["kutty_fixed"]
    # Approximate stack: per-day sum (overstates if same-bar conflict; research upper bound)
    by_t: dict[str, float] = defaultdict(float)
    by_k: dict[str, float] = defaultdict(float)
    for x in trap_p:
        by_t[x["day"]] += x["rs"]
    for x in kutty:
        by_k[x["day"]] += x["rs"]
    stack_days = sorted(set(by_t) | set(by_k))
    stack_trades = [
        {"day": d, "pts": 0.0, "rs": by_t.get(d, 0.0) + by_k.get(d, 0.0), "reason": "stack"}
        for d in stack_days
        if d >= oos_from
    ]
    books.append(("trap_plus_kutty_upper", stack_trades))

    rows = [summarize(tr, name, oos_from) for name, tr in books]
    # Pick best: closest to trap_protect on avg_day, then prefer higher green / fewer big losses
    base = next(r for r in rows if r["label"] == "trap_protect")
    peers = [r for r in rows if r["label"] != "trap_protect" and r["n"] > 0]

    def score(r: dict) -> tuple:
        # Prefer match-or-beat trap protect avg_day, then green, then fewer big losses
        return (r["avg_day"], r["green"], -r.get("big_loss_n", 0), r["net"])

    peers_sorted = sorted(peers, key=score, reverse=True)
    champ = peers_sorted[0] if peers_sorted else base

    # Day-loss champ among protect+dayloss that keeps ≥90% of trap_protect avg_day
    dayloss = [
        r
        for r in rows
        if r["label"].startswith("trap_protect_dayloss_")
        and r["avg_day"] >= base["avg_day"] * 0.9
    ]
    dayloss_champ = (
        sorted(dayloss, key=lambda r: (r.get("big_loss_n", 99), -r["avg_day"]))[0]
        if dayloss
        else None
    )

    summary = {
        "source": source,
        "oos_from": oos_from,
        "n_path": str(n_path.name),
        "b_path": str(b_path.name),
        "bars_nifty": int(nifty["n"]),
        "bars_bank": int(bank["n"]),
        "wired_protect": {
            "profitLockArmRs": 600,
            "profitLockLockRs": 300,
            "profitLockGivebackRs": 300,
            "slConfirmCutoffFracR": 0.55,
            "slConfirmSoftRs": 700,
            "slConfirmCutoffMaxMfeR": 0.75,
        },
        "table": rows,
        "trap_protect": base,
        "best_peer": champ,
        "dayloss_champ": dayloss_champ,
        "verdict": (
            "Trap+protect remains the production DNA. "
            "Peers that beat it on this window are noted in best_peer; "
            "day-loss cutoffs only wire if dayloss_champ keeps ≥90% of Trap protect avg/day."
        ),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))

    lines = [
        f"{'book':<32} {'net':>8} {'₹/day':>7} {'g%':>5} {'r%':>5} {'pf':>5} {'bigN':>4} {'avgL':>6} {'worst':>7}"
    ]
    for r in rows:
        lines.append(
            f"{r['label']:<32} {r['net']:8.0f} {r['avg_day']:7.0f} {r['green']:4.1f}% "
            f"{r['red']:4.1f}% {r['pf']:5.2f} {r.get('big_loss_n',0):4d} "
            f"{r.get('avg_loss',0):6.0f} {r.get('worst_day',0):7.0f}"
        )
    table = "\n".join(lines)
    report = (
        f"# Trap peer + loss cutoff hunt\n\n"
        f"Source: **{source}** · OOS from {oos_from} · Nifty+Bank index ₹ proxy\n\n"
        f"```\n{table}\n```\n\n"
        f"## Trap protect (wired)\n\n```json\n{json.dumps(base, indent=2)}\n```\n\n"
        f"## Best peer on this window\n\n```json\n{json.dumps(champ, indent=2)}\n```\n\n"
        f"## Day-loss champ (≥90% of Trap protect ₹/day)\n\n"
        f"```json\n{json.dumps(dayloss_champ, indent=2)}\n```\n"
    )
    (OUT / "README.md").write_text(report)
    print(report)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
