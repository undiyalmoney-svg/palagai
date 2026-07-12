import { MarketRegime } from './market-regime.util';
import { EntryQualityBreakdown } from './entry-quality-score.util';

export type StrategyDebugStatus = 'ACTIVE' | 'SKIPPED' | 'WAITING' | 'PASS' | 'FAIL';
export type StepStatus = 'PASS' | 'WAITING' | 'FAIL' | 'SKIPPED';

export interface SignalDebugStep {
  name: string;
  status: StepStatus;
  expectedValue?: string;
  actualValue?: string;
}

export interface SignalDebugInfo {
  marketRegime: MarketRegime | string;
  strategyStatus: StrategyDebugStatus;
  currentStep: string;
  blockingRule: string;
  expectedValue: string;
  actualValue: string;
  nextConditionRequired: string;
  steps: SignalDebugStep[];
  entryQuality?: EntryQualityBreakdown;
}

export function buildSignalDebug(params: {
  marketRegime: MarketRegime | string;
  strategyStatus: StrategyDebugStatus;
  currentStep: string;
  blockingRule: string;
  expectedValue?: string;
  actualValue?: string;
  nextConditionRequired?: string;
  steps?: SignalDebugStep[];
  entryQuality?: EntryQualityBreakdown;
}): SignalDebugInfo {
  return {
    marketRegime: params.marketRegime,
    strategyStatus: params.strategyStatus,
    currentStep: params.currentStep,
    blockingRule: params.blockingRule,
    expectedValue: params.expectedValue ?? '—',
    actualValue: params.actualValue ?? '—',
    nextConditionRequired: params.nextConditionRequired ?? '—',
    steps: params.steps ?? [],
    entryQuality: params.entryQuality,
  };
}
