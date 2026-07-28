import { TradeDirection } from '../../models/historical-test.model';
import { MarketRegime } from '../utils/market-regime.util';

export interface OpenTrade {
  entryTime: string;
  entryPrice: number;
  direction: TradeDirection;
  stopLoss: number;
  targetPrice: number;
  entryReason: string;
  confidence: number;
  riskRewardRatio: number;
  marketRegime?: MarketRegime;
  /** Running max favorable excursion in index points (Trap drain floor). */
  peakMfePts?: number;
}
