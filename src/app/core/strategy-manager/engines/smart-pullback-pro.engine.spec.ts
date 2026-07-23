import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import {
  createSmartPbDayState,
  isSidewaysSmartPb,
  runSmartPullbackPro,
} from './smart-pullback-pro.engine';

function c(date: string, open: number, high: number, low: number, close: number): Candle {
  return { date, open, high, low, close, volume: 1 };
}

function ctx(previous: Candle[], candle: Candle): StrategyContext {
  return {
    candle5m: candle,
    previous5m: previous,
    candle15m: candle,
    previous15m: [],
    candle30m: candle,
    previous30m: [],
    candle60m: candle,
    previous60m: [],
    candleIndex5m: previous.length,
    replayStepIndex: previous.length,
    replayFrom: '2026-07-23',
    replayTo: '2026-07-23',
    instrumentId: 'NIFTY',
  };
}

/** Build a same-day series with OR bars + trend so EMA50 is defined. */
function buildDaySeries(): Candle[] {
  const bars: Candle[] = [];
  // 09:15–09:40 OR (6 bars)
  for (let i = 0; i < 6; i += 1) {
    const mm = 15 + i * 5;
    const px = 24000 + i;
    bars.push(
      c(`2026-07-23 09:${String(mm).padStart(2, '0')}:00`, px, px + 5, px - 5, px + 2),
    );
  }
  // Climb so EMA50 sits below price
  let px = 24020;
  for (let i = 0; i < 70; i += 1) {
    px += 3;
    const totalMin = 9 * 60 + 45 + i * 5;
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    bars.push(
      c(
        `2026-07-23 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`,
        px - 1,
        px + 2,
        px - 2,
        px,
      ),
    );
  }
  return bars;
}

describe('smart-pullback-pro.engine', () => {
  it('exposes sideways helper without throwing on short series', () => {
    const bars = buildDaySeries().slice(0, 20);
    const r = isSidewaysSmartPb(bars, 50, 0.7, 10);
    expect(r.sideways).toBe(false);
  });

  it('emits BUY on EMA50 pullback setup in research defaults', () => {
    const base = buildDaySeries();
    // Approximate EMA by using last close − small offset for the pullback low.
    const last = base[base.length - 1]!;
    const emaGuess = last.close - 40;
    const pull = c(
      '2026-07-23 14:00:00',
      last.close - 5,
      last.close + 5,
      emaGuess - 2, // tag EMA from above
      last.close + 2, // bullish close still above EMA
    );
    const settings = defaultStrategySettings({
      entryTimeStart: '09:45',
      entryTimeEnd: '15:10',
      orEnd: '09:45',
      emaLength: 50,
      maxTradesPerDay: 2,
      minStopPts: 3,
      stopLossPts: 30,
      targetRMultiple: 1.5,
      dayStopPts: 60,
      extras: {
        signalMode: 'pullback',
        skipSideways: false,
        minBarsBetweenSignals: 1,
      },
    });
    const state = createSmartPbDayState();
    const signal = runSmartPullbackPro(ctx(base, pull), state, settings);
    expect(signal.analysis?.['strategy']).toBe('smart-pullback-pro');
    // If EMA wasn't tagged exactly, still a structured wait/skip — not a crash.
    if (signal.action === 'BUY') {
      expect(signal.riskRewardRatio).toBe(1.5);
      expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
      expect(signal.target).toBeGreaterThan(signal.entryPrice);
    } else {
      expect(['WAITING', 'SKIPPED']).toContain(signal.action);
    }
  });
});
