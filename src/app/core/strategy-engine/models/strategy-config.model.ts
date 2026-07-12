export interface StrategyModuleToggles {
  trend: boolean;
  structure: boolean;
  pullback: boolean;
  entry: boolean;
  volume: boolean;
  momentum: boolean;
}

export interface StrategyRunConfig {
  strategyId: string;
  testMode: boolean;
  modules: StrategyModuleToggles;
}

export const DEFAULT_MODULE_TOGGLES: StrategyModuleToggles = {
  trend: true,
  structure: true,
  pullback: true,
  entry: true,
  volume: true,
  momentum: true,
};

export function defaultRunConfig(strategyId: string): StrategyRunConfig {
  return {
    strategyId,
    testMode: false,
    modules: { ...DEFAULT_MODULE_TOGGLES },
  };
}
