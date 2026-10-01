/**
 * 1-minute pathway overlay shared by Nifty 50, Bank Nifty and Crude.
 *
 * Matches the session map used on the 1m Nifty tape: Day High / Day Low,
 * the last FVG, a 5-minute inducement, SL / PE / TG, and two time zones
 * after the latest BOS.
 */
import { Candle } from '../models/candle.model';
import { sessionDay } from './smc/smc-utils';
import { SmcAnalysis, SmcFvg, SmcStructureEvent, SmcTrade } from './smc/smc.types';

export interface SessionRange {
  day: string;
  high: number;
  low: number;
  highIndex: number;
  lowIndex: number;
}

export interface PathwayLevels {
  sl: number;
  /** 50% of SL → TG — the yellow PE line. */
  pe: number;
  tg: number;
  side: 'BUY' | 'SELL';
  /** True when the levels come from a live / last SMC trade. */
  fromTrade: boolean;
}

export interface PathwayInducement {
  price: number;
  index: number;
  /** e.g. `5M IDM` when the trend filter is 5 minutes. */
  label: string;
}

export interface PathwayZones {
  bosIndex: number;
  zone1: number;
  zone2: number;
}

export function sessionRange(candles: Candle[], day?: string): SessionRange | null {
  if (!candles.length) return null;
  const key = day || sessionDay(candles[candles.length - 1]!.date);
  let high = -Infinity;
  let low = Infinity;
  let highIndex = -1;
  let lowIndex = -1;
  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i]!;
    if (sessionDay(bar.date) !== key) continue;
    if (bar.high >= high) {
      high = bar.high;
      highIndex = i;
    }
    if (bar.low <= low) {
      low = bar.low;
      lowIndex = i;
    }
  }
  if (highIndex < 0 || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { day: key, high, low, highIndex, lowIndex };
}

export function lastBos(smc: SmcAnalysis | null): SmcStructureEvent | null {
  if (!smc) return null;
  for (let i = smc.structure.length - 1; i >= 0; i -= 1) {
    const event = smc.structure[i]!;
    if (event.kind === 'BOS') return event;
  }
  return null;
}

export function pathwayLevels(
  smc: SmcAnalysis | null,
  session: SessionRange | null,
  trade: SmcTrade | null,
): PathwayLevels | null {
  if (trade && Number.isFinite(trade.sl) && Number.isFinite(trade.tpFinal)) {
    const sl = trade.slNow ?? trade.sl;
    const tg = trade.tpFinal;
    return {
      sl,
      pe: sl + (tg - sl) * 0.5,
      tg,
      side: trade.side,
      fromTrade: true,
    };
  }
  const bos = lastBos(smc);
  if (!bos || !session) return null;
  if (bos.dir === 'bear') {
    return {
      sl: bos.level,
      pe: (bos.level + session.low) / 2,
      tg: session.low,
      side: 'SELL',
      fromTrade: false,
    };
  }
  return {
    sl: bos.level,
    pe: (bos.level + session.high) / 2,
    tg: session.high,
    side: 'BUY',
    fromTrade: false,
  };
}

/**
 * Inducement is the last liquidity that was swept at or before the latest BOS —
 * the stop-hunt that armed the displacement.
 */
export function pathwayInducement(
  smc: SmcAnalysis | null,
  htfLabel: string,
): PathwayInducement | null {
  const bos = lastBos(smc);
  if (!bos || !smc) return null;
  let best: { price: number; index: number } | null = null;
  for (const level of smc.liquidity) {
    if (level.sweptAt == null || level.sweptAt > bos.index) continue;
    if (!best || level.sweptAt > best.index) {
      best = { price: level.price, index: level.index };
    }
  }
  if (!best) return null;
  const tf = String(htfLabel || '5m').replace(/\s+/g, '').toUpperCase();
  return { ...best, label: `${tf}-IDM` };
}

/** Two time windows after the last BOS: +15 minutes and +30 minutes. */
export function pathwayZones(
  smc: SmcAnalysis | null,
  intervalMinutes: number,
): PathwayZones | null {
  const bos = lastBos(smc);
  if (!bos) return null;
  const step = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 1;
  const bars = Math.max(1, Math.round(15 / step));
  return {
    bosIndex: bos.index,
    zone1: bos.index + bars,
    zone2: bos.index + bars * 2,
  };
}

/** The latest unfilled gap — the compact FVG box on the 1-minute tape. */
export function lastCompactFvgs(smc: SmcAnalysis | null, limit = 1): SmcFvg[] {
  if (!smc) return [];
  return smc.fvgs.filter((g) => g.status === 'active').slice(-Math.max(1, limit));
}

export interface PathwayPaintModel {
  session: SessionRange | null;
  bos: SmcStructureEvent | null;
  levels: PathwayLevels | null;
  idm: PathwayInducement | null;
  zones: PathwayZones | null;
  fvgs: SmcFvg[];
}

/** Everything the painter needs for the Instagram-style 1-minute overlay. */
export function pathwayPaintModel(
  candles: Candle[],
  smc: SmcAnalysis | null,
  opts: { htfLabel?: string; intervalMinutes?: number; trade?: SmcTrade | null } = {},
): PathwayPaintModel {
  const session = sessionRange(candles);
  return {
    session,
    bos: lastBos(smc),
    levels: pathwayLevels(smc, session, opts.trade ?? null),
    idm: pathwayInducement(smc, opts.htfLabel || '5m'),
    zones: pathwayZones(smc, opts.intervalMinutes ?? 1),
    fvgs: lastCompactFvgs(smc, 1),
  };
}
