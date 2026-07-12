import { Candle, Timeframe } from '../../models/candle.model';
import { StrategyContext } from './strategy-context.model';
import {
  InstrumentSessionConfig,
  NSE_SESSION,
  resolveSessionConfig,
} from '../../config/session.config';

export class CandleDataset {
  private readonly replayIndices5m: number[];

  constructor(
    private readonly allCandles: Record<Timeframe, Candle[]>,
    private readonly replayFrom: string,
    private readonly replayTo: string,
    readonly fetchFromDateTime: string,
    readonly session: InstrumentSessionConfig = NSE_SESSION,
    readonly instrumentId?: string,
  ) {
    this.replayIndices5m = this.buildReplayIndices();
  }

  get replayCandles(): Candle[] {
    return this.replayIndices5m.map((index) => this.allCandles['5minute'][index]);
  }

  get replayCount(): number {
    return this.replayIndices5m.length;
  }

  get(timeframe: Timeframe): Candle[] {
    return this.allCandles[timeframe];
  }

  findReplayStepByDateTime(dateTime: string): number {
    const targetTs = this.parseTimestamp(dateTime);
    const replayCandles = this.replayCandles;

    for (let step = 0; step < replayCandles.length; step += 1) {
      const candleTs = this.parseTimestamp(replayCandles[step]!.date);
      if (candleTs === targetTs) {
        return step;
      }
    }

    for (let step = 0; step < replayCandles.length; step += 1) {
      const candleTs = this.parseTimestamp(replayCandles[step]!.date);
      if (Math.abs(candleTs - targetTs) < 60_000) {
        return step;
      }
    }

    return -1;
  }

  buildContext(replayStepIndex: number): StrategyContext {
    const index5m = this.replayIndices5m[replayStepIndex];
    const candles5m = this.allCandles['5minute'];
    const current5m = candles5m[index5m];
    const timestamp = current5m.date;

    return {
      candle60m: this.activeCandle('60minute', timestamp),
      candle30m: this.activeCandle('30minute', timestamp),
      candle15m: this.activeCandle('15minute', timestamp),
      candle5m: current5m,
      previous60m: this.previousCandles('60minute', timestamp),
      previous30m: this.previousCandles('30minute', timestamp),
      previous15m: this.previousCandles('15minute', timestamp),
      previous5m: candles5m.slice(0, index5m),
      candleIndex5m: index5m,
      replayStepIndex,
      replayFrom: this.replayFrom,
      replayTo: this.replayTo,
      session: this.session,
      instrumentId: this.instrumentId,
      series5m: candles5m,
    };
  }

  private parseTimestamp(dateTime: string): number {
    const normalized = dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T');
    return new Date(normalized).getTime();
  }

  private buildReplayIndices(): number[] {
    const candles5m = this.allCandles['5minute'];
    const fromTs = new Date(this.replayFrom.replace(' ', 'T')).getTime();
    const toTs = new Date(this.replayTo.replace(' ', 'T')).getTime();

    return candles5m
      .map((candle, index) => ({ candle, index }))
      .filter(({ candle }) => {
        const ts = new Date(candle.date.replace(' ', 'T')).getTime();
        return ts >= fromTs && ts <= toTs;
      })
      .map(({ index }) => index);
  }

  private activeCandle(timeframe: Timeframe, timestamp: string): Candle {
    const candles = this.allCandles[timeframe];
    if (!candles.length) {
      throw new Error(`No ${timeframe} candles loaded`);
    }

    const ts = new Date(timestamp.replace(' ', 'T')).getTime();
    let active = candles[0];

    for (const candle of candles) {
      if (new Date(candle.date.replace(' ', 'T')).getTime() <= ts) {
        active = candle;
      } else {
        break;
      }
    }

    return active;
  }

  private previousCandles(timeframe: Timeframe, timestamp: string): Candle[] {
    const ts = new Date(timestamp.replace(' ', 'T')).getTime();
    return this.allCandles[timeframe].filter(
      (c) => new Date(c.date.replace(' ', 'T')).getTime() < ts,
    );
  }
}
