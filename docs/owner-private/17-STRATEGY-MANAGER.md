# 17 — Strategy Manager (multi-strategy platform)

## Status

**Architecture implemented.** Champion PDHL remains available (DNA untouched). **Defaults:** Donch Retest · OR-mid · 2R for **Nifty/Bank**; **GAP_FADE_500** for Stocks (Manager + Desk).

## What shipped

- `IManagedStrategy` contract (`initialize`, `analyze`, `generateSignal`, `calculateStopLoss`, `calculateTarget`, `exitLogic`, settings)
- Strategy Registry + Manager (paper/live/shadow per channel)
- Modules: Champion wrapper (DNA untouched), VolExpand Donch15, Swing5+PrevDay, Donchian-20, Donchian-55 Turtle, Inside Break, **Donch Retest OR-mid 2R**, **Swing Retest EMA50 2R** (index channels only)
- Trade Desk wired through Manager (same logic Paper/Live)
- Shadow book (signals/trades, no orders)
- Strategy Management dashboard (`/dashboard/strategy-manager`)
- Backtest plugins for new modules (disabled by default; Champion enabled)

## Defaults

| | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | **Donch Retest · OR-mid · 2R** | **Donch Retest · OR-mid · 2R** | Off |
| Bank | **Donch Retest · OR-mid · 2R** | **Donch Retest · OR-mid · 2R** | Off |
| Stocks (Manager) | **GAP_FADE_500** | **GAP_FADE_500** | Off |
| Stocks Desk | — | **GAP_FADE_500** | — |

Donch Retest is **index-only**. Stocks use **GAP_FADE_500** in Strategy Manager and Stocks Desk (doc **21**).

## How to switch (no code)

Open **Strategies** in the nav → pick channel → set Paper / Live / Shadow → edit per-strategy settings.

## Add a strategy later

1. New class implementing `IManagedStrategy`
2. Register in `StrategyRegistryService`
3. Add id constants
4. Done — engine / risk / orders / dashboard stay put

See `src/app/core/strategy-manager/README.md`.
