#!/usr/bin/env python3
"""
Fetch Nifty / BankNifty 5m history from Kite into reports/analyst-cache/.

Auth (never commit):
  export KITE_AUTH='token apiKey:accessToken'
  # or: printf '%s' "$KITE_AUTH" > /tmp/kite-auth

Usage:
  python3 scripts/fetch-kite-index-5m.py
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "analyst-cache"
OUT.mkdir(parents=True, exist_ok=True)

INSTRUMENTS = {
    "nifty": (256265, "nifty-5m-2020-2026.json"),
    "bank": (260105, "banknifty-5m-2020-2026.json"),
}
FROM = datetime(2020, 1, 1, 9, 15, 0)
TO = datetime(2026, 7, 23, 15, 30, 0)
CHUNK_DAYS = 90
DELAY = 0.45


def auth_header() -> str:
    env = os.environ.get("KITE_AUTH", "").strip()
    if env:
        return env if env.lower().startswith("token ") else f"token {env}"
    for p in (Path("/tmp/kite-auth"), ROOT / ".kite-auth"):
        if p.exists():
            a = p.read_text().strip()
            return a if a.lower().startswith("token ") else f"token {a}"
    raise SystemExit("Set KITE_AUTH or write /tmp/kite-auth / .kite-auth")


def fetch_chunk(auth: str, token: int, start: datetime, end: datetime) -> list:
    params = urllib.parse.urlencode(
        {
            "from": start.strftime("%Y-%m-%d %H:%M:%S"),
            "to": end.strftime("%Y-%m-%d %H:%M:%S"),
        }
    )
    url = f"https://api.kite.trade/instruments/historical/{token}/5minute?{params}"
    req = urllib.request.Request(
        url, headers={"X-Kite-Version": "3", "Authorization": auth}
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = json.load(r)
            if body.get("status") != "success":
                raise RuntimeError(body.get("message") or str(body)[:200])
            return body.get("data", {}).get("candles") or []
        except Exception as e:
            wait = min(2**attempt, 20)
            print(f"    retry {start.date()}->{end.date()}: {e} sleep {wait}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"failed chunk {token} {start} {end}")


def fetch_all(auth: str, token: int, name: str) -> list[dict]:
    all_rows: list[dict] = []
    seen: set[str] = set()
    cursor = FROM
    while cursor < TO:
        end = min(cursor + timedelta(days=CHUNK_DAYS), TO)
        print(f"  {name} {cursor.date()} → {end.date()}", flush=True)
        candles = fetch_chunk(auth, token, cursor, end)
        for row in candles:
            dt = str(row[0])
            dt_norm = dt.replace("T", " ").split("+")[0].split(".")[0]
            if dt_norm in seen:
                continue
            seen.add(dt_norm)
            all_rows.append(
                {
                    "date": dt_norm,
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]) if len(row) > 5 else 0,
                }
            )
        print(f"    +{len(candles)} total={len(all_rows)}", flush=True)
        cursor = end + timedelta(seconds=1)
        time.sleep(DELAY)
    all_rows.sort(key=lambda x: x["date"])
    return all_rows


def main() -> None:
    auth = auth_header()
    # profile ping (no secrets printed)
    req = urllib.request.Request(
        "https://api.kite.trade/user/profile",
        headers={"X-Kite-Version": "3", "Authorization": auth},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.load(r)
    if body.get("status") != "success":
        raise SystemExit(f"Kite auth failed: {body.get('message')}")
    print(f"Kite ok user={body.get('data', {}).get('user_id')}", flush=True)

    for name, (token, fname) in INSTRUMENTS.items():
        path = OUT / fname
        rows = fetch_all(auth, token, name)
        path.write_text(json.dumps(rows))
        print(f"wrote {path} n={len(rows)}", flush=True)


if __name__ == "__main__":
    main()
