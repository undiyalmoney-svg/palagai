# 17 — Strategy Manager (multi-strategy platform)

## Status

**Architecture implemented.** Champion PDHL remains available (DNA untouched). **Defaults** are research-backed VolExpand for Nifty/Bank/Stocks Manager; Stocks Desk UI defaults to GAP_FADE_500.

## What shipped

- `IManagedStrategy` contract (`initialize`, `analyze`, `generateSignal`, `calculateStopLoss`, `calculateTarget`, `exitLogic`, settings)
- Strategy Registry + Manager (paper/live/shadow per channel)
- Modules: Champion wrapper (DNA untouched), VolExpand Donch15, Swing5+PrevDay, Donchian-20, Donchian-55 Turtle, **Inside Break** (daily ₹500 green-day search; not default)
- Trade Desk wired through Manager (same logic Paper/Live)
- Shadow book (signals/trades, no orders)
- Strategy Management dashboard (`/dashboard/strategy-manager`)
- Backtest plugins for new modules (disabled by default; Champion enabled)

## Defaults

| | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | **VolExpand Donch15** | **VolExpand Donch15** | Off |
| Bank | **VolExpand Donch15** | **VolExpand Donch15** | Off |
| Stocks (Manager) | VolExpand Donch15 | VolExpand Donch15 | Off |
| Stocks Desk | — | **GAP_FADE_500** | — |

VolExpand: regime filter **off** by default (all morning signals). Enable in Settings for Mar-style chop stand-down. Nifty SL 30 · Bank SL 45.

## How to switch (no code)

Open **Strategies** in the nav → pick channel → set Paper / Live / Shadow → edit per-strategy settings.

## Add a strategy later

1. New class implementing `IManagedStrategy`
2. Register in `StrategyRegistryService`
3. Add id constants
4. Done — engine / risk / orders / dashboard stay put

See `src/app/core/strategy-manager/README.md`.
