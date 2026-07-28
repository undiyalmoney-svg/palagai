#!/usr/bin/env python3
"""
Trap RCA — rejection / missed-opportunity / profit-protect counterfactuals.

Mirrors app DNA in sr-trap-confirm.engine.ts (NOT the hunt script defaults):
  - next-bar confirm at open
  - trapMode=both, swingLb=5, pierce=3, slPad=2
  - EMA50 bias, entry 09:45–14:45, exit 15:15
  - max 3 trades/day, dayStop 80 pts
  - Nifty risk 4–28 · Bank 8–50
  - NO cooldown (app has none; hunt uses cd=3)
  - profitProtectEnabled=false (baseline)

Evidence sources (prefer Kite 5y cache):
  reports/analyst-cache/nifty-5m-2020-2026.json
  reports/analyst-cache/banknifty-5m-2020-2026.json
Fallback: *-5m-recent-60d.json (Yahoo)

    python3 scripts/trap-rca-missed-opportunities.py
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "trap-rca"
OUT.mkdir(parents=True, exist_ok=True)
TRAIN_END = "2023-12-31"
TEST_START = "2024-01-01"

EXIT_M = 15 * 60 + 15
ENTRY_S = 9 * 60 + 45
ENTRY_E = 14 * 60 + 45


def to_min(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def load(path: Path, rs: float) -> dict:
    rows = json.loads(path.read_text())
    o = np.array([r["open"] for r in rows], float)
    h = np.array([r["high"] for r in rows], float)
    l = np.array([r["low"] for r in rows], float)
    c = np.array([r["close"] for r in rows], float)
    days = np.array([r["date"][:10] for r in rows])
    mins = np.array([to_min(r["date"][11:16]) for r in rows])
    k = 2 / 51
    ema = np.full(len(c), np.nan)
    ema[49] = float(c[:50].mean())
    for i in range(50, len(c)):
        ema[i] = c[i] * k + ema[i - 1] * (1 - k)
    return dict(o=o, h=h, l=l, c=c, days=days, mins=mins, ema=ema, rs=rs, n=len(c))


def swing_hl(h, l, i, lb):
    start = max(0, i - lb)
    if start >= i:
        return float(h[i]), float(l[i])
    return float(h[start:i].max()), float(l[start:i].min())


@dataclass
class Trade:
    day: str
    book: str
    dir: int
    entry_i: int
    entry_t: str
    entry: float
    stop: float
    target: float
    exit_i: int = -1
    exit_t: str = ""
    exit: float = 0.0
    exit_reason: str = ""
    pts: float = 0.0
    mfe: float = 0.0
    mae: float = 0.0
    armed_reason: str = ""
    reject_path: list[str] = field(default_factory=list)


@dataclass
class Reject:
    day: str
    book: str
    time: str
    reason: str
    detail: str
    would_pts: float | None = None
    would_rs: float | None = None


def simulate_book(
    mk: dict,
    book: str,
    *,
    min_risk: float,
    max_risk: float,
    cooldown: int = 0,
    profit_protect: tuple[float, float] | None = None,  # (armR, lockR)
    force_take_failed_confirm: bool = False,
    skip_ema: bool = False,
    skip_risk_band: bool = False,
    max_trades: int = 3,
    day_stop: float = 80.0,
    rr: float = 3.5,
    pierce: float = 3.0,
    lb: int = 5,
    track_rejects: bool = True,
) -> tuple[list[Trade], list[Reject], Counter]:
    o, h, l, c = mk["o"], mk["h"], mk["l"], mk["c"]
    days, mins, ema, rs = mk["days"], mk["mins"], mk["ema"], mk["rs"]
    reason_counts: Counter = Counter()
    rejects: list[Reject] = []
    trades: list[Trade] = []

    cur = None
    day_pts = 0.0
    n_trades = 0
    done = False
    open_t: Trade | None = None
    pending = None  # dict
    last_i = -10_000
    day_bar_i = 0

    def mark(reason: str, i: int, detail: str = "", would=None):
        if not track_rejects:
            return
        reason_counts[reason] += 1
        would_pts = would
        rejects.append(
            Reject(
                day=str(days[i]),
                book=book,
                time=f"{int(mins[i]) // 60:02d}:{int(mins[i]) % 60:02d}",
                reason=reason,
                detail=detail,
                would_pts=would_pts,
                would_rs=(would_pts * rs) if would_pts is not None else None,
            )
        )

    def counterfactual_path(i0: int, direction: int, fill: float, stop: float) -> float | None:
        """If we entered here, what pts to SL/TP/EOD (no protect)."""
        risk = abs(fill - stop)
        if risk <= 0:
            return None
        tgt = fill + rr * risk if direction == 1 else fill - rr * risk
        mfe = mae = 0.0
        for j in range(i0, len(c)):
            if days[j] != days[i0]:
                break
            if direction == 1:
                mfe = max(mfe, float(h[j] - fill))
                mae = max(mae, float(fill - l[j]))
                if l[j] <= stop:
                    return stop - fill
                if h[j] >= tgt:
                    return tgt - fill
            else:
                mfe = max(mfe, float(fill - l[j]))
                mae = max(mae, float(h[j] - fill))
                if h[j] >= stop:
                    return fill - stop
                if l[j] <= tgt:
                    return fill - tgt
            if int(mins[j]) >= EXIT_M:
                return (float(c[j]) - fill) if direction == 1 else (fill - float(c[j]))
        return None

    for i in range(50, len(c)):
        d = str(days[i])
        mm = int(mins[i])
        if d != cur:
            cur = d
            day_pts = 0.0
            n_trades = 0
            done = False
            pending = None
            day_bar_i = 0
            # do not clear open across days — force EOD before day change handled below

        day_bar_i += 1

        # Manage open
        if open_t is not None:
            t = open_t
            # profit protect
            if profit_protect is not None:
                arm_r, lock_r = profit_protect
                risk0 = abs(t.entry - t.stop) if t.mfe == 0 and t.mae == 0 else abs(
                    t.entry - (t.entry - (t.target - t.entry) / rr if t.dir == 1 else t.entry + (t.entry - t.target) / rr)
                )
                # recompute initial risk from entry/target
                risk0 = abs(t.target - t.entry) / rr if rr else abs(t.entry - t.stop)
                if t.dir == 1:
                    mfe_now = float(h[i] - t.entry)
                    if mfe_now >= arm_r * risk0:
                        lock_stop = t.entry + lock_r * risk0
                        if lock_stop > t.stop:
                            t.stop = lock_stop
                else:
                    mfe_now = float(t.entry - l[i])
                    if mfe_now >= arm_r * risk0:
                        lock_stop = t.entry - lock_r * risk0
                        if lock_stop < t.stop:
                            t.stop = lock_stop

            px = None
            reason = ""
            if t.dir == 1:
                t.mfe = max(t.mfe, float(h[i] - t.entry))
                t.mae = max(t.mae, float(t.entry - l[i]))
                if l[i] <= t.stop:
                    px, reason = t.stop, "Stop loss hit"
                elif h[i] >= t.target:
                    px, reason = t.target, "Target hit"
            else:
                t.mfe = max(t.mfe, float(t.entry - l[i]))
                t.mae = max(t.mae, float(h[i] - t.entry))
                if h[i] >= t.stop:
                    px, reason = t.stop, "Stop loss hit"
                elif l[i] <= t.target:
                    px, reason = t.target, "Target hit"
            if px is None and mm >= EXIT_M:
                px, reason = float(c[i]), "EOD / session exit"
            if px is not None:
                pts = (px - t.entry) if t.dir == 1 else (t.entry - px)
                t.exit_i = i
                t.exit_t = f"{mm // 60:02d}:{mm % 60:02d}"
                t.exit = float(px)
                t.exit_reason = reason
                t.pts = float(pts)
                trades.append(t)
                day_pts += pts
                n_trades += 1
                last_i = i
                open_t = None
                if day_stop > 0 and day_pts <= -day_stop:
                    done = True
            continue

        # Resolve pending confirm
        if pending is not None:
            p = pending
            pending = None
            if mm < ENTRY_S or mm > ENTRY_E:
                mark("Confirm outside entry window", i)
                continue
            fill = float(o[i])
            cc = float(c[i])
            oo = float(o[i])
            bull_ok = p["dir"] == 1 and cc > oo and cc > p["signal_close"]
            bear_ok = p["dir"] == -1 and cc < oo and cc < p["signal_close"]
            ok = bull_ok or bear_ok
            if not ok:
                # counterfactual: enter anyway at open with same stop
                stop_px = min(p["stop"], fill - 1) if p["dir"] == 1 else max(p["stop"], fill + 1)
                would = counterfactual_path(i, p["dir"], fill, stop_px)
                mark(
                    "Trap confirm failed",
                    i,
                    detail=f"dir={p['dir']} close={cc:.2f} open={oo:.2f} sigClose={p['signal_close']:.2f}",
                    would=would,
                )
                if force_take_failed_confirm:
                    ok = True
                else:
                    continue
            stop_px = min(p["stop"], fill - 1) if p["dir"] == 1 else max(p["stop"], fill + 1)
            risk = abs(fill - stop_px)
            if (not skip_risk_band) and (risk < min_risk or risk > max_risk):
                would = counterfactual_path(i, p["dir"], fill, stop_px)
                mark(
                    f"Risk outside band",
                    i,
                    detail=f"risk={risk:.1f} band={min_risk}-{max_risk}",
                    would=would,
                )
                continue
            if done:
                mark("Day stopped", i)
                continue
            if n_trades >= max_trades:
                mark("Max trades per day reached", i)
                continue
            if i - last_i < cooldown:
                mark("Cooldown", i, detail=f"bars_since={i - last_i} need={cooldown}")
                continue
            target = fill + rr * risk if p["dir"] == 1 else fill - rr * risk
            open_t = Trade(
                day=d,
                book=book,
                dir=p["dir"],
                entry_i=i,
                entry_t=f"{mm // 60:02d}:{mm % 60:02d}",
                entry=fill,
                stop=stop_px,
                target=target,
                armed_reason=p.get("setup", "trap"),
            )
            continue

        if done:
            mark("Day stopped", i)
            continue
        if n_trades >= max_trades:
            if ENTRY_S <= mm <= ENTRY_E:
                mark("Max trades per day reached", i)
            continue
        if mm < ENTRY_S:
            continue
        if mm > ENTRY_E:
            if mm < EXIT_M:
                mark("After entry window", i)
            continue
        if i - last_i < cooldown:
            continue

        # Need enough day bars for swing (approx via scanning same-day index)
        # Find day-local index
        j0 = i
        while j0 > 0 and days[j0 - 1] == d:
            j0 -= 1
        local_i = i - j0
        if local_i < lb:
            mark("Warming swing lookback", i)
            continue

        sh, sl = swing_hl(h, l, i, lb)
        cc, oo, hh, ll = float(c[i]), float(o[i]), float(h[i]), float(l[i])
        e = ema[i]
        if e != e:
            mark("EMA warming up", i)
            continue

        trap_buy = ll < sl - pierce and cc > sl and cc > oo
        trap_sell = hh > sh + pierce and cc < sh and cc < oo
        rng = max(hh - ll, 1e-9)
        bounce_buy = (
            ll <= sl + pierce
            and ll >= sl - pierce * 2
            and cc > oo
            and cc >= sl
            and (hh - cc) / rng < 0.35
        )
        bounce_sell = (
            hh >= sh - pierce
            and hh <= sh + pierce * 2
            and cc < oo
            and cc <= sh
            and (cc - ll) / rng < 0.35
        )

        direction = 0
        stop_px = 0.0
        setup = ""
        if trap_buy or bounce_buy:
            if skip_ema or cc > e:
                direction = 1
                stop_px = ll - 2.0
                setup = "trap_buy" if trap_buy else "bounce_buy"
            else:
                mark("EMA bias blocked BUY setup", i, detail=f"close={cc:.1f} ema={e:.1f}")
        elif trap_sell or bounce_sell:
            if skip_ema or cc < e:
                direction = -1
                stop_px = hh + 2.0
                setup = "trap_sell" if trap_sell else "bounce_sell"
            else:
                mark("EMA bias blocked SELL setup", i, detail=f"close={cc:.1f} ema={e:.1f}")

        if not direction:
            # only count as reject when a raw trap/bounce existed but bias blocked — already marked
            continue

        risk = abs(cc - stop_px)
        if (not skip_risk_band) and (risk < min_risk or risk > max_risk):
            mark(
                "Signal risk outside band",
                i,
                detail=f"risk={risk:.1f} band={min_risk}-{max_risk} setup={setup}",
            )
            continue

        pending = {
            "dir": direction,
            "stop": stop_px,
            "signal_close": cc,
            "setup": setup,
        }
        mark(
            "Trap armed — wait confirm",
            i,
            detail=f"{setup} dir={direction}",
        )

    return trades, rejects, reason_counts


def summarize(trades: list[Trade], rs: float | None = None) -> dict:
    if not trades:
        return dict(n=0, wins=0, losses=0, win_rate=0, pf=0, net_pts=0, net_rs=0, avg_hold_bars=0, max_dd_rs=0, giveback=0)
    wins = [t for t in trades if t.pts > 0]
    losses = [t for t in trades if t.pts < 0]
    gp = sum(t.pts for t in wins)
    gl = -sum(t.pts for t in losses)
    net_pts = sum(t.pts for t in trades)
    # rupees: each trade already on its book rs via caller — here pts only unless rs passed as per-trade
    net_rs = sum(t.pts * (65 if t.book == "nifty" else 30) for t in trades)
    # drawdown on chronological
    eq = 0.0
    peak = 0.0
    max_dd = 0.0
    give = 0.0
    for t in trades:
        r = t.pts * (65 if t.book == "nifty" else 30)
        # giveback: MFE rupees vs realized when realized < MFE and MFE>0
        mfe_rs = t.mfe * (65 if t.book == "nifty" else 30)
        if mfe_rs > 0 and r < mfe_rs:
            give += mfe_rs - max(r, 0)
        eq += r
        peak = max(peak, eq)
        max_dd = min(max_dd, eq - peak)
    holds = [t.exit_i - t.entry_i for t in trades if t.exit_i >= 0]
    return dict(
        n=len(trades),
        wins=len(wins),
        losses=len(losses),
        win_rate=round(100 * len(wins) / len(trades), 1),
        pf=round(gp / gl, 2) if gl > 0 else None,
        net_pts=round(net_pts, 1),
        net_rs=round(net_rs),
        avg_hold_bars=round(sum(holds) / len(holds), 1) if holds else 0,
        avg_hold_min=round(5 * sum(holds) / len(holds), 1) if holds else 0,
        max_dd_rs=round(max_dd),
        giveback_rs=round(give),
        target_exits=sum(1 for t in trades if t.exit_reason == "Target hit"),
        sl_exits=sum(1 for t in trades if t.exit_reason == "Stop loss hit"),
        eod_exits=sum(1 for t in trades if "EOD" in t.exit_reason),
    )


def day_stats(trades: list[Trade]) -> dict:
    by = defaultdict(float)
    for t in trades:
        by[t.day] += t.pts * (65 if t.book == "nifty" else 30)
    if not by:
        return dict(days=0, traded=0, avg=0, green_pct=0, red_pct=0)
    vals = list(by.values())
    traded = [v for v in vals if abs(v) > 1e-6]
    green = sum(1 for v in traded if v > 0)
    red = sum(1 for v in traded if v < 0)
    return dict(
        days=len(by),
        traded=len(traded),
        net=round(sum(vals)),
        avg=round(sum(vals) / len(by)),
        green_pct=round(100 * green / len(traded), 1) if traded else 0,
        red_pct=round(100 * red / len(traded), 1) if traded else 0,
        best=round(max(vals)),
        worst=round(min(vals)),
    )


def run_pair(nifty, bank, **kwargs):
    tn, rn, cn = simulate_book(nifty, "nifty", min_risk=4, max_risk=28, **kwargs)
    tb, rb, cb = simulate_book(bank, "bank", min_risk=8, max_risk=50, **kwargs)
    trades = tn + tb
    rejects = rn + rb
    counts = cn + cb
    return trades, rejects, counts


def detail_day(trades, rejects, day: str) -> dict:
    tday = [t for t in trades if t.day == day]
    rday = [r for r in rejects if r.day == day]
    failed = [r for r in rday if r.reason == "Trap confirm failed"]
    risk = [r for r in rday if "risk" in r.reason.lower() or "Risk" in r.reason]
    ema = [r for r in rday if "EMA bias" in r.reason]
    return {
        "day": day,
        "trades": [
            {
                "book": t.book,
                "dir": "BUY" if t.dir == 1 else "SELL",
                "entry": t.entry_t,
                "exit": t.exit_t,
                "pts": round(t.pts, 2),
                "rs": round(t.pts * (65 if t.book == "nifty" else 30)),
                "mfe": round(t.mfe, 2),
                "mfe_rs": round(t.mfe * (65 if t.book == "nifty" else 30)),
                "giveback_rs": round(
                    max(0, t.mfe * (65 if t.book == "nifty" else 30) - max(t.pts, 0) * (65 if t.book == "nifty" else 30))
                ),
                "exit_reason": t.exit_reason,
                "setup": t.armed_reason,
            }
            for t in sorted(tday, key=lambda x: (x.entry_t, x.book))
        ],
        "confirm_failed": [
            {
                "book": r.book,
                "time": r.time,
                "detail": r.detail,
                "would_pts": None if r.would_pts is None else round(r.would_pts, 2),
                "would_rs": None if r.would_rs is None else round(r.would_rs),
            }
            for r in failed
        ],
        "risk_rejects": [
            {"book": r.book, "time": r.time, "detail": r.detail, "would_rs": None if r.would_rs is None else round(r.would_rs)}
            for r in risk
        ],
        "ema_blocks": [
            {"book": r.book, "time": r.time, "detail": r.detail}
            for r in ema
        ],
        "reason_tallies": dict(Counter(r.reason for r in rday)),
        "day_net_rs": round(sum(t.pts * (65 if t.book == "nifty" else 30) for t in tday)),
    }


def filter_trades(trades: list[Trade], start: str | None = None, end: str | None = None) -> list[Trade]:
    out = trades
    if start:
        out = [t for t in out if t.day >= start]
    if end:
        out = [t for t in out if t.day <= end]
    return out


def eval_variant(nifty, bank, label: str, **kw) -> dict:
    trades, rejects, counts = run_pair(nifty, bank, **kw)
    # Full sample
    s = summarize(trades)
    d = day_stats(trades)
    failed = [r for r in rejects if r.reason == "Trap confirm failed" and r.would_rs is not None]
    # Walk-forward slices
    train = filter_trades(trades, end=TRAIN_END)
    test = filter_trades(trades, start=TEST_START)
    recent = filter_trades(trades, start="2026-05-06")
    return {
        "label": label,
        "summary_all": s,
        "day_stats_all": d,
        "summary_train_2020_2023": summarize(train),
        "day_stats_train": day_stats(train),
        "summary_oos_2024_plus": summarize(test),
        "day_stats_oos": day_stats(test),
        "summary_recent_60d": summarize(recent),
        "day_stats_recent": day_stats(recent),
        "top_reject_reasons": counts.most_common(12),
        "confirm_failed_count": len(failed),
        "confirm_failed_would_net_rs": round(sum(r.would_rs or 0 for r in failed)),
        "confirm_failed_would_green": sum(1 for r in failed if (r.would_rs or 0) > 0),
        "confirm_failed_would_red": sum(1 for r in failed if (r.would_rs or 0) < 0),
        "_trades": trades,
        "_rejects": rejects,
    }


def main() -> None:
    kite_n = CACHE / "nifty-5m-2020-2026.json"
    kite_b = CACHE / "banknifty-5m-2020-2026.json"
    yahoo_n = CACHE / "nifty-5m-recent-60d.json"
    yahoo_b = CACHE / "bank-5m-recent-60d.json"
    if kite_n.exists() and kite_b.exists():
        nifty_path, bank_path = kite_n, kite_b
        source = "Kite 5m 2020-01-01→2026-07-28"
    elif yahoo_n.exists() and yahoo_b.exists():
        nifty_path, bank_path = yahoo_n, yahoo_b
        source = "Yahoo 5m recent-60d fallback"
    else:
        raise SystemExit(f"Missing cache under {CACHE}")

    nifty = load(nifty_path, 65)
    bank = load(bank_path, 30)
    days = sorted(set(map(str, nifty["days"])) | set(map(str, bank["days"])))
    print(f"Loaded nifty={nifty['n']} bank={bank['n']} sessions={len(days)} {days[0]}→{days[-1]} ({source})")

    variants = {
        "baseline_app": dict(cooldown=0, profit_protect=None),
        "research_cd3": dict(cooldown=3, profit_protect=None),
        "protect_1R_BE": dict(cooldown=0, profit_protect=(1.0, 0.0)),
        "protect_1R_0.5R": dict(cooldown=0, profit_protect=(1.0, 0.5)),
        "protect_1.5R_1R": dict(cooldown=0, profit_protect=(1.5, 1.0)),
        "rr2_protect_1R_BE": dict(cooldown=0, profit_protect=(1.0, 0.0), rr=2.0),
        "rr2_only": dict(cooldown=0, profit_protect=None, rr=2.0),
        "force_failed_confirm": dict(cooldown=0, force_take_failed_confirm=True),
        "no_ema": dict(cooldown=0, skip_ema=True),
        "no_risk_band": dict(cooldown=0, skip_risk_band=True),
    }

    report: dict = {
        "meta": {
            "source": source,
            "window": [days[0], days[-1]],
            "sessions": len(days),
            "proxy": "Nifty×65 + Bank×30",
            "app_dna": "sr-trap-confirm.engine.ts mirrored",
            "walk_forward": {"train_end": TRAIN_END, "test_start": TEST_START},
        },
        "variants": {},
        "days_of_interest": {},
    }

    base_trades = []
    base_rejects = []
    for name, kw in variants.items():
        row = eval_variant(nifty, bank, name, **kw)
        trades = row.pop("_trades")
        rejects = row.pop("_rejects")
        if name == "baseline_app":
            base_trades, base_rejects = trades, rejects
        s = row["summary_oos_2024_plus"]
        d = row["day_stats_oos"]
        report["variants"][name] = row
        print(
            f"{name:22} OOS n={s['n']:4} WR={s['win_rate']:5}% PF={s['pf']} "
            f"net=₹{s['net_rs']:>9,} DD=₹{s['max_dd_rs']:>8,} "
            f"avg/day=₹{d.get('avg', 0):>5} hold={s['avg_hold_min']}m "
            f"recent60=₹{row['day_stats_recent'].get('avg', 0)}"
        )

    for day in ("2026-07-27", "2026-07-28"):
        report["days_of_interest"][day] = detail_day(base_trades, base_rejects, day)
        print("\n===", day, "net=₹", report["days_of_interest"][day]["day_net_rs"], "===")
        print("trades", report["days_of_interest"][day]["trades"])
        print("confirm_failed", report["days_of_interest"][day]["confirm_failed"])
        print("risk", report["days_of_interest"][day]["risk_rejects"])
        print("tallies", report["days_of_interest"][day]["reason_tallies"])

    give_trades = []
    for t in base_trades:
        if t.day < TEST_START:
            continue
        mult = 65 if t.book == "nifty" else 30
        mfe_rs = t.mfe * mult
        real_rs = t.pts * mult
        if mfe_rs >= 500 and real_rs < mfe_rs * 0.4:
            give_trades.append(
                {
                    "day": t.day,
                    "book": t.book,
                    "dir": "BUY" if t.dir == 1 else "SELL",
                    "entry": t.entry_t,
                    "exit": t.exit_t,
                    "exit_reason": t.exit_reason,
                    "mfe_rs": round(mfe_rs),
                    "realized_rs": round(real_rs),
                    "giveback_rs": round(mfe_rs - max(real_rs, 0)),
                }
            )
    give_trades.sort(key=lambda x: -x["giveback_rs"])
    report["largest_givebacks_oos"] = give_trades[:30]

    expiry_days = [d for d in days if datetime.strptime(d, "%Y-%m-%d").weekday() == 3 and d >= TEST_START]
    exp_trades = [t for t in base_trades if t.day in expiry_days]
    non_exp = [t for t in base_trades if t.day >= TEST_START and t.day not in set(expiry_days)]
    report["expiry_thursday_oos"] = {
        "expiry_day_count": len(expiry_days),
        "on_expiry": summarize(exp_trades),
        "off_expiry": summarize(non_exp),
        "note": "App rolls weekly only after 13:00 IST on Thursday; morning still selects same-day expiry.",
    }

    base = report["variants"]["baseline_app"]
    protect = report["variants"]["protect_1R_BE"]
    rr2p = report["variants"]["rr2_protect_1R_BE"]
    report["estimates"] = {
        "current_oos": {
            **base["summary_oos_2024_plus"],
            **base["day_stats_oos"],
            "expected_monthly_rs": round(base["day_stats_oos"].get("avg", 0) * 21),
        },
        "improved_protect_1R_BE_oos": {
            **protect["summary_oos_2024_plus"],
            **protect["day_stats_oos"],
            "expected_monthly_rs": round(protect["day_stats_oos"].get("avg", 0) * 21),
        },
        "improved_rr2_protect_1R_BE_oos": {
            **rr2p["summary_oos_2024_plus"],
            **rr2p["day_stats_oos"],
            "expected_monthly_rs": round(rr2p["day_stats_oos"].get("avg", 0) * 21),
        },
        "doc31_reference": {
            "trap_bounce_rr3_5_net": 681152,
            "avg_day": 1109,
            "red_pct": 37.8,
            "max_dd": -13901,
            "pf": 2.72,
            "expected_monthly_rs": round(1109 * 21),
            "source": "docs/owner-private/31 (prior hunt; cd=3)",
        },
    }

    out_path = OUT / "summary.json"
    out_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
