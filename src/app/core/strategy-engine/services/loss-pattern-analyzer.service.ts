import { Injectable } from '@angular/core';
import { HistoricalTrade } from '../../models/historical-test.model';
import { CandleDataset } from '../models/candle-dataset.model';
import { LossPatternAnalysis } from '../models/loss-pattern.model';
import {
  buildSequenceContexts,
  buildTradeDiagnostic,
} from '../utils/trade-diagnostic.util';
import {
  filterTradesForStrategy,
  generateLossPatternAnalysis,
} from '../utils/loss-pattern-report.util';

export const LOSS_ANALYZER_STRATEGY_ID = 'strategy-three';

@Injectable({ providedIn: 'root' })
export class LossPatternAnalyzerService {
  /**
   * Post-backtest diagnostics only — never called from trading or filter paths.
   */
  analyzeBacktest(params: {
    testId: string;
    strategyId: string;
    strategyName: string;
    trades: HistoricalTrade[];
    dataset: CandleDataset;
  }): LossPatternAnalysis {
    const strategyTrades = filterTradesForStrategy(params.trades, params.strategyId);
    const sequences = buildSequenceContexts(strategyTrades);
    const sorted = [...strategyTrades].sort((a, b) => a.entryTime.localeCompare(b.entryTime));

    const records = sorted
      .map((trade, index) =>
        buildTradeDiagnostic({
          trade,
          dataset: params.dataset,
          sequence: sequences[index]!,
        }),
      )
      .filter((record): record is NonNullable<typeof record> => record !== null);

    return generateLossPatternAnalysis({
      testId: params.testId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      records,
    });
  }
}
