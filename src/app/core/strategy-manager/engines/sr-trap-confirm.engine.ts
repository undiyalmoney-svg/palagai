/**
 * S/R Trap + Confirm engine — legend max-earn DNA (doc 31).
 *
 *  Bear trap @ support: wick below swing low, close back above → BUY (after next-bar confirm)
 *  Bull trap @ resistance: wick above swing high, close back below → SELL (after next-bar confirm)
 *  Also allows soft bounce reactions (mode=both).
 *  Stop beyond trap wick · target R-multiple (default 3.5).
 */
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { barsOnDay, emaLast, seriesAt } from '../indicators/desk-indicators';
import {
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import { StrategySettings } from '../models/strategy-settings.model';
import {
  RuleDayState,
  createRuleDayState,
  indexRuleExitLogic,
  applySlConfirmCutoff,
  armPeakTrailFloor,
  recordRuleTradeClosed,
} from './index-rule.engine';

export type SrTrapMode = 'trap' | 'both';

export interface SrTrapDayState extends RuleDayState {
  /** Pending trap awaiting next-bar confirm. */
  pending: {
    dir: 1 | -1;
    stop: number;
    signalClose: number;
    barSeq: number;
  } | null;
  barSeq: number;
}

export function createSrTrapDayState(): SrTrapDayState {
  return {
    ...createRuleDayState(),
    pending: null,
    barSeq: 0,
  };
}

export function recordSrTrapTradeClosed(
  state: SrTrapDayState,
  points: number,
  dayStopPts: number,
  dayProfitLockPts = 0,
): void {
  recordRuleTradeClosed(state, points, dayStopPts, dayProfitLockPts);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readTrapExtras(settings: StrategySettings): {
  swingLb: number;
  piercePts: number;
  mode: SrTrapMode;
  minRisk: number;
  maxRisk: number;
  slPad: number;
  minConfirmBody: number;
  /** Widen bounce pierce with morning OR (doc 45). 0 = off. */
  bounceOrPierceMult: number;
  bounceOrPierceCap: number;
} {
  const x = settings.extras ?? {};
  const mode = x['trapMode'] === 'trap' ? 'trap' : 'both';
  return {
    swingLb: Math.max(3, Math.floor(num(x['swingLb'], 5))),
    piercePts: num(x['piercePts'], 10),
    mode,
    minRisk: num(x['minRiskPts'], 4),
    maxRisk: num(x['maxRiskPts'], 28),
    slPad: num(x['slPadPts'], 2),
    minConfirmBody: num(x['minConfirmBody'], 0),
    bounceOrPierceMult: Math.max(0, num(x['bounceOrPierceMult'], 0)),
    bounceOrPierceCap: Math.max(0, num(x['bounceOrPierceCap'], 0)),
  };
}

/** Morning OR width 09:15–orEnd (default 09:45) for bounce pierce scaling. */
function morningOrWidth(dayBars: Candle[], orEnd: string): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of dayBars) {
    const t = extractHhMm(b.date);
    if (t < '09:15' || t > orEnd) {
      continue;
    }
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < lo) {
    return 0;
  }
  return hi - lo;
}

function swingHL(
  dayBars: Candle[],
  i: number,
  lb: number,
): { sh: number; sl: number } {
  const start = Math.max(0, i - lb);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i]!.high, sl: dayBars[i]!.low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low)),
  };
}

export function runSrTrapConfirm(
  ctx: StrategyContext,
  state: SrTrapDayState,
  settings: StrategySettings,
): ManagedStrategySignal {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  const series = seriesAt(ctx);
  const extras = readTrapExtras(settings);
  state.barSeq = series.length;

  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.dayStopped = false;
    state.pending = null;
  }

  const wait = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: 'sr-trap-confirm', ...analysis },
  });

  const skip = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'SKIPPED',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: 'sr-trap-confirm', ...analysis },
  });

  if (state.dayStopped) {
    return skip(`Day stopped (net ${state.dayNetPts.toFixed(1)})`);
  }
  if (settings.maxTradesPerDay > 0 && state.tradesToday >= settings.maxTradesPerDay) {
    return skip(
      `Max trades per day reached (${state.tradesToday}/${settings.maxTradesPerDay})`,
    );
  }

  const dayBars = barsOnDay(series, day);
  const i = dayBars.findIndex((b) => b.date === candle.date);
  if (i < extras.swingLb) {
    return wait('Warming swing lookback');
  }

  // --- Resolve next-bar confirm (enter at this open) ---
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (time < settings.entryTimeStart || time > settings.entryTimeEnd) {
      return wait('Confirm outside entry window');
    }
    const body = Math.abs(candle.close - candle.open);
    const bullOk =
      p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk =
      p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bullOk || bearOk)) {
      return wait('Trap confirm failed');
    }
    if (extras.minConfirmBody > 0 && body < extras.minConfirmBody) {
      return wait('Confirm body too small');
    }
    const fill = candle.open;
    const stop =
      p.dir === 1 ? Math.min(p.stop, fill - 1) : Math.max(p.stop, fill + 1);
    const risk = Math.abs(fill - stop);
    const bank = /bank/i.test(ctx.instrumentId ?? '');
    const maxRisk = bank ? Math.max(extras.maxRisk, 50) : extras.maxRisk;
    const minRisk = bank ? Math.max(extras.minRisk, 8) : extras.minRisk;
    if (risk < minRisk || risk > maxRisk) {
      return wait(`Risk ${risk.toFixed(1)} outside ${minRisk}–${maxRisk}`);
    }
    const rr = settings.targetRMultiple > 0 ? settings.targetRMultiple : 3.5;
    const target = p.dir === 1 ? fill + risk * rr : fill - risk * rr;
    return {
      action: p.dir === 1 ? 'BUY' : 'SELL',
      entryPrice: fill,
      stopLoss: stop,
      target,
      riskRewardRatio: rr,
      reason: `S/R trap confirm ${p.dir === 1 ? 'BUY' : 'SELL'} · ${rr}R`,
      analysis: {
        strategy: 'sr-trap-confirm',
        setup: 'trap_next_confirm',
        risk,
        rr,
      },
    };
  }

  if (time < settings.entryTimeStart) {
    return wait(`Before entry window ${settings.entryTimeStart}`);
  }
  if (time > settings.entryTimeEnd) {
    return skip(`After entry window ${settings.entryTimeEnd}`);
  }

  const closes = series.map((c) => c.close);
  const ema = emaLast(closes, settings.emaLength);
  if (ema == null) {
    return wait(`EMA-${settings.emaLength} warming up`);
  }

  const { sh, sl } = swingHL(dayBars, i, extras.swingLb);
  const trapPierce = extras.piercePts;
  // Doc 45: keep trap pierce at DNA floor; widen bounce only on wide morning OR.
  let bouncePierce = trapPierce;
  if (extras.bounceOrPierceMult > 0) {
    const orW = morningOrWidth(dayBars, settings.orEnd || '09:45');
    if (orW > 0) {
      bouncePierce = Math.max(trapPierce, orW * extras.bounceOrPierceMult);
      if (extras.bounceOrPierceCap > 0) {
        bouncePierce = Math.min(bouncePierce, extras.bounceOrPierceCap);
      }
    }
  }
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;

  const trapBuy = ll < sl - trapPierce && cc > sl && cc > oo;
  const trapSell = hh > sh + trapPierce && cc < sh && cc < oo;
  const rng = Math.max(hh - ll, 1e-9);
  const bounceBuy =
    ll <= sl + bouncePierce &&
    ll >= sl - bouncePierce * 2 &&
    cc > oo &&
    cc >= sl &&
    (hh - cc) / rng < 0.35;
  const bounceSell =
    hh >= sh - bouncePierce &&
    hh <= sh + bouncePierce * 2 &&
    cc < oo &&
    cc <= sh &&
    (cc - ll) / rng < 0.35;

  let dir: 1 | -1 | 0 = 0;
  let stop = 0;
  if (trapBuy || (extras.mode === 'both' && bounceBuy)) {
    if (cc > ema) {
      dir = 1;
      stop = ll - extras.slPad;
    }
  } else if (trapSell || (extras.mode === 'both' && bounceSell)) {
    if (cc < ema) {
      dir = -1;
      stop = hh + extras.slPad;
    }
  }

  if (!dir) {
    return wait('No S/R trap / bounce', { sh, sl, ema });
  }

  const risk = Math.abs(cc - stop);
  const bank = /bank/i.test(ctx.instrumentId ?? '');
  const maxRisk = bank ? Math.max(extras.maxRisk, 50) : extras.maxRisk;
  const minRisk = bank ? Math.max(extras.minRisk, 8) : extras.minRisk;
  if (risk < minRisk || risk > maxRisk) {
    return wait(`Signal risk ${risk.toFixed(1)} outside band`);
  }

  // Arm next-bar confirm (research: edge is confirm, not same-bar)
  state.pending = {
    dir,
    stop,
    signalClose: cc,
    barSeq: state.barSeq,
  };
  return wait(dir === 1 ? 'Trap BUY armed — wait confirm' : 'Trap SELL armed — wait confirm', {
    sh,
    sl,
    ema,
    armed: dir,
  });
}

export function srTrapExitLogic(
  candle: Candle,
  open: ManagedOpenPosition,
  closes: number[],
  settings: StrategySettings,
  ctx: StrategyContext,
): ManagedExitDecision | null {
  // Research: after ~₹600+ peak, trail (≤₹300 giveback) → cut & rehunt.
  const armed = armPeakTrailFloor(candle, open, settings, ctx.instrumentId ?? '');
  // Research: briefly-green SL confirm (MFE < 0.75R + 0.55R / ₹700 soft).
  const cutoff = applySlConfirmCutoff(candle, open, settings, ctx.instrumentId ?? '');
  if (cutoff) {
    return cutoff;
  }
  const exit = indexRuleExitLogic(
    candle,
    open,
    closes,
    settings,
    { entry: 'swing', bias: 'ema', exit: 'eod' },
    seriesAt(ctx),
  );
  if (exit) {
    if (armed && exit.reason === 'Stop loss hit') {
      return { ...exit, reason: 'Profit drained — cut & rehunt' };
    }
    return exit;
  }
  if (!armed) {
    return null;
  }
  // Close has fallen through the peak-trail floor (stop already ratcheted).
  const closePts =
    open.direction === 'BUY' ? candle.close - open.entry : open.entry - candle.close;
  const stopPts = Math.abs(open.stop - open.entry);
  if (closePts <= stopPts) {
    return {
      exitPrice: open.stop,
      reason: 'Profit drained — cut & rehunt',
    };
  }
  return null;
}

/** @deprecated Prefer armPeakTrailFloor — kept for existing Trap specs. */
export function armTrapProfitDrainFloor(
  candle: Candle,
  open: ManagedOpenPosition,
  settings: StrategySettings,
  instrumentId: string,
): boolean {
  return armPeakTrailFloor(candle, open, settings, instrumentId);
}
