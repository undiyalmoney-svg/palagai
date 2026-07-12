export class AppError extends Error {
  readonly originalError?: unknown;

  constructor(
    message: string,
    readonly code: string,
    readonly context?: string,
    cause?: unknown,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.originalError = cause;
  }
}

export class DataLoadError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DATA_LOAD_ERROR', 'DataLayer', cause);
    this.name = 'DataLoadError';
  }
}

export class BacktestError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'BACKTEST_ERROR', 'BacktestingEngine', cause);
    this.name = 'BacktestError';
  }
}

export class StrategyError extends AppError {
  constructor(message: string, strategyId?: string, cause?: unknown) {
    super(message, 'STRATEGY_ERROR', strategyId ?? 'StrategyEngine', cause);
    this.name = 'StrategyError';
  }
}
