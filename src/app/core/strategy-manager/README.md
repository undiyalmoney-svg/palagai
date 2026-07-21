# 17 — Strategy Manager architecture

## Goal

Multi-strategy platform: strategies are plug-and-play modules. Champion PDHL remains available; **defaults** are **Donch Retest · OR-mid · 2R** for indices (daily ₹500 S/R search).

## Layout

```
Market data → Strategy Manager → IManagedStrategy → Signal → Desk risk → Paper / Live
                                      ↓
                                 Shadow book (no orders)
```

| Path | Role |
|---|---|
| `core/strategy-manager/models/` | `IManagedStrategy`, settings, channels |
## Modules: Champion wrapper + VolExpand / Swing5 / Donch20 / Turtle55 / Inside Break
| `core/strategy-manager/modules/` | Champion + VolExpand / Swing5 / Donch20 / Turtle55 / Inside Break / Donch Retest / Swing Retest |
| `core/strategy-manager/registry/` | Registration (add strategy = new class + inject here) |
| `core/strategy-manager/config/` | Paper/Live/Shadow assignments + per-strategy settings (localStorage) |
| `core/strategy-manager/runtime/` | Manager, event log, shadow book, performance |
| `features/dashboard/strategy-manager/` | UI |

## Defaults (research-backed)

| Channel | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | VolExpand Donch15 | VolExpand Donch15 | Off |
| Bank | VolExpand Donch15 | VolExpand Donch15 | Off |
| Stocks (Strategy Manager) | VolExpand Donch15 | VolExpand Donch15 | Off |
| Stocks Desk UI | — | **GAP_FADE_500** | — |

VolExpand: regime filter **off** by default (full morning trade count). Enable in Settings for chop stand-down. Nifty stop 30 / Bank stop 45.

Trade Desk resolves strategies via `StrategyManagerService`. Champion DNA file is **unchanged**; desk risk checkboxes still apply through `setPdhlDeskOverrides`.

## Adding a strategy

1. Implement `IManagedStrategy` (or extend `BaseIndexRuleStrategy`).
2. `@Injectable({ providedIn: 'root' })` + inject in `StrategyRegistryService`.
3. Add id to `MANAGED_STRATEGY_IDS` / `STRATEGY_IDS` / `ACTIVE_STRATEGY_IDS`.
4. No changes to Trade Desk engine, risk, or order executor.

## Shadow mode

Select a Shadow strategy on the Strategy Manager page. Live/Paper still place only primary orders; shadow signals/trades are recorded for comparison.

## Backtest

`StrategyEngineService` registers managed modules via `ManagedStrategyTradingAdapter`. Only Champion is **enabled** by default; others are opt-in in the registry storage.
