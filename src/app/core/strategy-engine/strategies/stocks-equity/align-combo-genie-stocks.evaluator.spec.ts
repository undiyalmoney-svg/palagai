import { replayAlignComboGenieStocks } from './align-combo-genie-stocks.evaluator';
import { Candle } from '../../../models/candle.model';

function d(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date: `${date} 15:30:00`, open: o, high: h, low: l, close: c, volume: 1 };
}

describe('replayAlignComboGenieStocks', () => {
  it('SELLS on prior-red + gap-down continuation (dump day)', () => {
    const days = [
      d('2026-07-21', 100, 101, 98, 99), // red prior
      d('2026-07-22', 98.5, 99, 97, 97.5), // gap down ~1.5%
    ];
    const trades = replayAlignComboGenieStocks({ symbol: 'TEST', days });
    expect(trades.length).toBe(1);
    expect(trades[0]!.direction).toBe('SELL');
    expect(trades[0]!.strategyId).toBe('ALIGN_COMBO_GENIE');
  });

  it('skips weak opens (no align)', () => {
    const days = [
      d('2026-07-21', 100, 101, 99, 100.5), // green prior
      d('2026-07-22', 100.1, 101, 99.5, 100.2), // tiny gap
    ];
    expect(replayAlignComboGenieStocks({ symbol: 'TEST', days })).toEqual([]);
  });
});
