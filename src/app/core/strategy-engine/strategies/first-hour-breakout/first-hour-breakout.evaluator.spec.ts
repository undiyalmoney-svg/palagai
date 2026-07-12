import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../models/strategy-context.model';
import {
  createFirstHourBreakoutState,
  evaluateBreakoutDistanceFilter,
  firstHourRangeFrom5m,
  FIRST_HOUR_MAX_BREAKOUT_DISTANCE_PTS,
  runFirstHourBreakout,
} from './first-hour-breakout.evaluator';

function candle(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1000 };
}

function buildContext(params: {
  date: string;
  close: number;
  high: number;
  low: number;
  open?: number;
  previous5m: Candle[];
  previous60m?: Candle[];
  replayStepIndex?: number;
}): StrategyContext {
  const open = params.open ?? params.close;
  const current = candle(params.date, open, params.high, params.low, params.close);
  const step = params.replayStepIndex ?? params.previous5m.length;
  return {
    candle5m: current,
    candle60m: params.previous60m?.at(-1) ?? current,
    candle30m: current,
    candle15m: current,
    previous5m: params.previous5m,
    previous60m: params.previous60m ?? [],
    previous30m: [],
    previous15m: [],
    candleIndex5m: step,
    replayStepIndex: step,
    replayFrom: '2026-06-24 09:15:00',
    replayTo: '2026-07-03 15:30:00',
    marketRegime: 'TRENDING',
  };
}

describe('FirstHourBreakoutEvaluator', () => {
  it('builds first hour range from 5m bars after 10:15', () => {
    const firstHourBars = [
      candle('2026-06-24T09:15:00+0530', 100, 105, 99, 104),
      candle('2026-06-24T09:20:00+0530', 104, 106, 103, 105),
      candle('2026-06-24T10:10:00+0530', 105, 107, 104, 106),
    ];

    const ctx = buildContext({
      date: '2026-06-24T10:20:00+0530',
      close: 108,
      high: 109,
      low: 107,
      previous5m: firstHourBars,
    });

    const range = firstHourRangeFrom5m(ctx);
    expect(range).not.toBeNull();
    expect(range!.high).toBe(107);
    expect(range!.low).toBe(99);
    expect(range!.barCount).toBe(3);
    expect(range!.source).toBe('5m');
  });

  it('returns WAITING when breakout quality passes but confirmation is pending', () => {
    const firstHourBars = [
      candle('2026-06-24T09:15:00+0530', 100, 105, 99, 104),
      candle('2026-06-24T09:20:00+0530', 104, 106, 103, 105),
    ];

    const ctx = buildContext({
      date: '2026-06-24T10:20:00+0530',
      open: 106,
      close: 108,
      high: 109,
      low: 107,
      previous5m: firstHourBars,
      replayStepIndex: 10,
    });

    const state = createFirstHourBreakoutState();
    const result = runFirstHourBreakout(ctx, state);

    expect(result.action).toBe('WAITING');
    expect(state.pendingBreakout).not.toBeNull();
    expect(state.tradedToday).toBe(false);
  });

  it('signals BUY after confirmed breakout on the next candle', () => {
    const firstHourBars = [
      candle('2026-06-24T09:15:00+0530', 100, 105, 99, 104),
      candle('2026-06-24T09:20:00+0530', 104, 106, 103, 105),
    ];
    const breakoutBar = candle('2026-06-24T10:20:00+0530', 106, 109, 107, 108);

    const state = createFirstHourBreakoutState();
    const breakoutCtx = buildContext({
      date: breakoutBar.date,
      open: 106,
      close: 108,
      high: 109,
      low: 107,
      previous5m: [...firstHourBars],
      replayStepIndex: 10,
    });
    runFirstHourBreakout(breakoutCtx, state);

    const confirmCtx = buildContext({
      date: '2026-06-24T10:25:00+0530',
      open: 108,
      close: 109,
      high: 110,
      low: 108,
      previous5m: [...firstHourBars, breakoutBar],
      replayStepIndex: 11,
    });
    const result = runFirstHourBreakout(confirmCtx, state);

    expect(result.action).toBe('BUY');
    expect(state.tradedToday).toBe(true);
  });

  it('returns SKIPPED when market regime is not TRENDING', () => {
    const ctx = buildContext({
      date: '2026-06-24T10:20:00+0530',
      close: 108,
      high: 109,
      low: 107,
      previous5m: [],
    });
    ctx.marketRegime = 'RANGING';

    const state = createFirstHourBreakoutState();
    const result = runFirstHourBreakout(ctx, state);

    expect(result.action).toBe('SKIPPED');
  });

  it('rejects overextended breakout beyond max distance', () => {
    const firstHourBars = [
      candle('2026-06-24T09:15:00+0530', 100, 105, 99, 104),
      candle('2026-06-24T09:20:00+0530', 104, 106, 103, 105),
    ];

    const ctx = buildContext({
      date: '2026-06-24T10:20:00+0530',
      open: 106,
      close: 128,
      high: 129,
      low: 106,
      previous5m: firstHourBars,
      replayStepIndex: 10,
    });

    const dist = evaluateBreakoutDistanceFilter(ctx.candle5m, 'BUY', 106, 99);
    expect(dist.passed).toBe(false);
    expect(dist.distancePts).toBeGreaterThan(FIRST_HOUR_MAX_BREAKOUT_DISTANCE_PTS);

    const state = createFirstHourBreakoutState();
    const result = runFirstHourBreakout(ctx, state);
    expect(result.action).toBe('WAITING');
    expect(result.reason).toContain('Breakout distance');
  });
});
