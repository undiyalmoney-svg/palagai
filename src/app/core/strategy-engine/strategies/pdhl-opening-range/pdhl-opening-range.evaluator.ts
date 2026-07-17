import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../models/strategy-context.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm, resolveSessionFromContext } from '../../utils/market-session.util';
import { buildSignalDebug } from '../../utils/signal-debug.util';

export type PdhlSignalAction = 'BUY' | 'SELL' | 'NO_TRADE' | 'WAITING' | 'SKIPPED';

export interface PdhlOrResult {
  action: PdhlSignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export interface PdhlOrState {
  tradingDate: string | null;
  /** Running day P&L in points (closed trades only). */
  dayNetPts: number;
  tradesToday: number;
  lossesToday: number;
  winsToday: number;
  dayStoppedReason: string | null;
}

export function createPdhlOrState(): PdhlOrState {
  return {
    tradingDate: null,
    dayNetPts: 0,
    tradesToday: 0,
    lossesToday: 0,
    winsToday: 0,
    dayStoppedReason: null,
  };
}

/** User capital plan: Nifty 1 point = ₹65 */
export const PDHL_RUPEES_PER_POINT = 65;
/** Bank Nifty plan: 1 point = ₹30 */
export const PDHL_BANK_RUPEES_PER_POINT = 30;
/** Desk checkbox: combined strict day loss (₹) — split across selected books. */
export const DESK_STRICT_DAY_LOSS_RS = 2950;
/** Desk checkbox: combined day profit lock (₹) — split across selected books. */
export const DESK_DAY_PROFIT_LOCK_RS = 5000;

/**
 * Per-index risk profile (champion pair, 2020–2026 hunt):
 * same DNA on both — 1R target, no day profit lock, day stop −60, EMA exit.
 * Nifty SL cap 30; Bank SL cap 45 (wider for volatility).
 */
export interface PdhlOrParams {
  maxStopPts: number;
  minStopPts: number;
  targetRMultiple: number;
  /** 0 = disabled (no day profit lock). */
  dailyProfitLockPts: number;
  /** 0 = disabled. */
  dailyMaxLossPts: number;
  earliestEntry: string;
  lastEntry: string;
  dna: string;
}

/** Nifty champion: cap30 | r_1 | whole_day | ema_exit | L0 | S60 */
export const PDHL_NIFTY_PARAMS: PdhlOrParams = {
  maxStopPts: 30,
  minStopPts: 3,
  targetRMultiple: 1,
  dailyProfitLockPts: 0,
  dailyMaxLossPts: 60,
  earliestEntry: '09:20',
  lastEntry: '15:10',
  dna: 'opening_range|swing|breakout|cap30|r_1|whole_day|ema_exit|L0|S60',
};

/** Bank champion: cap45 | r_1 | whole_day | ema_exit | L0 | S60 */
export const PDHL_BANK_PARAMS: PdhlOrParams = {
  maxStopPts: 45,
  minStopPts: 3,
  targetRMultiple: 1,
  dailyProfitLockPts: 0,
  dailyMaxLossPts: 60,
  earliestEntry: '09:20',
  lastEntry: '15:10',
  dna: 'opening_range|swing|breakout|cap45|r_1|whole_day|ema_exit|L0|S60',
};

/** @deprecated Use PDHL_NIFTY_PARAMS.maxStopPts — kept for callers */
export const PDHL_MAX_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.maxStopPts;
export const PDHL_MIN_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.minStopPts;
export const PDHL_TARGET_R_MULTIPLE = PDHL_NIFTY_PARAMS.targetRMultiple;
export const PDHL_DAILY_PROFIT_LOCK_PTS = PDHL_NIFTY_PARAMS.dailyProfitLockPts;
export const PDHL_DAILY_MAX_LOSS_PTS = PDHL_NIFTY_PARAMS.dailyMaxLossPts;
/** Matches hunt whole_day window upper bound */
export const PDHL_LAST_ENTRY_TIME = PDHL_NIFTY_PARAMS.lastEntry;
export const PDHL_SWING_LOOKBACK = 3;
export const PDHL_EMA_EXIT_PERIOD = 20;

export function resolvePdhlOrParams(instrumentId?: string | null): PdhlOrParams {
  const id = (instrumentId ?? '').toLowerCase();
  if (id === 'bank-nifty' || id.includes('banknifty') || id.includes('bank-nifty')) {
    return PDHL_BANK_PARAMS;
  }
  return PDHL_NIFTY_PARAMS;
}

export function isBankPdhlInstrument(instrumentId?: string | null): boolean {
  const id = (instrumentId ?? '').toLowerCase();
  return id === 'bank-nifty' || id.includes('banknifty') || id.includes('bank-nifty');
}

export function rupeesPerPointForInstrument(instrumentId?: string | null): number {
  return isBankPdhlInstrument(instrumentId) ? PDHL_BANK_RUPEES_PER_POINT : PDHL_RUPEES_PER_POINT;
}

/** Merge champion DNA with optional Trade Desk risk checkboxes. */
export function mergePdhlOrParams(
  instrumentId: string | null | undefined,
  overrides?: Partial<PdhlOrParams> | null,
): PdhlOrParams {
  const base = resolvePdhlOrParams(instrumentId);
  if (!overrides) {
    return base;
  }
  return { ...base, ...overrides };
}

/**
 * Build per-book day loss / profit overrides from Trade Desk checkboxes.
 * Strict −₹2950 and profit lock +₹5000 are split evenly when both books are on.
 */
export function buildDeskRiskOverrides(options: {
  instrumentId: string;
  enableNifty: boolean;
  enableBank: boolean;
  strictDayStop: boolean;
  dayProfitLock: boolean;
}): Partial<PdhlOrParams> | undefined {
  if (!options.strictDayStop && !options.dayProfitLock) {
    return undefined;
  }
  const both = options.enableNifty && options.enableBank;
  const share = both ? 0.5 : 1;
  const rs = rupeesPerPointForInstrument(options.instrumentId);
  const overrides: Partial<PdhlOrParams> = {};
  if (options.strictDayStop) {
    overrides.dailyMaxLossPts = Math.max(1, Math.round((DESK_STRICT_DAY_LOSS_RS * share) / rs));
  }
  if (options.dayProfitLock) {
    overrides.dailyProfitLockPts = Math.max(1, Math.round((DESK_DAY_PROFIT_LOCK_RS * share) / rs));
  }
  return overrides;
}

export function recordPdhlTradeClosed(
  state: PdhlOrState,
  points: number,
  params: PdhlOrParams = PDHL_NIFTY_PARAMS,
): void {
  state.dayNetPts += points;
  state.tradesToday += 1;
  if (points < 0) {
    state.lossesToday += 1;
  } else if (points > 0) {
    state.winsToday += 1;
  }

  if (params.dailyProfitLockPts > 0 && state.dayNetPts >= params.dailyProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
  } else if (params.dailyMaxLossPts > 0 && state.dayNetPts <= -params.dailyMaxLossPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
  }
}

function openingRange(
  dayBars: Candle[],
  marketOpen: string,
  firstHourEnd: string,
): { high: number; low: number; mid: number; range: number } | null {
  const bars = dayBars.filter((c) => {
    const t = extractHhMm(c.date);
    return t >= marketOpen && t < firstHourEnd;
  });
  if (!bars.length) {
    return null;
  }
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, mid: (high + low) / 2, range: high - low };
}

/**
 * Hunt-compatible swing at `index` (lookback=3, forward-fill).
 * Pass full backtest `series5m` so pivot confirmation can use bars after `index`
 * (same as analyst research). For live, pass only history+current for causal swings.
 */
export function swingAtIndex(
  series: Candle[],
  index: number,
  lookback: number = PDHL_SWING_LOOKBACK,
): { high: number; low: number } | null {
  if (index < 0 || index >= series.length || series.length < lookback * 2 + 1) {
    return null;
  }
  let lastH = NaN;
  let lastL = NaN;
  const maxPivot = Math.min(index, series.length - 1 - lookback);
  for (let i = lookback; i <= maxPivot; i += 1) {
    const bar = series[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j += 1) {
      if (bar.high <= series[i - j]!.high || bar.high <= series[i + j]!.high) {
        isHigh = false;
      }
      if (bar.low >= series[i - j]!.low || bar.low >= series[i + j]!.low) {
        isLow = false;
      }
    }
    if (isHigh) {
      lastH = bar.high;
    }
    if (isLow) {
      lastL = bar.low;
    }
  }
  if (!Number.isFinite(lastH) || !Number.isFinite(lastL)) {
    return null;
  }
  return { high: lastH, low: lastL };
}

export function lastConfirmedSwing(
  candles: Candle[],
  lookback: number = PDHL_SWING_LOOKBACK,
): { high: number; low: number } | null {
  return swingAtIndex(candles, candles.length - 1, lookback);
}

/** SMA-seeded EMA (matches analyst hunt). */
export function emaLast(closes: number[], period: number = PDHL_EMA_EXIT_PERIOD): number | null {
  if (closes.length < period) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < period; i += 1) {
    sum += closes[i]!;
  }
  let prev = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    prev = closes[i]! * k + prev * (1 - k);
  }
  return prev;
}

/**
 * OR bias + swing breakout, SL cap + 1R, multi-entry until day lock/stop.
 * Params resolve from ctx.instrumentId (Bank vs Nifty), optional desk overrides.
 */
export function runPdhlOpeningRange(
  ctx: StrategyContext,
  state: PdhlOrState,
  paramsOverride?: Partial<PdhlOrParams> | null,
): PdhlOrResult {
  const p = mergePdhlOrParams(ctx.instrumentId, paramsOverride);
  const session = resolveSessionFromContext(ctx);
  const current = ctx.candle5m;
  const tradingDate = extractTradeDate(current.date);
  const time = extractHhMm(current.date, session.timezone);
  const all5m = [...ctx.previous5m, current];
  const series5m = ctx.series5m?.length ? ctx.series5m : all5m;
  const seriesIndex = ctx.series5m?.length ? ctx.candleIndex5m : all5m.length - 1;
  const dayBars = all5m.filter((c) => extractTradeDate(c.date) === tradingDate);

  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.lossesToday = 0;
    state.winsToday = 0;
    state.dayStoppedReason = null;
  }

  const base = {
    tradingDate,
    time,
    strategy: 'OR Swing Breakout',
    dna: p.dna,
    instrumentId: ctx.instrumentId ?? null,
    rupeesPerPoint: rupeesPerPointForInstrument(ctx.instrumentId),
    dayNetPts: state.dayNetPts,
    dayNetRs: state.dayNetPts * rupeesPerPointForInstrument(ctx.instrumentId),
    tradesToday: state.tradesToday,
    lossesToday: state.lossesToday,
    dailyProfitLock: p.dailyProfitLockPts,
    dailyMaxLoss: p.dailyMaxLossPts,
    maxStopPts: p.maxStopPts,
    earliestEntry: p.earliestEntry,
  };

  if (time < session.marketOpen) {
    return waiting(current, 'Before market open', base);
  }

  if (time < session.firstHourReadyTime) {
    return waiting(
      current,
      `Waiting for opening range (${session.marketOpen}–${session.firstHourEnd})`,
      base,
    );
  }

  if (state.dayStoppedReason) {
    return noTrade(current, state.dayStoppedReason, base);
  }

  if (p.dailyProfitLockPts > 0 && state.dayNetPts >= p.dailyProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return noTrade(current, state.dayStoppedReason, base);
  }
  if (p.dailyMaxLossPts > 0 && state.dayNetPts <= -p.dailyMaxLossPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return noTrade(current, state.dayStoppedReason, base);
  }

  if (time < p.earliestEntry || time > p.lastEntry) {
    return waiting(
      current,
      `Outside entry window (${p.earliestEntry}–${p.lastEntry})`,
      base,
    );
  }

  const or = openingRange(dayBars, session.marketOpen, session.firstHourEnd);
  if (!or) {
    return waiting(current, 'Opening range unavailable', base);
  }

  const bias: 'BUY' | 'SELL' = current.close >= or.mid ? 'BUY' : 'SELL';
  const swing = swingAtIndex(series5m, seriesIndex, PDHL_SWING_LOOKBACK);
  if (!swing) {
    return waiting(current, 'Swing high/low not ready', {
      ...base,
      bias,
      orHigh: or.high,
      orLow: or.low,
    });
  }

  let action: 'BUY' | 'SELL' | null = null;
  if (bias === 'BUY' && current.close > swing.high) {
    action = 'BUY';
  } else if (bias === 'SELL' && current.close < swing.low) {
    action = 'SELL';
  }

  if (!action) {
    return waiting(current, 'Waiting for OR bias + swing breakout', {
      ...base,
      bias,
      orHigh: or.high,
      orLow: or.low,
      swingHigh: swing.high,
      swingLow: swing.low,
    });
  }

  const entry = current.close;
  let stopLoss = action === 'BUY' ? current.low : current.high;
  let risk = Math.abs(entry - stopLoss);
  if (risk < p.minStopPts) {
    return waiting(current, `Risk ${risk.toFixed(1)} < min ${p.minStopPts}`, {
      ...base,
      bias,
      swingHigh: swing.high,
      swingLow: swing.low,
    });
  }
  if (risk > p.maxStopPts) {
    stopLoss = action === 'BUY' ? entry - p.maxStopPts : entry + p.maxStopPts;
    risk = p.maxStopPts;
  }

  if (p.dailyMaxLossPts > 0 && state.dayNetPts - risk < -p.dailyMaxLossPts) {
    return noTrade(
      current,
      `Next SL would breach day max loss (day ${state.dayNetPts.toFixed(1)}, risk ${risk.toFixed(1)})`,
      base,
    );
  }

  const targetPts = risk * p.targetRMultiple;
  const target = action === 'BUY' ? entry + targetPts : entry - targetPts;
  const rr = p.targetRMultiple;
  const targetRs = targetPts * PDHL_RUPEES_PER_POINT;

  const debug = buildSignalDebug({
    marketRegime: String(ctx.marketRegime ?? 'N/A'),
    strategyStatus: 'PASS',
    currentStep: 'Entry',
    blockingRule: 'None',
    expectedValue: action,
    actualValue: action,
    nextConditionRequired: 'Trade execution',
    steps: [
      { name: 'Day Budget', status: 'PASS', actualValue: `${state.dayNetPts.toFixed(1)} pts` },
      { name: 'OR Bias', status: 'PASS', actualValue: bias },
      { name: 'Swing Breakout', status: 'PASS', actualValue: `${swing.low.toFixed(1)}–${swing.high.toFixed(1)}` },
      { name: 'Target', status: 'PASS', actualValue: `${targetPts.toFixed(1)} pts (${rr}R)` },
    ],
  });

  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    riskRewardRatio: rr,
    reason: `${action} #${state.tradesToday + 1} — swing breakout, ${rr}R | day ${state.dayNetPts.toFixed(1)}`,
    analysis: {
      ...base,
      bias,
      pattern: 'swing_breakout',
      orHigh: or.high,
      orLow: or.low,
      swingHigh: swing.high,
      swingLow: swing.low,
      riskPts: risk,
      targetPts,
      targetRs,
      riskRs: risk * PDHL_RUPEES_PER_POINT,
      finalDecision: action,
      debug,
    },
  };
}

export function clampStopLoss(
  entry: number,
  direction: 'BUY' | 'SELL',
  proposedStop: number,
  maxPts: number = PDHL_MAX_STOP_LOSS_PTS,
): number {
  const capped = direction === 'BUY' ? entry - maxPts : entry + maxPts;
  if (direction === 'BUY') {
    const belowEntry = Math.min(proposedStop, entry - PDHL_MIN_STOP_LOSS_PTS);
    return Math.max(belowEntry, capped);
  }
  const aboveEntry = Math.max(proposedStop, entry + PDHL_MIN_STOP_LOSS_PTS);
  return Math.min(aboveEntry, capped);
}

function waiting(
  candle: Candle,
  reason: string,
  analysis: Record<string, unknown>,
): PdhlOrResult {
  return {
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: 'WAITING', currentStep: reason },
  };
}

function noTrade(
  candle: Candle,
  reason: string,
  analysis: Record<string, unknown>,
): PdhlOrResult {
  return {
    action: 'NO_TRADE',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: 'NO_TRADE' },
  };
}
