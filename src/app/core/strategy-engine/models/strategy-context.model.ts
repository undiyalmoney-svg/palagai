import { Candle } from '../../models/candle.model';
import { MarketRegime } from '../utils/market-regime.util';
import { InstrumentSessionConfig } from '../../config/session.config';

export interface StrategyContext {
  candle60m: Candle;
  candle30m: Candle;
  candle15m: Candle;
  candle5m: Candle;
  previous60m: Candle[];
  previous30m: Candle[];
  previous15m: Candle[];
  previous5m: Candle[];
  candleIndex5m: number;
  replayStepIndex: number;
  replayFrom: string;
  replayTo: string;
  /** Daily market regime classification (set by backtest runner). */
  marketRegime?: MarketRegime;
  marketRegimeReason?: string;
  /** Instrument session (NSE vs MCX crude, etc.). */
  session?: InstrumentSessionConfig;
  instrumentId?: string;
  /**
   * Full 5m series for the loaded backtest (includes future bars relative to current step).
   * Used to match research swing levels; omit in live so swings stay causal.
   */
  series5m?: Candle[];
}
