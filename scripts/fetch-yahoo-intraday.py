#!/usr/bin/env python3
"""Fetch Yahoo Finance 5m / 1d candles for trade-rejection analysis."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import yfinance as yf

IST = ZoneInfo("Asia/Kolkata")

INDEX_TICKERS = {
    "nifty": "^NSEI",
    "bank-nifty": "^NSEBANK",
}

# Treasure watchlist + common desk names (docs/07)
STOCK_TICKERS = {
    "BRITANNIA": "BRITANNIA.NS",
    "TATACONSUM": "TATACONSUM.NS",
    "NTPC": "NTPC.NS",
    "HDFCLIFE": "HDFCLIFE.NS",
    "SUNPHARMA": "SUNPHARMA.NS",
    "CIPLA": "CIPLA.NS",
    "NESTLEIND": "NESTLEIND.NS",
    "APOLLOHOSP": "APOLLOHOSP.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "POWERGRID": "POWERGRID.NS",
    "JSWSTEEL": "JSWSTEEL.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "SBILIFE": "SBILIFE.NS",
    "SBIN": "SBIN.NS",
}


def bars_to_candles(df) -> list[dict]:
    out = []
    if df is None or len(df) == 0:
        return out
    # flatten MultiIndex columns if present
    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df = df.copy()
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    for ts, row in df.iterrows():
        if getattr(ts, "tzinfo", None) is None:
            local = ts.replace(tzinfo=IST)
        else:
            local = ts.tz_convert(IST)
        # Emit ISO with +05:30 so extractHhMm (toLocaleTimeString Asia/Kolkata)
        # does not treat naive IST wall times as UTC.
        out.append(
            {
                "date": local.strftime("%Y-%m-%dT%H:%M:%S+05:30"),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row.get("Volume") or 0),
            }
        )
    return out


def main() -> int:
    today = datetime.now(IST).strftime("%Y-%m-%d")
    payload: dict = {"asOf": today, "timezone": "Asia/Kolkata", "indexes": {}, "stocks": {}}

    for key, ticker in INDEX_TICKERS.items():
        df = yf.download(ticker, period="10d", interval="5m", progress=False, auto_adjust=False)
        candles = bars_to_candles(df)
        payload["indexes"][key] = {
            "ticker": ticker,
            "candles": candles,
            "todayCount": sum(1 for c in candles if c["date"].startswith(today)),
        }
        print(f"{key}: {len(candles)} bars, today={payload['indexes'][key]['todayCount']}", file=sys.stderr)

    for sym, ticker in STOCK_TICKERS.items():
        df = yf.download(ticker, period="15d", interval="1d", progress=False, auto_adjust=False)
        candles = bars_to_candles(df)
        payload["stocks"][sym] = {"ticker": ticker, "candles": candles}
        print(f"{sym}: {len(candles)} daily bars", file=sys.stderr)

    json.dump(payload, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
