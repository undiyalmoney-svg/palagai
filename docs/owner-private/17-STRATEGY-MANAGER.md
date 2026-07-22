# 17 — Strategy Manager (multi-strategy platform)

## Status

**Architecture implemented.** Champion PDHL remains available (DNA untouched). **Defaults:** Donch Retest · OR-mid · 2R for **Nifty/Bank**. Stocks Manager is not Donch (NO_GO on equities — doc **21**). Stocks Desk UI defaults to **GAP_FADE_500**.

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
| Stocks (Manager) | VolExpand (placeholder) | VolExpand (placeholder) | Off |
| Stocks Desk | — | **GAP_FADE_500** | — |

Donch Retest is **index-only**. On stocks it lost OOS (doc **21**). Use Stocks Desk **GAP_FADE_500** for equity daily profit.

## How to switch (no code)

Open **Strategies** in the nav → pick channel → set Paper / Live / Shadow → edit per-strategy settings.

## Add a strategy later

1. New class implementing `IManagedStrategy`
2. Register in `StrategyRegistryService`
3. Add id constants
4. Done — engine / risk / orders / dashboard stay put

See `src/app/core/strategy-manager/README.md`.
