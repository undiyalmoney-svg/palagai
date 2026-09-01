import { Candle } from '../../../models/candle.model';
import { IntradaySignal, hhmmOf, toMinutes } from './intraday-engine';

/**
 * Exhaustion Fade.
 *
 * A sharp intraday run that ends on a volume blow-off and stalls is the crowd
 * finishing — late buyers piling into the top (or sellers into the bottom) just
 * as the move runs out. We take the other side.
 *
 *   1. A directional RUN — price ≥2.5% over the last six 5-min bars (30 min).
 *   2. A VOLUME CLIMAX — that bar trades ≥3× its own 20-bar average volume.
 *   3. A BLOW-OFF bar — its range ≥2.3× ATR(14). The selectivity filter: only a
 *      genuinely violent rejection bar, never a small wobble. Most days: no trade.
 *   4. A STALL — the bar closes in the far third against the run (an up-run
 *      closing weak, a down-run closing strong = rejection).
 *   Direction fades the run: an exhausted rally is sold, an exhausted drop bought.
 *
 * Stop is 2×ATR — wide on purpose; a tight stop just harvests noise. There is no
 * profit target: the position is held to the session square-off (target is set
 * unreachably far so the engine's stop / square-off logic governs the exit).
 *
 * Window 10:15–14:30 so every trade has room to resolve before the close.
 */
export const EF_RUN_BARS = 6;
export const EF_RUN_PCT = 0.025; // 2.5% over EF_RUN_BARS
export const EF_VOL_MULT = 3.0;
export const EF_BLOWOFF_ATR = 2.3;
export const EF_STALL_THIRD = 0.34;
export const EF_STOP_ATR = 2.0;
export const EF_ENTRY_START_HHMM = '10:15';
export const EF_ENTRY_END_HHMM = '14:30';

function atr14(candles: Candle[], i: number): number {
  let tr = 0;
  let n = 0;
  for (let j = Math.max(1, i - 13); j <= i; j += 1) {
    tr += Math.max(
      candles[j]!.high - candles[j]!.low,
      Math.abs(candles[j]!.high - candles[j - 1]!.close),
      Math.abs(candles[j]!.low - candles[j - 1]!.close),
    );
    n += 1;
  }
  return n ? tr / n : 0;
}

function avgVolume(candles: Candle[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let j = from; j < to; j += 1) {
    sum += candles[j]!.volume ?? 0;
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * Emits the first exhaustion-fade of the day for one symbol, or null (no trade).
 * Signature matches the intraday engine's generateSignal contract.
 */
export function generateExhaustionFadeSignal(
  symbol: string,
  dayCandles: Candle[],
): IntradaySignal | null {
  if (dayCandles.length < 27) return null;
  const startMin = toMinutes(EF_ENTRY_START_HHMM);
  const endMin = toMinutes(EF_ENTRY_END_HHMM);

  for (let i = 25; i < dayCandles.length - 1; i += 1) {
    const bar = dayCandles[i]!;
    const t = hhmmOf(bar.date);
    const m = toMinutes(t);
    if (m < startMin) continue;
    if (m > endMin) break;

    const prior = dayCandles[i - EF_RUN_BARS]!;
    const run = (bar.close - prior.close) / prior.close; // signed fraction
    const av = avgVolume(dayCandles, i - 20, i);
    if (av <= 0) continue;
    const range = bar.high - bar.low;
    if (range <= 0) continue;
    const atr = atr14(dayCandles, i);
    if (atr <= 0) continue;
    if (range / atr < EF_BLOWOFF_ATR) continue;
    if ((bar.volume ?? 0) / av < EF_VOL_MULT) continue;

    const closeLow = (bar.close - bar.low) / range <= EF_STALL_THIRD;
    const closeHigh = (bar.high - bar.close) / range <= EF_STALL_THIRD;

    let direction: 'LONG' | 'SHORT' | null = null;
    if (run >= EF_RUN_PCT && closeLow) direction = 'SHORT'; // fade the exhausted rally
    else if (run <= -EF_RUN_PCT && closeHigh) direction = 'LONG'; // fade the exhausted drop
    if (!direction) continue;

    const entryPrice = bar.close;
    const stopDist = EF_STOP_ATR * atr;
    const stop = direction === 'LONG' ? entryPrice - stopDist : entryPrice + stopDist;
    // No fixed target — hold to square-off. Place it unreachably far so the
    // engine's stop / SQUARE_OFF logic decides the exit.
    const target =
      direction === 'LONG' ? entryPrice + 100 * atr : entryPrice - 100 * atr;

    return {
      symbol,
      triggerIndex: i,
      triggerTime: t,
      direction,
      entryPrice,
      stop,
      target,
      quality: Math.abs(run), // bigger blow-off ranks first on same-candle ties
    };
  }
  return null;
}
