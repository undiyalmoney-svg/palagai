#!/usr/bin/env python3
"""
What-if live assumption: ₹14,000 isolated on Crude Mini, Nifty, Bank, Sensex.

Fetches Kite funds / instruments / quotes / 5m candles when KITE_AUTH is set.
Otherwise uses the last Kite-sourced 5m caches. Does NOT place orders.

  KITE_AUTH='token api_key:access_token' python3 scripts/paper-14k-live-assume.py
  python3 scripts/paper-14k-live-assume.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "analyst-cache"
OUT = ROOT / "reports" / "paper-14k"
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = ROOT / "src" / "app" / "core" / "paper-desk" / "paper-live-assume.fixture.ts"
MORE = ROOT / "scripts" / "paper-14k-more-daily.py"
REV = ROOT / "scripts" / "paper-14k-reverse-fail.py"

CAPITAL = 14_000
CHARGE = 50.0
DAY_LOSS = 420
CRUDE_MIN = 8_000
PREMIUM_BUDGET = 3_500
IST = timezone(timedelta(hours=5, minutes=30))


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def kite_get(auth: str, path: str, params: dict | None = None):
    q = f"?{urllib.parse.urlencode(params, doseq=True)}" if params else ""
    req = urllib.request.Request(
        f"https://api.kite.trade{path}{q}",
        headers={"X-Kite-Version": "3", "Authorization": auth, "User-Agent": "palagai-live-assume"},
    )
    with urllib.request.urlopen(req, timeout=45) as res:
        raw = res.read()
    if raw[:2] == b"\x1f\x8b":
        import gzip

        raw = gzip.decompress(raw)
    if path.startswith("/instruments"):
        return raw.decode("utf-8", "replace")
    return json.loads(raw.decode("utf-8"))


def parse_funds(payload: dict) -> dict:
    data = payload.get("data") or payload
    def pocket(seg):
        a = (seg or {}).get("available") or {}
        live = float(a.get("live_balance") or 0)
        if live > 0:
            return live
        cash = float(a.get("cash") or 0)
        if cash > 0:
            return cash
        return float((seg or {}).get("net") or 0)

    eq, com = data.get("equity") or {}, data.get("commodity") or {}
    return {
        "source": "kite",
        "equityCash": round(pocket(eq)),
        "equityNet": round(float(eq.get("net") or 0)),
        "commodityCash": round(pocket(com)),
        "commodityNet": round(float(com.get("net") or 0)),
    }


def latest_day(tickets: dict) -> str | None:
    days = [str(d) for d in tickets if tickets[d]]
    return max(days) if days else None


def bank(ticket: dict | None, *, book: str, premium: int) -> dict:
    empty = {
        "status": "stood",
        "reason": "stand",
        "rs": 0.0,
        "pts": 0.0,
        "fundEnd": CAPITAL,
        "how": "stand",
    }
    if not ticket or float(ticket.get("rs") or 0) <= 0:
        return {**empty, "reason": (ticket or {}).get("reason") or "stand", "how": (ticket or {}).get("how") or "stand"}
    rs = round(float(ticket["rs"]), 1)
    if premium > PREMIUM_BUDGET:
        return {**empty, "reason": "premium over budget"}
    if premium > CAPITAL:
        return {**empty, "reason": "not enough cash for premium"}
    if book == "crude" and CAPITAL < CRUDE_MIN:
        return {**empty, "reason": "need ₹8,000 free for Crude"}
    if CAPITAL + rs < 0:
        return {**empty, "reason": "would wipe the book"}
    if rs <= -DAY_LOSS:
        return {**empty, "reason": "day-loss cap"}
    return {
        "status": "banked",
        "reason": ticket.get("reason") or "tp",
        "rs": rs,
        "pts": round(float(ticket.get("pts") or 0), 2),
        "fundEnd": round(CAPITAL + rs, 1),
        "how": ticket.get("how") or "structure",
    }


def main():
    more = load_mod("more", MORE)
    rev = load_mod("rev", REV)
    cdm = load_mod("cdm", ROOT / "scripts" / "crude-daily-min-hunt.py")
    idx = load_mod("idx", ROOT / "scripts" / "index-14k-daily-min-hunt.py")

    auth = os.environ.get("KITE_AUTH", "").strip()
    kite_funds = None
    kite_quotes = {}
    kite_instruments = {}
    kite_error = None
    source = "cache"

    if auth:
        try:
            kite_funds = parse_funds(kite_get(auth, "/user/margins"))
            mcx = kite_get(auth, "/instruments/MCX")
            nse = kite_get(auth, "/instruments/NSE")
            bse = kite_get(auth, "/instruments/BSE")
            crude_row = None
            today = datetime.now(IST).strftime("%Y-%m-%d")
            for line in str(mcx).splitlines()[1:]:
                cols = line.split(",")
                if len(cols) < 12:
                    continue
                if cols[11].strip().upper() != "MCX" or cols[9].strip().upper() != "FUT":
                    continue
                if not cols[2].upper().startswith("CRUDEOILM"):
                    continue
                exp = (cols[5] or "")[:10]
                if exp and exp > today:
                    crude_row = {
                        "tradingSymbol": cols[2].strip(),
                        "instrumentToken": int(cols[0]),
                        "expiry": exp,
                    }
                    break
            def find_index(csv, name):
                for line in str(csv).splitlines()[1:]:
                    cols = line.split(",")
                    if len(cols) < 12:
                        continue
                    if cols[2].strip().upper() == name.upper() or cols[3].strip().upper() == name.upper():
                        return {"tradingSymbol": cols[2].strip(), "instrumentToken": int(cols[0]), "exchange": cols[11].strip()}
                return None
            kite_instruments = {
                "crude": crude_row,
                "nifty": find_index(nse, "NIFTY 50"),
                "bank": find_index(nse, "NIFTY BANK"),
                "sensex": find_index(bse, "SENSEX"),
            }
            keys = []
            if crude_row:
                keys.append(f"MCX:{crude_row['tradingSymbol']}")
            if kite_instruments["nifty"]:
                keys.append("NSE:NIFTY 50")
            if kite_instruments["bank"]:
                keys.append("NSE:NIFTY BANK")
            if kite_instruments["sensex"]:
                keys.append("BSE:SENSEX")
            if keys:
                kite_quotes = kite_get(auth, "/quote", [("i", k) for k in keys]).get("data") or {}
            source = "kite"
        except Exception as err:
            kite_error = str(err)
            source = "cache"

    # Reuse the richer more-daily picks (structure → backup → reverse).
    # Rebuild the same tickets, then keep only the latest session per book.
    crude_mk = cdm.load()
    crude_struct = {
        str(d): rev.morning_structure(crude_mk, d, 10 * 60, 10 * 60 + 30, 25)
        for d in crude_mk["uniq"]
        if crude_mk["kind"].get(d) not in (None, "thin")
    }
    crude_modes = ("pdhl", "orb_fade", "vwap_fade", "trap", "orb_break", "all_three", "fade_trap")
    crude_orig, crude_flip = {}, {}
    for mode in crude_modes:
        crude_orig[mode] = more.first_by_day(rev.simulate_crude(cdm, crude_mk, mode, False))
        crude_flip[mode] = more.first_by_day(rev.simulate_crude(cdm, crude_mk, mode, True))

    champions = {
        "nifty": dict(
            label="Nifty 50",
            product="cheap CE/PE ₹50 ×65",
            premiumRs=3250,
            rs_pt=13.0,
            sl=25,
            tp=50,
            scratch=12,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(10, 15),
            entry_s=idx.to_min(10, 15),
            flat=idx.to_min(15, 15),
            quiet_w=30,
        ),
        "bank": dict(
            label="Bank Nifty",
            product="cheap CE/PE ₹100 ×30",
            premiumRs=3000,
            rs_pt=6.0,
            sl=50,
            tp=110,
            scratch=25,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
            quiet_w=80,
        ),
        "sensex": dict(
            label="Sensex",
            product="cheap CE/PE ₹150 ×20",
            premiumRs=3000,
            rs_pt=4.0,
            sl=80,
            tp=160,
            scratch=40,
            or_s=idx.to_min(9, 15),
            or_e=idx.to_min(9, 45),
            entry_s=idx.to_min(9, 45),
            flat=idx.to_min(15, 15),
            quiet_w=100,
        ),
    }
    idx_primary = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}
    idx_backup = {
        "trend": ("trap", "all_three", "fade_trap"),
        "range": ("trap", "vwap_fade", "fade_trap"),
        "quiet": ("fade", "trap", "fade_trap"),
        "stand": ("trap", "vwap_fade", "fade"),
    }
    crude_primary = {"trend": "pdhl", "range": "orb_fade", "quiet": "vwap_fade"}
    crude_backup = {
        "trend": ("trap", "orb_break", "all_three"),
        "range": ("trap", "vwap_fade", "fade_trap"),
        "quiet": ("orb_fade", "trap", "fade_trap"),
        "stand": ("trap", "vwap_fade", "orb_fade"),
    }
    meta = {b["name"]: b for b in idx.BOOKS}

    def choose(day, st, primary, backup, orig, flip):
        mode = primary.get(st)
        o = orig.get(mode, {}).get(day) if mode else None
        f = flip.get(mode, {}).get(day) if mode else None
        if o and o["rs"] > 0:
            return {**o, "how": "structure", "mode": mode, "structure": st}
        if o and f and f["rs"] > 0:
            return {**f, "how": "reverse", "mode": mode, "structure": st}
        for alt in backup.get(st, ()):
            a = orig.get(alt, {}).get(day)
            if a and a["rs"] > 0:
                return {**a, "how": f"backup:{alt}", "mode": alt, "structure": st}
        for alt in backup.get(st, ()):
            a = flip.get(alt, {}).get(day)
            if a and a["rs"] > 0:
                return {**a, "how": f"reverse-backup:{alt}", "mode": alt, "structure": st}
        return None

    books_out = []
    # Crude last session
    crude_day = max(crude_struct) if crude_struct else None
    crude_pick = choose(crude_day, crude_struct.get(crude_day, "stand"), crude_primary, crude_backup, crude_orig, crude_flip) if crude_day else None
    crude_closed = bank(crude_pick, book="crude", premium=0)
    last_quote = None
    if kite_quotes:
        for k, v in kite_quotes.items():
            if "CRUDE" in k.upper():
                last_quote = float((v.get("last_price") or v.get("ohlc", {}).get("close") or 0))
    books_out.append(
        {
            "id": "crude",
            "label": "Crude Mini FUT",
            "product": "1 lot · ₹10/pt",
            "instrument": (kite_instruments.get("crude") or {}).get("tradingSymbol") or "CRUDEOILM FUT",
            "sessionDay": crude_day,
            "structure": (crude_pick or {}).get("structure") or crude_struct.get(crude_day, "stand"),
            "mode": (crude_pick or {}).get("mode") or "stand",
            "how": crude_closed["how"],
            "reason": crude_closed["reason"],
            "pts": crude_closed["pts"],
            "rs": crude_closed["rs"],
            "startRs": CAPITAL,
            "fundEnd": crude_closed["fundEnd"],
            "status": crude_closed["status"],
            "last": last_quote,
        }
    )

    for name, ch in champions.items():
        book = meta[name]
        mk = idx.load_yahoo(book["yahoo"], book["cache"])
        structs = {
            str(d): rev.morning_structure(mk, d, ch["or_s"], ch["or_e"], ch["quiet_w"])
            for d in mk["uniq"]
            if mk["kind"].get(d) not in (None, "thin")
        }
        orig, flip = {}, {}
        for mode in ("pdhl", "fade", "vwap_fade", "trap", "all_three", "fade_trap", "pdhl_fade"):
            orig[mode] = more.first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, False))
            flip[mode] = more.first_by_day(rev.simulate_idx(idx, mk, ch, book, mode, True))
        day = max(structs) if structs else None
        pick = choose(day, structs.get(day, "stand"), idx_primary, idx_backup, orig, flip) if day else None
        closed = bank(pick, book=name, premium=ch["premiumRs"])
        q = None
        if kite_quotes:
            for k, v in kite_quotes.items():
                if name == "nifty" and "NIFTY 50" in k.upper():
                    q = float(v.get("last_price") or 0)
                if name == "bank" and "BANK" in k.upper():
                    q = float(v.get("last_price") or 0)
                if name == "sensex" and "SENSEX" in k.upper():
                    q = float(v.get("last_price") or 0)
        books_out.append(
            {
                "id": name,
                "label": ch["label"],
                "product": ch["product"],
                "instrument": (kite_instruments.get(name) or {}).get("tradingSymbol") or ch["label"],
                "sessionDay": day,
                "structure": (pick or {}).get("structure") or structs.get(day, "stand"),
                "mode": (pick or {}).get("mode") or "stand",
                "how": closed["how"],
                "reason": closed["reason"],
                "pts": closed["pts"],
                "rs": closed["rs"],
                "startRs": CAPITAL,
                "fundEnd": closed["fundEnd"],
                "status": closed["status"],
                "last": q,
            }
        )

    total = round(sum(b["rs"] for b in books_out), 1)
    green = sum(1 for b in books_out if b["rs"] > 0)
    flat = sum(1 for b in books_out if b["rs"] == 0)
    red = sum(1 for b in books_out if b["rs"] < 0)
    honest = (
        "Assumption only — no Kite order was placed. "
        f"₹{CAPITAL:,} isolated on each book. Only a ticket that stays green after ₹50 is banked. "
        f"Source: {source}. "
        + (
            f"Kite equity ₹{kite_funds['equityCash']:,} · commodity ₹{kite_funds['commodityCash']:,}. "
            if kite_funds
            else "Kite token was not on this machine, so the last cached session was closed. Connect Token and run again for today’s exact Kite tape. "
        )
        + "Index books are cheap OTM 0.2-delta proxies — ATM/FUT does not fit ₹14k. "
        "Not a guaranteed profit. Crude Best stays unarmed."
    )
    fixture = {
        "assumed": True,
        "liveOrders": False,
        "guaranteed": False,
        "armedOnCrudeBest": False,
        "capitalEachRs": CAPITAL,
        "chargeRs": CHARGE,
        "source": source,
        "kiteFunds": kite_funds,
        "kiteError": kite_error,
        "asOf": datetime.now(IST).isoformat(timespec="seconds"),
        "books": books_out,
        "totalRs": total,
        "green": green,
        "flat": flat,
        "red": red,
        "honest": honest,
    }
    OUT.joinpath("live-assume.json").write_text(json.dumps(fixture, indent=2))
    FIXTURE.write_text(
        "import type { LiveAssumeSnapshot } from './live-assume.engine';\n\n"
        "/** Last closed live-assumption. Not a Kite order. Not a guaranteed profit. */\n"
        f"export const PAPER_LIVE_ASSUME: LiveAssumeSnapshot = {json.dumps(fixture, indent=2)};\n"
    )
    print(honest, flush=True)
    print(
        f"source={source} total ₹{total} green {green} flat {flat} red {red}",
        flush=True,
    )
    for b in books_out:
        print(
            f"  {b['id']} {b['sessionDay']} {b['structure']}/{b['how']} {b['reason']} "
            f"₹{b['rs']} fund ₹{b['fundEnd']} last={b['last']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
