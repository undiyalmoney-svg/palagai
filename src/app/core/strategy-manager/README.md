# 17 — Strategy Manager architecture

## Goal

Multi-strategy platform: strategies are plug-and-play modules. Champion PDHL remains available; **defaults** are **Align Combo · GENIE** for indices (Nifty ≤2t · Bank ≤1t · BOTH/ALONE/SKIP).

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
| `core/strategy-manager/modules/` | Champion + VolExpand / Swing5 / Donch20 / Turtle55 / Inside Break / Donch Retest / Swing Retest / Smart PB PRO |
| `core/strategy-manager/registry/` | Registration (add strategy = new class + inject here) |
| `core/strategy-manager/config/` | Paper/Live/Shadow assignments + per-strategy settings (localStorage) |
| `core/strategy-manager/runtime/` | Manager, event log, shadow book, performance |
| `features/dashboard/strategy-manager/` | UI |

## Defaults (research-backed)

| Channel | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | **Align Combo · GENIE** | **Align Combo · GENIE** | Off |
| Bank | **Align Combo · GENIE** | **Align Combo · GENIE** | Off |
| Stocks (Strategy Manager) | **GAP_FADE_500** | **GAP_FADE_500** | Off |
| Stocks Desk UI | — | **GAP_FADE_500** | — |

GENIE: Nifty **≤2 trades/day** · Bank **≤1** · Tue SKIP · day stop −60. Regime filter **off**. Nifty stop 30 / Bank stop 45.

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
