# 17 — Strategy Manager architecture

## Goal

Multi-strategy platform: strategies are plug-and-play modules. Champion PDHL is **not** replaced — it remains the default Paper/Live assignment for Nifty & Bank.

## Layout

```
Market data → Strategy Manager → IManagedStrategy → Signal → Desk risk → Paper / Live
                                      ↓
                                 Shadow book (no orders)
```

| Path | Role |
|---|---|
| `core/strategy-manager/models/` | `IManagedStrategy`, settings, channels |
| `core/strategy-manager/modules/` | Champion wrapper + VolExpand / Swing5 / Donch20 / Turtle55 |
| `core/strategy-manager/registry/` | Registration (add strategy = new class + inject here) |
| `core/strategy-manager/config/` | Paper/Live/Shadow assignments + per-strategy settings (localStorage) |
| `core/strategy-manager/runtime/` | Manager, event log, shadow book, performance |
| `features/dashboard/strategy-manager/` | UI |

## Defaults (backward compatible)

| Channel | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | Champion PDHL | Champion PDHL | Off |
| Bank | Champion PDHL | Champion PDHL | Off |
| Stocks | Swing-5 + Prev Day | Champion PDHL | Off |

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
