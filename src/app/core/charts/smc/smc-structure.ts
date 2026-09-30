/**
 * Market structure and trend — one timeframe, one forward pass.
 *
 * Feed closed candles in order with `step()`. Each call only ever reads the
 * bars already fed, so the same code produces the same answers on a history
 * replay and on a live chart that receives one candle at a time.
 *
 * What is confirmed, and when:
 *  - a swing high / low is fixed `swingLength` bars after its pivot bar
 *  - a BOS / CHoCH is fixed on the bar whose CLOSE goes through a swing
 *  - the trend on each bar is recorded once and never revised
 */
import { Candle } from '../../models/candle.model';
import {
  SmcEqualLevel,
  SmcStructureEvent,
  SmcSwing,
  SmcSwingLabel,
  SmcTrend,
} from './smc.types';

export interface StructureOptions {
  swingLength: number;
  atrPeriod: number;
  eqTolAtr: number;
  eqLookbackSwings: number;
  breakBufferAtr: number;
  rangeSwings: number;
  sidewaysRangeAtr: number;
}

export interface StructureStep {
  swings: SmcSwing[];
  event: SmcStructureEvent | null;
  equalLevels: SmcEqualLevel[];
}

export class StructureTracker {
  readonly bars: Candle[] = [];
  readonly atr: number[] = [];
  readonly swings: SmcSwing[] = [];
  readonly events: SmcStructureEvent[] = [];
  readonly equalLevels: SmcEqualLevel[] = [];
  readonly trendAt: SmcTrend[] = [];

  trend: SmcTrend = 'sideways';
  /** Direction of the last confirmed break: 1 up, -1 down, 0 none yet. */
  dir: 0 | 1 | -1 = 0;
  /** Most recent confirmed swings that no close has gone through yet. */
  lastHigh: SmcSwing | null = null;
  lastLow: SmcSwing | null = null;

  private atrValue = 0;
  private trSum = 0;
  private readonly highs: SmcSwing[] = [];
  private readonly lows: SmcSwing[] = [];

  constructor(
    private readonly opts: StructureOptions,
    private readonly idPrefix = '',
  ) {}

  step(bar: Candle): StructureStep {
    const i = this.bars.length;
    this.bars.push(bar);
    this.pushAtr(bar, i);

    const swings: SmcSwing[] = [];
    const equalLevels: SmcEqualLevel[] = [];
    const n = this.opts.swingLength;
    const p = i - n;
    if (p >= n) {
      if (this.isPivot(p, 'high')) {
        const swing = this.registerSwing('high', p, i);
        if (swing) {
          swings.push(swing);
          const eq = this.findEqual(swing);
          if (eq) equalLevels.push(eq);
        }
      }
      if (this.isPivot(p, 'low')) {
        const swing = this.registerSwing('low', p, i);
        if (swing) {
          swings.push(swing);
          const eq = this.findEqual(swing);
          if (eq) equalLevels.push(eq);
        }
      }
    }

    const event = this.detectBreak(bar, i);
    this.trend = this.classifyTrend(i);
    this.trendAt.push(this.trend);
    return { swings, event, equalLevels };
  }

  private pushAtr(bar: Candle, i: number): void {
    const prevClose = i > 0 ? this.bars[i - 1]!.close : bar.open;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose),
    );
    const period = this.opts.atrPeriod;
    if (i < period) {
      this.trSum += tr;
      this.atrValue = this.trSum / (i + 1);
    } else {
      this.atrValue = (this.atrValue * (period - 1) + tr) / period;
    }
    this.atr.push(this.atrValue);
  }

  /** Pivot bar `p` against `swingLength` neighbours each side, ties allowed. */
  private isPivot(p: number, kind: 'high' | 'low'): boolean {
    const n = this.opts.swingLength;
    const bars = this.bars;
    const pivot = kind === 'high' ? bars[p]!.high : bars[p]!.low;
    for (let k = p - n; k <= p + n; k += 1) {
      if (k === p) continue;
      const other = kind === 'high' ? bars[k]!.high : bars[k]!.low;
      if (kind === 'high' ? other > pivot : other < pivot) return false;
    }
    return true;
  }

  private registerSwing(kind: 'high' | 'low', p: number, i: number): SmcSwing | null {
    const list = kind === 'high' ? this.highs : this.lows;
    const price = kind === 'high' ? this.bars[p]!.high : this.bars[p]!.low;
    const prev = list[list.length - 1] ?? null;
    // A flat top / bottom makes several neighbouring bars tie as pivots.
    if (prev && p - prev.index <= this.opts.swingLength && prev.price === price) {
      return null;
    }
    const tol = this.opts.eqTolAtr * this.atr[i]!;
    let label: SmcSwingLabel | null = null;
    if (prev) {
      if (Math.abs(price - prev.price) <= tol) label = kind === 'high' ? 'EQH' : 'EQL';
      else if (price > prev.price) label = kind === 'high' ? 'HH' : 'HL';
      else label = kind === 'high' ? 'LH' : 'LL';
    }
    const swing: SmcSwing = {
      id: `${this.idPrefix}${kind === 'high' ? 'sh' : 'sl'}${p}`,
      kind,
      index: p,
      price,
      confirmedAt: i,
      label,
      brokenAt: null,
    };
    list.push(swing);
    this.swings.push(swing);
    if (kind === 'high') this.lastHigh = swing;
    else this.lastLow = swing;
    return swing;
  }

  private findEqual(swing: SmcSwing): SmcEqualLevel | null {
    const list = swing.kind === 'high' ? this.highs : this.lows;
    const tol = this.opts.eqTolAtr * this.atr[swing.confirmedAt]!;
    const from = Math.max(0, list.length - 1 - this.opts.eqLookbackSwings);
    for (let k = list.length - 2; k >= from; k -= 1) {
      const other = list[k]!;
      if (swing.index - other.index <= this.opts.swingLength) continue;
      if (Math.abs(other.price - swing.price) <= tol) {
        const level: SmcEqualLevel = {
          id: `${this.idPrefix}${swing.kind === 'high' ? 'eqh' : 'eql'}${other.index}-${swing.index}`,
          kind: swing.kind === 'high' ? 'EQH' : 'EQL',
          price: swing.kind === 'high' ? Math.max(other.price, swing.price) : Math.min(other.price, swing.price),
          indexA: other.index,
          indexB: swing.index,
          confirmedAt: swing.confirmedAt,
        };
        this.equalLevels.push(level);
        return level;
      }
    }
    return null;
  }

  private detectBreak(bar: Candle, i: number): SmcStructureEvent | null {
    const buffer = this.opts.breakBufferAtr * this.atr[i]!;
    const high = this.lastHigh;
    const low = this.lastLow;
    const upBreak = high != null && bar.close > high.price + buffer;
    const downBreak = low != null && bar.close < low.price - buffer;
    if (!upBreak && !downBreak) return null;

    // A bar that closes through both sides is decided by where it closed in
    // its own range — deterministic, and never looks at the next bar.
    let up = upBreak;
    if (upBreak && downBreak) {
      up = bar.close - bar.low >= bar.high - bar.close;
    }
    const swing = (up ? high : low)!;
    const kind: SmcStructureEvent['kind'] =
      (up && this.dir < 0) || (!up && this.dir > 0) ? 'CHoCH' : 'BOS';
    const event: SmcStructureEvent = {
      id: `${this.idPrefix}${kind}-${up ? 'bull' : 'bear'}-${i}`,
      kind,
      dir: up ? 'bull' : 'bear',
      level: swing.price,
      swingIndex: swing.index,
      index: i,
      confirmedAt: i,
      date: bar.date,
    };
    swing.brokenAt = i;
    if (up) this.lastHigh = null;
    else this.lastLow = null;
    this.dir = up ? 1 : -1;
    this.events.push(event);
    return event;
  }

  /**
   * Trend from confirmed structure alone: the direction of the last break,
   * unless the structure has gone flat.
   *
   * Flat means either the latest swings span only a sliver of ATR, or the
   * last three breaks keep flipping direction (a chop of CHoCH / CHoCH).
   */
  private classifyTrend(i: number): SmcTrend {
    if (this.dir === 0) return 'sideways';

    const evs = this.events;
    if (evs.length >= 3) {
      const [a, b, c] = evs.slice(-3);
      if (a!.dir !== b!.dir && b!.dir !== c!.dir) return 'sideways';
    }

    const recent = this.swings.slice(-this.opts.rangeSwings);
    if (recent.length >= this.opts.rangeSwings) {
      let hi = -Infinity;
      let lo = Infinity;
      for (const s of recent) {
        if (s.price > hi) hi = s.price;
        if (s.price < lo) lo = s.price;
      }
      if (hi - lo < this.opts.sidewaysRangeAtr * this.atr[i]!) return 'sideways';
    }
    return this.dir > 0 ? 'bullish' : 'bearish';
  }

  /** Latest labels for the panel, e.g. `HH / HL`. */
  structureText(): string {
    const label = (list: SmcSwing[]) => {
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const l = list[k]!.label;
        if (l) return l;
      }
      return null;
    };
    const h = label(this.highs);
    const l = label(this.lows);
    if (!h && !l) return '—';
    return [h ?? '—', l ?? '—'].join(' / ');
  }
}
