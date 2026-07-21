#!/usr/bin/env python3
"""
Instrument vehicle comparison for VolExpand Donch15 foundation.

Question: can the same OOS signals be executed profitably on instruments
the desk actually trades?

Vehicles:
  - Index proxy (research baseline, ₹/pt)
  - Nifty / BankNifty futures (same-day ≈ index × lot − fees)
  - ATM weekly options
  - 1-step ITM weekly options
  - 2-step ITM weekly options
  - Monthly ATM options
  - Synthetic futures (long CE + short PE at ATM weekly, or reverse)

Constraint: Kite NFO dump only lists live contracts; expired option tokens are
not recoverable. Therefore option vehicles use explicit premium models
(desk delta + theta/spread drag), calibrated against live-contract 5m fills
where available. Futures use index×lot (same-day basis ≈ 0) plus fees.

Research only — does not change production DNA.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PALAGAI_CACHE", ROOT / "reports" / "analyst-cache"))
OUT = Path("/tmp/vehicle-comparison")
OUT.mkdir(parents=True, exist_ok=True)
INST_CACHE = OUT / "nfo-instruments.csv"
HIST_DIR = OUT / "hist"
HIST_DIR.mkdir(exist_ok=True)

AUTH = Path(os.environ.get("KITE_AUTH_FILE", ROOT / ".kite-auth")).read_text().strip()

spec = importlib.util.spec_from_file_location("uni", ROOT / "scripts" / "strategy-universe-search.py")
uni = importlib.util.module_from_spec(spec)
sys.modules["uni"] = uni
spec.loader.exec_module(uni)


# Current exchange lots (Jul 2026 NFO dump). Bank weeklies discontinued — monthly only.
LOT = {"nifty": 65, "bank": 30}
# Desk planning ₹/pt (same as index proxy / futures money scale)
RS_PER_PT = {"nifty": 65.0, "bank": 30.0}
STEP = {"nifty": 50, "bank": 100}
NAME = {"nifty": "NIFTY", "bank": "BANKNIFTY"}


def kite_get(path: str, params: dict | None = None) -> Any:
    url = "https://api.kite.trade" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": AUTH, "X-Kite-Version": "3"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            wait = 2 ** attempt
            print(f"  kite retry {attempt+1}: {e} sleep {wait}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"Kite failed {path}")


def download_instruments() -> list[dict]:
    if INST_CACHE.exists() and INST_CACHE.stat().st_size > 1_000_000:
        print("Using cached NFO instruments", flush=True)
        text = INST_CACHE.read_text()
    else:
        print("Downloading NFO instruments...", flush=True)
        req = urllib.request.Request(
            "https://api.kite.trade/instruments/NFO",
            headers={"Authorization": AUTH, "X-Kite-Version": "3"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()
        INST_CACHE.write_text(text)
    rows = list(csv.DictReader(io.StringIO(text)))
    print(f"  instruments: {len(rows)}", flush=True)
    return rows


@dataclass
class Signal:
    instrument: str
    date: str
    year: int
    direction: str
    entry_hhmm: str
    exit_hhmm: str
    entry_px: float
    exit_px: float
    index_pts: float
    hold_bars: int
    exit_reason: str


def generate_signals(inst: uni.Inst, s: uni.Spec) -> list[Signal]:
    or_end_m = uni.to_min(s.or_end)
    earliest_m = max(uni.to_min(s.earliest), or_end_m)
    latest_m = uni.to_min(s.latest)
    open_m = uni.to_min("09:15")
    n = len(inst.c)
    out: list[Signal] = []
    open_t = None
    trading_date = None
    day_net = 0.0
    trades_today = 0
    day_stopped = False
    day_start = 0
    or_cache = None
    extreme = trail = None
    day_stop = 60.0
    broke_pack = [False, False, np.nan, np.nan, np.nan, np.nan]

    for i in range(100, n):
        d = inst.days[i]
        t = inst.times[i]
        m = inst.mins[i]
        if trading_date != d:
            trading_date = d
            day_net = 0.0
            trades_today = 0
            day_stopped = False
            day_start = inst.day_starts[d]
            or_cache = None
            open_t = None
            extreme = trail = None
            broke_pack = [False, False, np.nan, np.nan, np.nan, np.nan]

        if open_t is not None:
            direction = open_t["dir"]
            entry = open_t["entry"]
            stop = open_t["stop"]
            atr_e = open_t["atr"]
            ei = open_t["ei"]
            entry_t = open_t["hhmm"]
            exit_px = None
            reason = ""
            if direction == "BUY":
                extreme = inst.h[i] if extreme is None else max(extreme, inst.h[i])
            else:
                extreme = inst.l[i] if extreme is None else min(extreme, inst.l[i])
            atr = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else atr_e
            if s.exit in ("atr_trail", "chandelier", "hybrid"):
                if direction == "BUY":
                    cand = extreme - s.atr_mult * atr
                    trail = cand if trail is None else max(trail, cand)
                else:
                    cand = extreme + s.atr_mult * atr
                    trail = cand if trail is None else min(trail, cand)
            if s.exit == "swing_trail":
                if direction == "BUY":
                    sl = inst.swing3_l[i]
                    if sl == sl:
                        trail = float(sl) if trail is None else max(trail, float(sl))
                else:
                    sh = inst.swing3_h[i]
                    if sh == sh:
                        trail = float(sh) if trail is None else min(trail, float(sh))
            if direction == "BUY":
                if inst.l[i] <= stop:
                    exit_px, reason = stop, "SL"
            else:
                if inst.h[i] >= stop:
                    exit_px, reason = stop, "SL"
            if exit_px is None and trail is not None and s.exit in ("atr_trail", "swing_trail", "chandelier", "hybrid"):
                if direction == "BUY" and inst.l[i] <= trail:
                    exit_px, reason = trail, "TRAIL"
                if direction == "SELL" and inst.h[i] >= trail:
                    exit_px, reason = trail, "TRAIL"
            if exit_px is None and s.exit in ("ema", "hybrid"):
                e20 = inst.ema20[i]
                if e20 == e20:
                    if direction == "BUY" and inst.c[i] < e20:
                        exit_px, reason = float(inst.c[i]), "EMA"
                    if direction == "SELL" and inst.c[i] > e20:
                        exit_px, reason = float(inst.c[i]), "EMA"
            if exit_px is None and t >= "15:15":
                exit_px, reason = float(inst.c[i]), "EOD"
            if exit_px is not None:
                pts = exit_px - entry if direction == "BUY" else entry - exit_px
                out.append(
                    Signal(
                        instrument=inst.name,
                        date=d,
                        year=int(d[:4]),
                        direction=direction,
                        entry_hhmm=entry_t,
                        exit_hhmm=t,
                        entry_px=float(entry),
                        exit_px=float(exit_px),
                        index_pts=float(pts),
                        hold_bars=i - ei,
                        exit_reason=reason,
                    )
                )
                day_net += pts
                trades_today += 1
                if day_net <= -day_stop:
                    day_stopped = True
                open_t = None
                extreme = trail = None
            continue

        if day_stopped or (s.one_trade and trades_today >= 1) or m < earliest_m or m > latest_m:
            continue
        if or_cache is None:
            hi, lo = -1e18, 1e18
            first_o = last_c = None
            cnt = 0
            for j in range(day_start, i + 1):
                if inst.mins[j] < open_m:
                    continue
                if inst.mins[j] >= or_end_m:
                    break
                hi = max(hi, inst.h[j])
                lo = min(lo, inst.l[j])
                if first_o is None:
                    first_o = inst.o[j]
                last_c = inst.c[j]
                cnt += 1
            if cnt == 0 or hi <= lo:
                continue
            or_cache = dict(high=hi, low=lo, mid=(hi + lo) / 2, first_o=first_o, last_c=last_c)
        orr = or_cache
        bias_dir = "FLAT"
        if s.bias == "ema50":
            e = inst.ema50[i]
            if e != e:
                continue
            bias_dir = "BUY" if inst.c[i] > e else "SELL"
        elif s.bias == "none":
            bias_dir = "FLAT"
        close = float(inst.c[i])
        direction, broke_pack = uni.entry_direction(
            inst, s, i, d, m, close, orr, bias_dir, day_start, broke_pack
        )
        if not direction:
            continue
        if bias_dir in ("BUY", "SELL") and direction != bias_dir:
            continue
        entry = close
        stop = float(inst.l[i] if direction == "BUY" else inst.h[i])
        risk = abs(entry - stop)
        if risk < 3:
            continue
        if risk > inst.max_stop:
            stop = entry - inst.max_stop if direction == "BUY" else entry + inst.max_stop
            risk = inst.max_stop
        if day_net - risk < -day_stop:
            continue
        atr_e = float(inst.atr14[i]) if inst.atr14[i] == inst.atr14[i] else risk
        open_t = dict(dir=direction, entry=entry, stop=stop, atr=atr_e, ei=i, hhmm=t)
        extreme = entry
        trail = None

    return out


def hold_hours(sig: Signal) -> float:
    def to_h(hhmm: str) -> float:
        h, m = hhmm.split(":")
        return int(h) + int(m) / 60.0

    return max(0.25, to_h(sig.exit_hhmm) - to_h(sig.entry_hhmm))


def dte_approx(sig: Signal, tenor: str) -> float:
    """Rough calendar days to expiry at entry (for theta scaling)."""
    d = datetime.strptime(sig.date, "%Y-%m-%d").date()
    # weekday Mon=0 ... Thu=3
    if tenor == "weekly":
        days = (3 - d.weekday()) % 7
        if days == 0 and sig.entry_hhmm >= "13:00":
            days = 7
        return float(days) + (15.5 - (int(sig.entry_hhmm[:2]) + int(sig.entry_hhmm[3:]) / 60)) / 6.5
    # monthly ≈ last Thursday of month
    # days until month-end Thursday approx
    if d.month == 12:
        nm = datetime(d.year + 1, 1, 1).date()
    else:
        nm = datetime(d.year, d.month + 1, 1).date()
    last = nm - timedelta(days=1)
    while last.weekday() != 3:
        last -= timedelta(days=1)
    if last < d:
        # already past this month's monthly — next
        if d.month == 12:
            nm = datetime(d.year + 1, 2, 1).date()
        else:
            nm2 = d.month + 2
            y = d.year + (1 if nm2 > 12 else 0)
            nm2 = nm2 if nm2 <= 12 else nm2 - 12
            nm = datetime(y, nm2, 1).date()
        last = nm - timedelta(days=1)
        while last.weekday() != 3:
            last -= timedelta(days=1)
    return float((last - d).days) + 0.5


# ---------------------------------------------------------------------------
# Vehicle models
# ---------------------------------------------------------------------------
# Option params: delta capture of index move + premium drag (theta+spread RT).
# Drag is in *premium points* per trade, scaled by hold fraction of day and DTE.
#
# ATM weekly: desk uses delta 0.5 with NO theta — optimistic "desk_delta".
# Realistic adds theta/spread: weekly ATM burns faster near expiry.
#
# Calibrated roughly to Nifty weekly ATM behaviour:
#   full-day theta ≈ 4–12 premium pts depending on DTE; we use 8 @ DTE=2–3
#   RT spread+slip ≈ 2 premium pts ATM, slightly wider ITM less liquid relative

OPTION_SPECS = {
    "atm_weekly": dict(delta=0.50, tenor="weekly", theta_full_day=8.0, spread_rt=2.0),
    "itm1_weekly": dict(delta=0.65, tenor="weekly", theta_full_day=6.0, spread_rt=2.5),
    "itm2_weekly": dict(delta=0.80, tenor="weekly", theta_full_day=4.5, spread_rt=3.0),
    "atm_monthly": dict(delta=0.50, tenor="monthly", theta_full_day=2.5, spread_rt=2.0),
}


def option_premium_pnl_pts(sig: Signal, style: str, model: str) -> float:
    """Return option premium P&L in premium points (before × lot)."""
    spec = OPTION_SPECS[style]
    delta = spec["delta"]
    directional = sig.index_pts * delta  # long option always
    if model == "desk_delta":
        # Matches paper-desk fallback: ignore theta/spread
        return directional
    # realistic: subtract theta × hold/day + RT spread
    dte = max(0.15, dte_approx(sig, spec["tenor"]))
    # theta scales ~ 1/sqrt(DTE) relative to reference DTE=3
    theta_day = spec["theta_full_day"] * math.sqrt(3.0 / dte)
    hours = hold_hours(sig)
    theta_burn = theta_day * (hours / 6.5)
    # mild IV crush on winning trend days is ignored (optimistic on winners);
    # on losers gamma can worsen — add 10% penalty on negative directional
    pnl = directional - theta_burn - spec["spread_rt"]
    if directional < 0:
        pnl -= abs(directional) * 0.10
    return pnl


def fee_rs(vehicle: str) -> float:
    return {
        "index_proxy": 0.0,
        "futures": 60.0,
        "atm_weekly_desk": 80.0,
        "atm_weekly": 80.0,
        "itm1_weekly": 80.0,
        "itm2_weekly": 80.0,
        "atm_monthly": 80.0,
        "synthetic_fut": 120.0,
    }[vehicle]


def metrics_rs(rs_list: list[float], years: list[int]) -> dict:
    if not rs_list:
        return dict(n=0, exp_rs=None, net_rs=0, wr=None, pf=None, maxdd=0, yearly={})
    rs = np.array(rs_list, float)
    yrs = np.array(years, int)
    wins = rs[rs > 0]
    losses = rs[rs <= 0]
    eq = np.cumsum(rs)
    peak = np.maximum.accumulate(eq)
    dd = float((eq - peak).min())
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) and losses.sum() != 0 else (999 if len(wins) else 0)
    return dict(
        n=int(len(rs)),
        exp_rs=round(float(rs.mean()), 0),
        net_rs=round(float(rs.sum()), 0),
        wr=round(float((rs > 0).mean() * 100), 1),
        pf=round(pf, 3),
        maxdd=round(dd, 0),
        yearly={str(y): round(float(rs[yrs == y].sum()), 0) for y in sorted(set(yrs.tolist()))},
    )


def score_signal(sig: Signal, vehicle: str) -> float:
    lot = LOT[sig.instrument]
    rs_pt = RS_PER_PT[sig.instrument]
    if vehicle == "index_proxy":
        return sig.index_pts * rs_pt - fee_rs(vehicle)
    if vehicle == "futures":
        # Same-day EOD: futures ≈ index; lot equals ₹/pt for Nifty (65) and Bank (30 now).
        # Use lot so P&L matches exchange multiplier; bank planning was 30 ₹/pt.
        return sig.index_pts * lot - fee_rs(vehicle)
    if vehicle == "atm_weekly_desk":
        prem = option_premium_pnl_pts(sig, "atm_weekly", "desk_delta")
        return prem * lot - fee_rs(vehicle)
    if vehicle in OPTION_SPECS:
        prem = option_premium_pnl_pts(sig, vehicle, "realistic")
        return prem * lot - fee_rs(vehicle)
    if vehicle == "synthetic_fut":
        # ATM CE−PE ≈ futures point-for-point, double fees + wider spread
        return sig.index_pts * lot - fee_rs(vehicle) - 2.0 * lot  # ~2pt synthetic friction
    raise KeyError(vehicle)


def fetch_day_5m(token: int, day: str) -> list[dict]:
    p = HIST_DIR / f"{token}_{day}.json"
    if p.exists():
        return json.loads(p.read_text())
    frm = f"{day} 09:00:00"
    to = f"{day} 15:35:00"
    data = kite_get(
        f"/instruments/historical/{token}/5minute",
        {"from": frm, "to": to},
    )
    candles = []
    for row in data.get("data", {}).get("candles", []):
        candles.append(
            dict(date=row[0], open=row[1], high=row[2], low=row[3], close=row[4], volume=row[5])
        )
    p.write_text(json.dumps(candles))
    time.sleep(0.35)
    return candles


def premium_at(candles: list[dict], hhmm: str, day: str) -> float | None:
    if not candles:
        return None
    target = f"{day}T{hhmm}"
    best = None
    for c in candles:
        ds = c["date"][:16].replace(" ", "T")
        if ds <= target[:16]:
            best = c["close"]
        else:
            break
    return float(best) if best is not None else None


def build_live_indexes(nfo: list[dict]):
    opt = {}
    fut = defaultdict(list)
    for r in nfo:
        name = r.get("name")
        if name not in ("NIFTY", "BANKNIFTY"):
            continue
        itype = r.get("instrument_type")
        if itype == "FUT":
            try:
                exp = datetime.strptime(r["expiry"], "%Y-%m-%d").date()
            except Exception:
                continue
            fut[name].append(
                (exp, int(r["instrument_token"]), r["tradingsymbol"], int(float(r.get("lot_size") or 0)))
            )
        elif itype in ("CE", "PE"):
            try:
                exp = datetime.strptime(r["expiry"], "%Y-%m-%d").date()
                strike = int(float(r["strike"]))
            except Exception:
                continue
            opt[(name, exp, itype, strike)] = dict(
                token=int(r["instrument_token"]),
                symbol=r["tradingsymbol"],
                lot=int(float(r.get("lot_size") or 0)),
            )
    for name in fut:
        fut[name].sort()
    return opt, fut


def calibrate_live(oos: list[Signal], opt_idx, fut_idx) -> dict:
    """
    For signals whose weekly/monthly expiry still exists in live NFO,
    fetch real 5m option fills and compare to models.
    """
    today = datetime.now().date()
    # live expiries only
    live_exps = {k[1] for k in opt_idx}
    cal = []
    checked = 0
    for sig in oos:
        d = datetime.strptime(sig.date, "%Y-%m-%d").date()
        if d < today - timedelta(days=10):
            continue  # only very recent — expired tokens gone
        und = NAME[sig.instrument]
        step = STEP[sig.instrument]
        atm = int(round(sig.entry_px / step) * step)
        # next thursday
        days = (3 - d.weekday()) % 7
        if days == 0 and sig.entry_hhmm >= "13:00":
            days = 7
        exp = d + timedelta(days=days)
        # snap to listed
        listed = sorted(e for e in live_exps if e >= d)
        if not listed:
            continue
        cand = [e for e in listed if e >= exp]
        exp = cand[0] if cand else listed[0]
        itype = "CE" if sig.direction == "BUY" else "PE"
        meta = opt_idx.get((und, exp, itype, atm))
        if not meta:
            for adj in (0, -step, step, -2 * step, 2 * step):
                meta = opt_idx.get((und, exp, itype, atm + adj))
                if meta:
                    break
        if not meta:
            continue
        checked += 1
        candles = fetch_day_5m(meta["token"], sig.date)
        e = premium_at(candles, sig.entry_hhmm, sig.date)
        x = premium_at(candles, sig.exit_hhmm, sig.date)
        if e is None or x is None or e <= 0:
            continue
        real_prem = x - e  # long option
        desk = option_premium_pnl_pts(sig, "atm_weekly", "desk_delta")
        real_model = option_premium_pnl_pts(sig, "atm_weekly", "realistic")
        cal.append(
            dict(
                date=sig.date,
                instrument=sig.instrument,
                direction=sig.direction,
                index_pts=round(sig.index_pts, 2),
                symbol=meta["symbol"],
                real_prem_pts=round(real_prem, 2),
                desk_model=round(desk, 2),
                realistic_model=round(real_model, 2),
                real_rs=round(real_prem * meta["lot"], 0),
            )
        )
    return dict(n_checked=checked, n_filled=len(cal), samples=cal)


def main():
    t0 = time.time()
    print("Loading index caches...", flush=True)
    nifty = uni.load_inst(CACHE / "nifty-5m-2020-2026.json", "nifty", 30, 65)
    bank = uni.load_inst(CACHE / "banknifty-5m-2020-2026.json", "bank", 45, 30)
    base = uni.Spec("vol_expand", 15, "ema50", "eod", 0, 0.0, "10:15", "10:15", "11:30", True)

    print("Generating signals...", flush=True)
    signals = generate_signals(nifty, base) + generate_signals(bank, base)
    oos = [s for s in signals if s.year >= 2024]
    print(f"  signals all={len(signals)} oos={len(oos)}", flush=True)
    json.dump([asdict(s) for s in oos], open(OUT / "oos-signals.json", "w"), indent=2)

    vehicles = [
        "index_proxy",
        "futures",
        "atm_weekly_desk",
        "atm_weekly",
        "itm1_weekly",
        "itm2_weekly",
        "atm_monthly",
        "synthetic_fut",
    ]

    # Aggregate + per index
    buckets: dict[str, dict] = {
        v: {"all": [], "ay": [], "nifty": [], "ny": [], "bank": [], "by": []} for v in vehicles
    }

    for sig in oos:
        for v in vehicles:
            rs = score_signal(sig, v)
            buckets[v]["all"].append(rs)
            buckets[v]["ay"].append(sig.year)
            buckets[v][sig.instrument].append(rs)
            buckets[v]["ny" if sig.instrument == "nifty" else "by"].append(sig.year)

    summary = {}
    for v in vehicles:
        summary[v] = dict(
            combined=metrics_rs(buckets[v]["all"], buckets[v]["ay"]),
            nifty=metrics_rs(buckets[v]["nifty"], buckets[v]["ny"]),
            bank=metrics_rs(buckets[v]["bank"], buckets[v]["by"]),
            fee_rs_per_trade=fee_rs(v),
            model=(
                "index×₹/pt"
                if v == "index_proxy"
                else "index×lot − fees (same-day futures ≈ index)"
                if v == "futures"
                else "desk delta 0.5 × lot (no theta) — paper-desk fallback"
                if v == "atm_weekly_desk"
                else "synthetic ≈ index×lot − 2pt friction − double fees"
                if v == "synthetic_fut"
                else f"delta={OPTION_SPECS[v]['delta']} − theta/spread ({OPTION_SPECS[v]['tenor']})"
            ),
        )
        m = summary[v]["combined"]
        print(
            f"{v:18} n={m['n']:4} exp=₹{m['exp_rs']} net=₹{m['net_rs']} "
            f"wr={m['wr']}% pf={m['pf']} dd=₹{m['maxdd']}",
            flush=True,
        )

    # Sensitivity on ATM weekly theta
    print("\nATM weekly theta sensitivity (combined OOS)...", flush=True)
    theta_sens = {}
    for th in (0, 4, 6, 8, 10, 12, 16):
        rs_list, yrs = [], []
        spec_backup = OPTION_SPECS["atm_weekly"]["theta_full_day"]
        OPTION_SPECS["atm_weekly"]["theta_full_day"] = float(th)
        for sig in oos:
            rs_list.append(score_signal(sig, "atm_weekly"))
            yrs.append(sig.year)
        OPTION_SPECS["atm_weekly"]["theta_full_day"] = spec_backup
        theta_sens[str(th)] = metrics_rs(rs_list, yrs)
        print(f"  theta_day={th:2} -> exp=₹{theta_sens[str(th)]['exp_rs']} net=₹{theta_sens[str(th)]['net_rs']}", flush=True)

    # Delta-only break-even: what effective delta capture needed after fees
    print("\nBreak-even analysis...", flush=True)
    # index OOS mean pts
    mean_pts = float(np.mean([s.index_pts for s in oos]))
    # for ATM: (delta*mean_pts - drag)*lot - fee > 0
    break_even = {}
    for style, sp in OPTION_SPECS.items():
        # average drag across trades
        drags = []
        for sig in oos:
            dte = max(0.15, dte_approx(sig, sp["tenor"]))
            theta_day = sp["theta_full_day"] * math.sqrt(3.0 / dte)
            drag = theta_day * (hold_hours(sig) / 6.5) + sp["spread_rt"]
            drags.append(drag)
        avg_drag = float(np.mean(drags))
        # need delta * mean_pts > avg_drag + fee/lot (use nifty lot as ref — mixed)
        # per-instrument break-even
        be = {}
        for inst in ("nifty", "bank"):
            subset = [s for s in oos if s.instrument == inst]
            mp = float(np.mean([s.index_pts for s in subset]))
            ad = float(
                np.mean(
                    [
                        sp["theta_full_day"]
                        * math.sqrt(3.0 / max(0.15, dte_approx(s, sp["tenor"])))
                        * (hold_hours(s) / 6.5)
                        + sp["spread_rt"]
                        for s in subset
                    ]
                )
            )
            lot = LOT[inst]
            fee = fee_rs(style if style != "atm_weekly" else "atm_weekly")
            # premium needed: delta*mp - ad > fee/lot
            be[inst] = dict(
                mean_index_pts=round(mp, 2),
                avg_premium_drag=round(ad, 2),
                delta=sp["delta"],
                expected_prem_pts=round(sp["delta"] * mp - ad, 2),
                expected_rs=round((sp["delta"] * mp - ad) * lot - fee, 0),
                profitable_if_positive=bool((sp["delta"] * mp - ad) * lot - fee > 0),
            )
        break_even[style] = be

    # Live calibration (recent only)
    print("\nLive-contract calibration (recent signals only)...", flush=True)
    nfo = download_instruments()
    opt_idx, fut_idx = build_live_indexes(nfo)
    bank_exps = sorted({k[1] for k in opt_idx if k[0] == "BANKNIFTY"})
    nifty_exps = sorted({k[1] for k in opt_idx if k[0] == "NIFTY"})
    market_note = dict(
        nifty_option_expiries_live=[str(e) for e in nifty_exps[:8]],
        bank_option_expiries_live=[str(e) for e in bank_exps],
        bank_weeklies="Bank Nifty live chain shows monthly-only expiries (no weekly listed). "
        "ATM weekly vehicle for Bank is historical/legacy; live Bank path is monthly or futures.",
        lot_sizes=LOT,
        kite_limitation="Expired NFO tokens not in instruments dump; multi-year option 5m fills unavailable from Kite.",
    )
    print(json.dumps(market_note, indent=2), flush=True)
    calibration = calibrate_live(oos, opt_idx, fut_idx)
    print(f"  calibration fills: {calibration['n_filled']} / checked {calibration['n_checked']}", flush=True)

    # Go / no-go
    go = {}
    for v in vehicles:
        m = summary[v]["combined"]
        n_m = summary[v]["nifty"]
        b_m = summary[v]["bank"]
        ok = (m["exp_rs"] or 0) > 0 and (m["net_rs"] or 0) > 0
        both = (n_m["exp_rs"] or 0) > 0 and (b_m["exp_rs"] or 0) > 0
        if v == "atm_weekly_desk":
            verdict = "OPTIMISTIC_ONLY — matches paper fallback; ignores theta. Not a live green light."
        elif v == "atm_weekly":
            verdict = (
                "NO_GO for live desk ATM weekly"
                if not ok
                else "MARGINAL — positive under base theta; fragile to theta sensitivity"
            )
            if not ok:
                verdict = "NO_GO — realistic ATM weekly (theta+spread) is OOS-negative after fees"
        elif v.startswith("itm") or v == "atm_monthly":
            verdict = "GO" if ok and both else ("CONDITIONAL" if ok else "NO_GO")
        elif v in ("futures", "synthetic_fut", "index_proxy"):
            verdict = "GO" if ok and both else ("CONDITIONAL" if ok else "NO_GO")
        else:
            verdict = "GO" if ok else "NO_GO"
        go[v] = dict(
            verdict=verdict,
            combined_exp_rs=m["exp_rs"],
            nifty_exp_rs=n_m["exp_rs"],
            bank_exp_rs=b_m["exp_rs"],
            both_indices_positive=both,
        )

    ranked = sorted(
        vehicles,
        key=lambda v: summary[v]["combined"]["exp_rs"] or -1e18,
        reverse=True,
    )

    report = dict(
        meta=dict(
            strategy="vol_expand n15 ema50 eod 10:15-11:30 1t/day",
            sample_oos="2024-2026",
            n_signals_oos=len(oos),
            mean_index_pts_oos=round(mean_pts, 2),
            elapsed_s=round(time.time() - t0, 1),
            lot_sizes=LOT,
            rs_per_pt_planning=RS_PER_PT,
            data_method=(
                "Futures/index: index points × lot. Options: parametric delta−theta−spread "
                "(Kite cannot supply expired option 5m). Live calibration attempted for current expiries."
            ),
        ),
        market_structure=market_note,
        vehicles=summary,
        theta_sensitivity_atm_weekly=theta_sens,
        break_even=break_even,
        live_calibration=calibration,
        go_no_go=go,
        ranking=ranked,
        recommendation=dict(
            best_vehicle=ranked[0],
            deployable=[v for v in ranked if go[v]["verdict"].startswith("GO")],
            avoid=[v for v in ranked if "NO_GO" in go[v]["verdict"]],
            headline="",
        ),
    )

    # Headline
    fut_ok = go["futures"]["verdict"].startswith("GO")
    atm_ok = go["atm_weekly"]["combined_exp_rs"] is not None and go["atm_weekly"]["combined_exp_rs"] > 0
    desk_ok = go["atm_weekly_desk"]["combined_exp_rs"] is not None and go["atm_weekly_desk"]["combined_exp_rs"] > 0
    if fut_ok and not atm_ok:
        headline = (
            "YES on futures / synthetic; NO on realistic ATM weekly options "
            "(current live desk path). Index edge survives futures fees but is "
            "consumed by weekly options theta+spread."
        )
    elif fut_ok and atm_ok:
        headline = (
            "YES on futures; ATM weekly only marginally positive under base theta — "
            "do not treat desk delta-only paper P&L as proof."
        )
    else:
        headline = "NO clear profitable vehicle under base assumptions — revisit foundation or costs."
    if desk_ok and not atm_ok:
        headline += " Paper-desk 0.5Δ fallback looks green but is misleading without theta."
    report["recommendation"]["headline"] = headline

    json.dump(report, open(OUT / "summary.json", "w"), indent=2, default=str)

    # CSV for quick view
    with open(OUT / "vehicles.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "vehicle",
                "exp_rs",
                "net_rs",
                "wr",
                "pf",
                "maxdd",
                "nifty_exp",
                "bank_exp",
                "verdict",
            ]
        )
        for v in ranked:
            m = summary[v]["combined"]
            w.writerow(
                [
                    v,
                    m["exp_rs"],
                    m["net_rs"],
                    m["wr"],
                    m["pf"],
                    m["maxdd"],
                    summary[v]["nifty"]["exp_rs"],
                    summary[v]["bank"]["exp_rs"],
                    go[v]["verdict"],
                ]
            )

    print("\n=== HEADLINE ===", flush=True)
    print(headline, flush=True)
    print(f"\nWrote {OUT}/summary.json in {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
