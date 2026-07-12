import { Injectable } from '@angular/core';
import { Candle, CandleRangeApiResponse, ReversalSignal } from './reversal-meter.types';

type BreakoutDir = 'BULLISH' | 'BEARISH' | 'NONE';
type Trend = 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
type Structure = 'LH' | 'HL' | 'NONE';

type BreakoutState = {
  active: boolean;
  candlesAfter: number;
};

@Injectable({ providedIn: 'root' })
export class ReversalMeterAnalysisService {
  parseCandles(response: CandleRangeApiResponse | Record<string, unknown>): Candle[] {
    const rows = this.extractCandleRows(response);
    return rows
      .map((row) => {
        const c = row as number[];
        const vol = Number(c[5]);
        return {
          time: Number(c[0]),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number.isFinite(vol) ? vol : 0,
        };
      })
      .filter((candle) =>
        [candle.time, candle.open, candle.high, candle.low, candle.close].every((v) => Number.isFinite(v)),
      );
  }

  private extractCandleRows(raw: unknown): Array<number[] | unknown[]> {
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const r = raw as Record<string, unknown>;

    const fromPayload = (payload: unknown): unknown[] | null => {
      if (!payload || typeof payload !== 'object') return null;
      const p = payload as Record<string, unknown>;
      if (Array.isArray(p['candles'])) return p['candles'] as unknown[];
      return null;
    };

    let candles = fromPayload(r['payload']);
    if (candles) return candles as Array<number[] | unknown[]>;

    if (Array.isArray(r['candles'])) return r['candles'] as Array<number[] | unknown[]>;

    const data = r['data'];
    if (data && typeof data === 'object') {
      candles = fromPayload((data as Record<string, unknown>)['payload']);
      if (candles) return candles as Array<number[] | unknown[]>;
      const d = data as Record<string, unknown>;
      if (Array.isArray(d['candles'])) return d['candles'] as Array<number[] | unknown[]>;
    }

    const result = r['result'];
    if (result && typeof result === 'object') {
      candles = fromPayload((result as Record<string, unknown>)['payload']);
      if (candles) return candles as Array<number[] | unknown[]>;
    }

    return [];
  }

  /** Last 6–10 candles only (cap 10; require at least 5). */
  analyze(allCandles: Candle[]): ReversalSignal {
    const n = allCandles.length;
    if (n < 5) {
      return this.noTrade('Not enough data', 'NA');
    }

    const take = Math.min(10, n);
    const w = allCandles.slice(-take);

    const breakoutState: BreakoutState = { active: false, candlesAfter: 0 };

    for (let i = 2; i < w.length; i++) {
      const prev2 = w[i - 2];
      const prev1 = w[i - 1];
      const curr = w[i];
      const isLast = i === w.length - 1;

      if (isLast && (this.isFlat(prev1) || this.isFlat(curr))) {
        return this.withWindow(this.noTrade('Market frozen', 'NA'), w);
      }

      const breakout = this.detectBreakout(prev1, curr);
      if (breakout !== 'NONE') {
        breakoutState.active = true;
        breakoutState.candlesAfter = 0;
        if (isLast) {
          return this.withWindow(
            breakout === 'BULLISH'
              ? this.entryBuyBreakout(curr, prev1)
              : this.entrySellBreakout(curr, prev1),
            w,
          );
        }
        continue;
      }

      if (breakoutState.active) {
        breakoutState.candlesAfter += 1;
        if (breakoutState.candlesAfter <= 2) {
          if (isLast) {
            return this.withWindow(this.noTrade('Post-breakout pullback - skip', 'NA'), w);
          }
          continue;
        }
        breakoutState.active = false;
      }

      if (!isLast) {
        continue;
      }

      const trend = this.trendForStructure(w, i);
      const structure = this.getStructure(prev2, prev1, trend);

      if (structure === 'LH' && curr.close < prev1.low) {
        return this.withWindow(
          {
            signal: 'SELL',
            type: 'REVERSAL',
            reversal_status: 'CONFIRMED',
            entry_trigger_candle_time: curr.time,
            entry_price: prev1.low,
            stop_loss: prev1.high,
            reason: '🔥 ENTER NOW - Bearish Reversal CONFIRMED',
          },
          w,
        );
      }

      if (structure === 'HL' && curr.close > prev1.high) {
        return this.withWindow(
          {
            signal: 'BUY',
            type: 'REVERSAL',
            reversal_status: 'CONFIRMED',
            entry_trigger_candle_time: curr.time,
            entry_price: prev1.high,
            stop_loss: prev1.low,
            reason: '🔥 ENTER NOW - Bullish Reversal CONFIRMED',
          },
          w,
        );
      }

      if (structure !== 'NONE') {
        return this.withWindow(this.noTrade('Structure formed, waiting for break', 'DEVELOPING'), w);
      }

      return this.withWindow(this.noTrade('No valid setup', 'NA'), w);
    }

    return this.withWindow(this.noTrade('Not enough data', 'NA'), w);
  }

  /**
   * Trend that *precedes* the setup candle (prev1): prev3→prev2 when available,
   * else prev2→prev1. Needed so getStructure() can see LH/HL with your rules.
   */
  private trendForStructure(w: Candle[], i: number): Trend {
    if (i >= 3) {
      return this.getTrend(w[i - 3], w[i - 2]);
    }
    return this.getTrend(w[i - 2], w[i - 1]);
  }

  detectBreakout(prev: Candle, curr: Candle): BreakoutDir {
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range <= 0) {
      return 'NONE';
    }
    const bigMove = body > range * 0.6;
    if (curr.close > prev.high && bigMove) {
      return 'BULLISH';
    }
    if (curr.close < prev.low && bigMove) {
      return 'BEARISH';
    }
    return 'NONE';
  }

  getTrend(prev2: Candle, prev1: Candle): Trend {
    if (prev1.high > prev2.high && prev1.low > prev2.low) {
      return 'UPTREND';
    }
    if (prev1.high < prev2.high && prev1.low < prev2.low) {
      return 'DOWNTREND';
    }
    return 'SIDEWAYS';
  }

  getStructure(prev2: Candle, prev1: Candle, trend: Trend): Structure {
    if (trend === 'UPTREND' && prev1.high < prev2.high) {
      return 'LH';
    }
    if (trend === 'DOWNTREND' && prev1.low > prev2.low) {
      return 'HL';
    }
    return 'NONE';
  }

  isFlat(c: Candle): boolean {
    return c.open === c.high && c.high === c.low && c.low === c.close;
  }

  private entryBuyBreakout(curr: Candle, prev1: Candle): ReversalSignal {
    return {
      signal: 'BUY',
      type: 'BREAKOUT',
      reversal_status: 'NA',
      entry_trigger_candle_time: curr.time,
      entry_price: prev1.high,
      stop_loss: prev1.low,
      reason: '🔥 ENTER NOW - Breakout detected',
      analysis_candle_count: null,
      analysis_window_start_time: null,
      analysis_window_end_time: null,
    };
  }

  private entrySellBreakout(curr: Candle, prev1: Candle): ReversalSignal {
    return {
      signal: 'SELL',
      type: 'BREAKOUT',
      reversal_status: 'NA',
      entry_trigger_candle_time: curr.time,
      entry_price: prev1.low,
      stop_loss: prev1.high,
      reason: '🔥 ENTER NOW - Breakout detected',
      analysis_candle_count: null,
      analysis_window_start_time: null,
      analysis_window_end_time: null,
    };
  }

  private noTrade(reason: string, reversal_status: ReversalSignal['reversal_status']): ReversalSignal {
    return {
      signal: 'NO TRADE',
      type: 'NONE',
      reversal_status,
      entry_trigger_candle_time: null,
      entry_price: 0,
      stop_loss: 0,
      reason,
      analysis_candle_count: null,
      analysis_window_start_time: null,
      analysis_window_end_time: null,
    };
  }

  private withWindow(
    base: Omit<ReversalSignal, 'analysis_candle_count' | 'analysis_window_start_time' | 'analysis_window_end_time'>,
    w: Candle[],
  ): ReversalSignal {
    if (!w.length) {
      return {
        ...base,
        analysis_candle_count: null,
        analysis_window_start_time: null,
        analysis_window_end_time: null,
      };
    }
    return {
      ...base,
      analysis_candle_count: w.length,
      analysis_window_start_time: w[0].time,
      analysis_window_end_time: w[w.length - 1].time,
    };
  }
}
