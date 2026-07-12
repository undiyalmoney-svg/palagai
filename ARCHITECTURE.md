# Palagai Architecture

Modular trading research platform with clear separation of responsibilities.

## Module Overview

```
src/app/
├── core/
│   ├── config/           Session, backtest defaults, strategy IDs
│   ├── domain/           Standardized models (Signal, Trade, BacktestResult, …)
│   ├── data/             OHLC loading, instruments (Data Layer)
│   ├── strategies/       Plugin interface, adapters, StrategyEngineService
│   ├── backtesting/      Strategy-agnostic BacktestRunnerService
│   ├── trading/          TradeEngineService (positions, exits, lifecycle)
│   ├── reporting/        PerformanceReporterService (metrics, equity)
│   ├── research/         ResearchEngineService facade (optimization, debug)
│   ├── research-platform/  Strategy evaluators, rule optimization, debug analyzers
│   ├── strategy-engine/  Legacy trade coordinator, shared OHLC utils
│   ├── services/         UI orchestration (ReplayEngineService)
│   └── shared/           Logging, error types
└── features/             UI Layer (dashboard, no business logic)
```

## Dependency Rules

| Module | May depend on | Must NOT depend on |
|--------|---------------|-------------------|
| **UI (features/)** | core services, facades | strategy evaluators directly |
| **Data Layer** | domain, config, Kite API | strategies, UI |
| **Strategy Engine** | domain, evaluators | UI, reporting, backtesting internals |
| **Backtesting Engine** | data, strategies, trading, domain | UI, specific strategy logic |
| **Trade Engine** | domain, trade-manager | strategies, UI |
| **Reporting Engine** | domain, trade results | strategy execution |
| **Research Engine** | optimization/debug services | strategy evaluator internals |

## Adding a New Strategy

1. Create evaluator: `core/research-platform/strategies/my-strategy/my-strategy.evaluator.ts`
2. Create DI wrapper implementing `ResearchStrategy` in `research-strategies.ts`
3. Register in `ResearchStrategyRegistryService`
4. `ResearchStrategyPlugin` adapter picks it up automatically via `StrategyEngineService`
5. BacktestRunner, TradeEngine, Reporting, and UI work without changes

Optional: set `exitPolicy` in `ResearchStrategyPlugin` for session-close exits.

## Strategy Plugin Interface

Every strategy implements `IStrategyPlugin`:

- `initialize()` / `reset()` — lifecycle
- `evaluate()` / `generateSignal()` — signal generation
- `calculateStopLoss()` / `calculateTarget()` — risk management
- `exitPolicy` — tells Trade Engine how to manage exits

## Backtest Flow

```
UI (Historical Tester)
  → ReplayEngineService (orchestration, debug snapshots)
    → BacktestRunnerService
      → OhlcDataService.load()
      → StrategyEngineService.getEnabled()
      → for each candle: plugin.generateSignal() → TradeEngineService.processSignal()
      → PerformanceReporterService.buildMetrics()
```

## Research Flow (Independent)

```
UI (Rule Optimization / Strategy Research)
  → ResearchEngineService
    → optimization / strategy-debug engines (observation-only)
```

Research engines do not modify strategy evaluators or the main backtest path.

## Configuration

Centralized in `core/config/`:

- `session.config.ts` — market hours
- `backtest.config.ts` — lookback, delays
- `strategy-ids.config.ts` — all strategy identifiers

## Domain Models

Standard types in `core/domain/` ensure consistent communication:

- `Signal`, `StrategyResult`, `Trade`, `PerformanceMetrics`, `BacktestRunResult`

Legacy `HistoricalTest` is produced via `toHistoricalTest()` for persistence compatibility.
