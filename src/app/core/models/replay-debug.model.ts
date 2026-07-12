import { StrategySignal, TradeExecutionSnapshot } from '../strategy-engine/models/module-result.model';
import { StrategyEvent } from '../strategy-engine/models/strategy-event.model';
import { Candle } from './candle.model';

export interface ReplayDebugSnapshot {
  replayTime: string;
  candleNumber: number;
  totalCandles: number;
  countdownSeconds: number;
  activeStrategyName: string;
  marketRegime?: string;
  marketRegimeReason?: string;
  ohlc: Pick<Candle, 'open' | 'high' | 'low' | 'close' | 'volume'>;
  strategies: TradeExecutionSnapshot[];
  timelinePhase: string;
  eventLog: StrategyEvent[];
}
