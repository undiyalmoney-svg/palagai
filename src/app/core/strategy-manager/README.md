# 17 — Strategy Manager architecture

## Goal

Multi-strategy platform: strategies are plug-and-play modules. **Nifty/Bank always run Ruler flow** (no alternate index strategy selection). Stocks default to **GAP_FADE_500**. Champion / Donch Retest modules remain in the catalog for reference.

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
| `core/strategy-manager/modules/` | Champion + VolExpand / Swing5 / Donch20 / Turtle55 / Inside Break / Donch Retest / Swing Retest / Gap Fade / **Ruler** |
| `core/strategy-manager/registry/` | Registration (add strategy = new class + inject here) |
| `core/strategy-manager/config/` | Paper/Live/Shadow assignments + per-strategy settings (localStorage) |
| `core/strategy-manager/runtime/` | Manager, event log, shadow book, performance |
| `features/dashboard/strategy-manager/` | UI |

## Defaults (research-backed)

| Channel | Paper | Live | Shadow |
|---|---|---|---|
| Nifty | **Ruler flow** (locked) | **Ruler flow** (locked) | Off |
| Bank | **Ruler flow** (locked) | **Ruler flow** (locked) | Off |
| Stocks (Strategy Manager) | **GAP_FADE_500** | **GAP_FADE_500** | Off |
| Stocks Desk UI | — | **GAP_FADE_500** | — |

**Ruler flow (always on for indices):** Nifty + Bank Paper/Live always resolve to Ruler. No competing index strategy selection. Stocks keep Strat / Stocks Desk pickers.

- **Shared daily arm** locked only after morning OR features exist (never lock STAND on pre-OR bars)
- **DONCH_TRAIL** allows multi-trade (research `one_trade=False`); other arms stay 1 trade/day
- **Testing** uses isolated in-memory MTD; **Live** persists separately and can flatten at day-cap
- Primary **P&L ₹** = uncapped OHLC pts × ₹65/₹30; **Research score ₹** = same after −₹1,500 day-cap (compare to research, not live cash)
- Morning EMA bias uses **OR-end** bar (research `morning_feat`), not 10:15
- Lots always come from the Trade Desk Lots field

Trade Desk resolves strategies via `StrategyManagerService`. Champion DNA file is **unchanged**; desk risk checkboxes still apply through `setPdhlDeskOverrides`.

## Adding a strategy

1. Implement `IManagedStrategy` (or extend `BaseIndexRuleStrategy`).
2. `@Injectable({ providedIn: 'root' })` + inject in `StrategyRegistryService`.
3. Add id to `MANAGED_STRATEGY_IDS` / `STRATEGY_IDS` / `ACTIVE_STRATEGY_IDS`.
4. No changes to Trade Desk engine, risk, or order executor.

## Shadow mode

Shadow is available for **Stocks** only on the Strategy Manager page. Index desks stay Ruler-only (no shadow alternate).

## Backtest

`StrategyEngineService` registers managed modules via `ManagedStrategyTradingAdapter`. Only Champion is **enabled** by default; others are opt-in in the registry storage.
