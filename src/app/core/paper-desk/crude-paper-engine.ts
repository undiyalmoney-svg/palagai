import { Candle } from '../models/candle.model';
import { Instrument } from '../models/instrument.model';
import { MCX_CRUDE_SESSION } from '../config/session.config';
import { extractTradeDate } from '../utils/trade-date.util';
import { extractHhMm } from '../strategy-engine/utils/market-session.util';
import {
  CRUDE_EXIT_BY,
  CRUDE_RUPEES_PER_POINT,
  CrudeSessionBook,
  createCrudePdhlState,
  CrudePdhlState,
  recordCrudeTradeClosed,
  runCrudePdhlEvening,
} from '../strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { runCrudeMorningOrb } from '../strategy-engine/strategies/crude-orb-morning/crude-orb-morning.evaluator';
import {
  createCrudeTrapState,
  CrudeTrapState,
  runCrudeTrapConfirm,
} from '../strategy-engine/strategies/crude-trap-confirm/crude-trap-confirm.evaluator';
import { runCrudeSessionOr } from '../strategy-engine/strategies/crude-session-or/crude-session-or.evaluator';
import {
  CrudeTradeParams,
  resolveCrudeStrategyProfile,
} from '../strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import {
  resolveAtmCrudeMiniOption,
  toCrudePaperOption,
} from '../utils/crude-option.util';
import {
  PaperOptionContract,
  PaperTrade,
} from '../paper-desk/paper-desk.models';

export interface CrudeOpenPaper {
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  entryTime: string;
  book: CrudeSessionBook;
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
  premiumEstimated: boolean;
  /** Peak favorable excursion (pts) for Trap-style peak-trail. */
  peakMfePts?: number;
  riskPts?: number;
}

export interface CrudeReplayResult {
  instrumentId: string;
  instrumentName: string;
  trades: PaperTrade[];
  dayNetByDate: Record<string, number>;
  lastSignal: string;
  open: CrudeOpenPaper | null;
  state: CrudePdhlState;
  chosenOption: PaperOptionContract | null;
  chosenBias: 'BUY' | 'SELL' | null;
  indexSpot: number | null;
  chosenAsOf: string | null;
}

function applyCrudePeakTrail(
  candle: Candle,
  open: CrudeOpenPaper,
  tradeParams: CrudeTradeParams,
): boolean {
  const armRs = tradeParams.profitLockArmRs;
  if (!(armRs > 0)) {
    return false;
  }
  const rs = CRUDE_RUPEES_PER_POINT;
  const armPts = armRs / rs;
  const barMfe =
    open.direction === 'BUY' ? candle.high - open.entry : open.entry - candle.low;
  const peak = Math.max(open.peakMfePts ?? 0, Math.max(0, barMfe));
  open.peakMfePts = peak;
  if (peak < armPts) {
    return false;
  }
  const peakRs = peak * rs;
  const floorRs = Math.max(
    tradeParams.profitLockLockRs,
    peakRs - Math.max(0, tradeParams.profitLockGivebackRs),
  );
  const floorPts = floorRs / rs;
  if (open.direction === 'BUY') {
    const lockStop = open.entry + floorPts;
    if (lockStop > open.stop) {
      open.stop = lockStop;
      return true;
    }
  } else {
    const lockStop = open.entry - floorPts;
    if (lockStop < open.stop) {
      open.stop = lockStop;
      return true;
    }
  }
  return false;
}

function applyCrudeSoftCutoff(
  candle: Candle,
  open: CrudeOpenPaper,
  tradeParams: CrudeTradeParams,
): { exitPrice: number; reason: string } | null {
  if (!tradeParams.slConfirmCutoffEnabled) {
    return null;
  }
  const risk0 = open.riskPts ?? Math.abs(open.entry - open.stop);
  if (!(risk0 > 0)) {
    return null;
  }
  const rs = CRUDE_RUPEES_PER_POINT;
  const mfe = open.peakMfePts ?? 0;
  const mae =
    open.direction === 'BUY' ? open.entry - candle.low : candle.high - open.entry;
  const against =
    open.direction === 'BUY' ? candle.close < open.entry : candle.close > open.entry;
  const conf =
    open.direction === 'BUY' ? candle.close < candle.open : candle.close > candle.open;
  if (mfe >= tradeParams.slConfirmCutoffMaxMfeR * risk0) {
    return null;
  }
  const hitFrac = mae >= tradeParams.slConfirmCutoffFracR * risk0;
  const hitSoft = tradeParams.slConfirmSoftRs > 0 && mae * rs >= tradeParams.slConfirmSoftRs;
  if ((hitFrac || hitSoft) && against && conf) {
    return { exitPrice: candle.close, reason: 'SL cutoff — confirmed adverse' };
  }
  return null;
}

function checkFuturesExit(
  candle: Candle,
  open: CrudeOpenPaper,
  tradeParams: CrudeTradeParams,
): { exitPrice: number; reason: string } | null {
  const time = extractHhMm(candle.date);
  const armed = applyCrudePeakTrail(candle, open, tradeParams);
  const soft = applyCrudeSoftCutoff(candle, open, tradeParams);
  if (soft) {
    return soft;
  }

  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) {
      return {
        exitPrice: open.stop,
        reason: armed ? 'Profit drained — cut & rehunt' : 'Stop loss hit',
      };
    }
    if (candle.high >= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  } else {
    if (candle.high >= open.stop) {
      return {
        exitPrice: open.stop,
        reason: armed ? 'Profit drained — cut & rehunt' : 'Stop loss hit',
      };
    }
    if (candle.low <= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  }

  if (time >= CRUDE_EXIT_BY) {
    return { exitPrice: candle.close, reason: `Session exit (${CRUDE_EXIT_BY})` };
  }

  return null;
}

function normalizeMinute(ts: string): string {
  return ts.replace('T', ' ').slice(0, 16);
}

/** Same-day option premium from the option's own OHLC (entry=open, exit=close). */
function lookupPremium(
  optionCandles: Candle[] | undefined,
  when: string,
  edge: 'entry' | 'exit' = 'exit',
): number | null {
  if (!optionCandles?.length) {
    return null;
  }
  const target = normalizeMinute(when);
  const targetDay = target.slice(0, 10);
  let best: Candle | null = null;
  for (const c of optionCandles) {
    const norm = normalizeMinute(c.date);
    if (norm.slice(0, 10) !== targetDay) {
      continue;
    }
    if (norm <= target) {
      best = c;
    }
  }
  if (!best) {
    return null;
  }
  return edge === 'entry' ? best.open : best.close;
}

function estimatePremiumMove(points: number): number {
  return points * 0.5;
}

let tradeSeq = 0;

function closePaperTrade(params: {
  instrumentId: string;
  instrumentName: string;
  open: CrudeOpenPaper;
  exitPrice: number;
  exitTime: string;
  exitReason: string;
  optionCandlesByToken: Map<number, Candle[]>;
  lotsMultiplier?: number;
}): PaperTrade {
  const { open } = params;
  const lots = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const indexPoints =
    open.direction === 'BUY' ? params.exitPrice - open.entry : open.entry - params.exitPrice;

  let optionExitPremium: number | null = null;
  let optionPnlRs: number | null = null;
  let premiumEstimated = open.premiumEstimated;

  if (open.option) {
    optionExitPremium = lookupPremium(
      params.optionCandlesByToken.get(open.option.instrumentToken),
      params.exitTime,
      'exit',
    );
    if (open.optionEntryPremium != null && optionExitPremium != null) {
      optionPnlRs =
        (optionExitPremium - open.optionEntryPremium) * open.option.lotSize * lots;
      premiumEstimated = false;
    } else {
      const estMove = estimatePremiumMove(indexPoints);
      const entryPx = open.optionEntryPremium ?? Math.max(10, Math.abs(estMove) + 20);
      optionExitPremium = entryPx + estMove;
      optionPnlRs = estMove * open.option.lotSize * lots;
      premiumEstimated = true;
    }
  }

  tradeSeq += 1;
  return {
    id: `crude-${tradeSeq}-${params.exitTime}`,
    instrumentId: params.instrumentId,
    instrumentName: params.instrumentName,
    direction: open.direction,
    indexEntry: open.entry,
    indexStop: open.stop,
    indexTarget: open.target,
    indexExit: params.exitPrice,
    indexPoints,
    entryTime: open.entryTime,
    exitTime: params.exitTime,
    exitReason: params.exitReason,
    option: open.option,
    optionEntryPremium: open.optionEntryPremium,
    optionExitPremium,
    optionPnlRs,
    premiumEstimated,
    outcome: indexPoints > 0 ? 'WIN' : indexPoints < 0 ? 'LOSS' : 'FLAT',
  };
}

/** Replay Crude windows (morning ORB and/or evening PDHL) on CRUDEOILM + ATM mini options. */
export function replayPaperOnCrude(params: {
  instrumentId: string;
  instrumentName: string;
  candles: Candle[];
  fromDate: string;
  toDate: string;
  instruments: Instrument[];
  optionCandlesByToken: Map<number, Candle[]>;
  neededOptionTokens: Set<number>;
  forceCloseOpen?: boolean;
  lotsMultiplier?: number;
  /** Day max loss in futures pts (default from profile). */
  dayLossStopPts?: number;
  /** Morning ORB 10:00–12:00. Default true. */
  enableMorning?: boolean;
  /** Evening PDHL 18:30–20:30. Default true. */
  enableEvening?: boolean;
  /** Strategy profile (default daily-profit Trap-style). */
  tradeParams?: CrudeTradeParams;
  /** ATM option resolve overrides (Nat Gas Mini under Experiments). */
  optionPrefixes?: string[];
  strikeStep?: number;
  syntheticName?: string;
}): CrudeReplayResult {
  const {
    instrumentId,
    instrumentName,
    candles,
    fromDate,
    toDate,
    instruments,
    optionCandlesByToken,
    neededOptionTokens,
  } = params;
  const forceCloseOpen = params.forceCloseOpen !== false;
  const lotsMultiplier = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const tradeParams = params.tradeParams ?? resolveCrudeStrategyProfile('all-green');
  const dayLossStopPts = params.dayLossStopPts ?? tradeParams.dayLossStopPts;
  const dayProfitLockPts = tradeParams.dayProfitLockPts;
  const optionResolve = {
    prefixes: params.optionPrefixes,
    strikeStep: params.strikeStep,
    syntheticName: params.syntheticName,
  };
  const enableMorning = params.enableMorning !== false;
  const enableEvening = params.enableEvening !== false;
  const trapMode = tradeParams.entryMode === 'trap-confirm';
  const sessionOrMode = tradeParams.entryMode === 'session-or';

  const state = trapMode ? createCrudeTrapState() : createCrudePdhlState();
  const trades: PaperTrade[] = [];
  const dayNetByDate: Record<string, number> = {};
  let open: CrudeOpenPaper | null = null;
  let lastSignal = 'Waiting';
  let chosenOption: PaperOptionContract | null = null;
  let chosenBias: 'BUY' | 'SELL' | null = null;
  let indexSpot: number | null = null;
  let chosenAsOf: string | null = null;

  for (let i = 40; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const day = extractTradeDate(candle.date);
    if (day < fromDate || day > toDate) {
      continue;
    }

    if (open) {
      const exit = checkFuturesExit(candle, open, tradeParams);
      if (exit) {
        const bookLabel =
          open.book === 'morning'
            ? 'Morning'
            : sessionOrMode
              ? 'Afternoon'
              : open.book === 'evening'
                ? 'Evening'
                : 'Trap';
        const closed = closePaperTrade({
          instrumentId,
          instrumentName,
          open,
          exitPrice: exit.exitPrice,
          exitTime: candle.date,
          exitReason: `${exit.reason} · ${bookLabel}`,
          optionCandlesByToken,
          lotsMultiplier,
        });
        trades.push(closed);
        recordCrudeTradeClosed(
          state,
          closed.indexPoints,
          dayLossStopPts,
          open.book,
          dayProfitLockPts,
          tradeParams.firstWinLock,
        );
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }

    let signal: ReturnType<typeof runCrudeMorningOrb> | null = null;
    let book: CrudeSessionBook = 'morning';

    if (trapMode) {
      const trap = runCrudeTrapConfirm({
        candle,
        series: candles,
        state: state as CrudeTrapState,
        dayLossStopPts,
        dayProfitLockPts,
        targetRMultiple: tradeParams.targetRMultiple || undefined,
      });
      if (trap.action === 'BUY' || trap.action === 'SELL') {
        signal = trap;
        book = 'evening';
      } else {
        lastSignal = trap.reason;
      }
    } else if (sessionOrMode) {
      if (enableEvening) {
        const afternoon = runCrudeSessionOr({
          candle,
          series: candles,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.eveningTargetPts,
          requireConfirm: tradeParams.requireConfirm,
          firstWinLock: tradeParams.firstWinLock,
          entryStart: tradeParams.eveningEntryStart,
          entryEnd: tradeParams.eveningEntryEnd,
          orStart: tradeParams.sessionOrStart,
          orEnd: tradeParams.sessionOrEnd,
          maxOrWidth: tradeParams.maxOrWidth,
          maxTradesDay: tradeParams.maxEveningTradesDay,
        });
        if (afternoon.action === 'BUY' || afternoon.action === 'SELL') {
          signal = afternoon;
          book = 'evening';
        } else {
          lastSignal = afternoon.reason;
        }
      }
    } else {
      if (enableMorning) {
        const morning = runCrudeMorningOrb({
          candle,
          series: candles,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.morningTargetPts,
        });
        if (morning.action === 'BUY' || morning.action === 'SELL') {
          signal = morning;
          book = 'morning';
        } else {
          lastSignal = morning.reason;
        }
      }

      if (!signal && enableEvening) {
        const evening = runCrudePdhlEvening({
          candle,
          series: candles,
          index: i,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.eveningTargetPts,
          requireConfirm: tradeParams.requireConfirm,
          entryStart: tradeParams.eveningEntryStart,
          entryEnd: tradeParams.eveningEntryEnd,
          maxTradesDay: tradeParams.maxEveningTradesDay,
        });
        if (evening.action === 'BUY' || evening.action === 'SELL') {
          signal = evening;
          book = 'evening';
        } else {
          lastSignal = evening.reason;
        }
      }
    }

    if (!enableMorning && !enableEvening) {
      lastSignal = 'No session window on';
    }

    if (!signal || (signal.action !== 'BUY' && signal.action !== 'SELL')) {
      continue;
    }

    const resolved = resolveAtmCrudeMiniOption({
      instruments,
      direction: signal.action,
      spot: candle.close,
      asOfDateTime: candle.date,
      ...optionResolve,
    });
    const option = toCrudePaperOption(resolved.instrument, resolved.source);
    chosenOption = option;
    chosenBias = signal.action;
    indexSpot = candle.close;
    chosenAsOf = candle.date;

    if (option.instrumentToken > 0) {
      neededOptionTokens.add(option.instrumentToken);
    }

    const entryPremium = lookupPremium(
      optionCandlesByToken.get(option.instrumentToken),
      candle.date,
      'entry',
    );

    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: candle.date,
      book,
      option,
      optionEntryPremium: entryPremium,
      premiumEstimated: entryPremium == null,
      peakMfePts: 0,
      riskPts: Math.abs(signal.entryPrice - signal.stopLoss),
    };
    lastSignal = `${signal.action} @ ${signal.entryPrice.toFixed(1)} · ${option.tradingSymbol}`;
  }

  if (open && forceCloseOpen) {
    const last = candles.at(-1)!;
    const closed = closePaperTrade({
      instrumentId,
      instrumentName,
      open,
      exitPrice: last.close,
      exitTime: last.date,
      exitReason: `${MCX_CRUDE_SESSION.sessionCloseLabel} · ${
        open.book === 'morning'
          ? 'Morning 10:00–12:00'
          : sessionOrMode
            ? `${tradeParams.eveningEntryStart}–${tradeParams.eveningEntryEnd}`
            : 'Evening 18:30–20:30'
      }`,
      optionCandlesByToken,
      lotsMultiplier,
    });
    trades.push(closed);
    recordCrudeTradeClosed(
      state,
      closed.indexPoints,
      dayLossStopPts,
      open.book,
      dayProfitLockPts,
      tradeParams.firstWinLock,
    );
    dayNetByDate[extractTradeDate(last.date)] =
      (dayNetByDate[extractTradeDate(last.date)] ?? 0) + closed.indexPoints;
    open = null;
    lastSignal = `Closed: ${MCX_CRUDE_SESSION.sessionCloseLabel}`;
  }

  // Still open → that contract is the live choice
  if (open?.option) {
    chosenOption = open.option;
    chosenBias = open.direction;
    indexSpot = open.entry;
    chosenAsOf = open.entryTime;
  } else if (!chosenOption) {
    // No signal yet — preview ATM CE/PE from last in-range futures bar (same idea as Nifty desk)
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i]!.date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx < 0 && candles.length) {
      lastIdx = candles.length - 1;
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx]!;
      const bias: 'BUY' | 'SELL' = 'BUY';
      const resolved = resolveAtmCrudeMiniOption({
        instruments,
        direction: bias,
        spot: candle.close,
        asOfDateTime: candle.date,
        ...optionResolve,
      });
      chosenOption = toCrudePaperOption(resolved.instrument, resolved.source);
      chosenBias = bias;
      indexSpot = candle.close;
      chosenAsOf = candle.date;
      if (resolved.source === 'chain' && resolved.instrument.instrumentToken > 0) {
        neededOptionTokens.add(resolved.instrument.instrumentToken);
      }
    }
  } else if (trades.length) {
    const last = trades.at(-1)!;
    if (last.option) {
      chosenOption = last.option;
      chosenBias = last.direction;
      indexSpot = last.indexEntry;
      chosenAsOf = last.entryTime;
    }
  }

  return {
    instrumentId,
    instrumentName,
    trades,
    dayNetByDate,
    lastSignal,
    open,
    state,
    chosenOption,
    chosenBias,
    indexSpot,
    chosenAsOf,
  };
}

export function enrichCrudeTradesWithOptionPremiums(
  trades: PaperTrade[],
  optionCandlesByToken: Map<number, Candle[]>,
  lotsMultiplier: number = 1,
): PaperTrade[] {
  const lots = Math.max(1, Math.floor(lotsMultiplier) || 1);
  return trades.map((t) => {
    if (!t.option) {
      return t;
    }
    const entry =
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.entryTime, 'entry') ??
      t.optionEntryPremium;
    const exit =
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.exitTime, 'exit') ??
      t.optionExitPremium;
    if (entry != null && exit != null) {
      return {
        ...t,
        optionEntryPremium: entry,
        optionExitPremium: exit,
        optionPnlRs: (exit - entry) * t.option.lotSize * lots,
        premiumEstimated: false,
      };
    }
    const estMove = estimatePremiumMove(t.indexPoints);
    const entryPx = entry ?? Math.max(10, Math.abs(estMove) + 20);
    const exitPx = exit ?? entryPx + estMove;
    return {
      ...t,
      optionEntryPremium: entryPx,
      optionExitPremium: exitPx,
      optionPnlRs: (exitPx - entryPx) * t.option.lotSize * lots,
      premiumEstimated: true,
    };
  });
}
