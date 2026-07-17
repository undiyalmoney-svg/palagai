import { Candle } from '../models/candle.model';
import { Instrument } from '../models/instrument.model';
import { NSE_SESSION } from '../config/session.config';
import { extractTradeDate } from '../utils/trade-date.util';
import { extractHhMm } from '../strategy-engine/utils/market-session.util';
import { StrategyContext } from '../strategy-engine/models/strategy-context.model';
import {
  createPdhlOrState,
  emaLast,
  mergePdhlOrParams,
  PDHL_EMA_EXIT_PERIOD,
  PdhlOrParams,
  PdhlOrState,
  recordPdhlTradeClosed,
  runPdhlOpeningRange,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import {
  IndexOptionKind,
  resolveAtmWeeklyOption,
} from '../utils/option-chain.util';
import {
  PaperOptionContract,
  PaperTrade,
} from './paper-desk.models';

export interface IndexOpenPaper {
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  entryTime: string;
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
  premiumEstimated: boolean;
}

export interface ReplayInstrumentResult {
  instrumentId: string;
  instrumentName: string;
  kind: IndexOptionKind;
  trades: PaperTrade[];
  dayNetByDate: Record<string, number>;
  lastSignal: string;
  open: IndexOpenPaper | null;
  state: PdhlOrState;
  chosenOption: PaperOptionContract | null;
  chosenBias: 'BUY' | 'SELL' | null;
  indexSpot: number | null;
  chosenAsOf: string | null;
}

function stubCandle(from: Candle): Candle {
  return { ...from };
}

function buildContext(
  candles: Candle[],
  index: number,
  instrumentId: string,
): StrategyContext {
  const candle5m = candles[index]!;
  return {
    candle60m: stubCandle(candle5m),
    candle30m: stubCandle(candle5m),
    candle15m: stubCandle(candle5m),
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(0, index),
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candles.at(-1)?.date ?? candle5m.date,
    session: NSE_SESSION,
    instrumentId,
    series5m: candles,
  };
}

function checkIndexExit(
  candle: Candle,
  open: IndexOpenPaper,
  closesForEma: number[],
): { exitPrice: number; reason: string } | null {
  const time = extractHhMm(candle.date);

  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
    }
    if (candle.high >= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  } else {
    if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
    }
    if (candle.low <= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  }

  const ema20 = emaLast(closesForEma, PDHL_EMA_EXIT_PERIOD);
  if (ema20 != null) {
    if (open.direction === 'BUY' && candle.close < ema20) {
      return { exitPrice: candle.close, reason: 'EMA-20 exit' };
    }
    if (open.direction === 'SELL' && candle.close > ema20) {
      return { exitPrice: candle.close, reason: 'EMA-20 exit' };
    }
  }

  if (time >= NSE_SESSION.sessionCloseCandle) {
    return { exitPrice: candle.close, reason: NSE_SESSION.sessionCloseLabel };
  }

  return null;
}

function toOptionContract(
  opt: Instrument,
  source: 'chain' | 'synthetic' = 'chain',
): PaperOptionContract {
  return {
    tradingSymbol: opt.tradingSymbol,
    instrumentToken: opt.instrumentToken,
    strike: opt.strike,
    expiry: opt.expiry,
    optionType: opt.instrumentType === 'PE' ? 'PE' : 'CE',
    lotSize: opt.lotSize > 0 ? opt.lotSize : 1,
    source,
  };
}

function lookupPremium(
  optionCandles: Candle[] | undefined,
  when: string,
): number | null {
  if (!optionCandles?.length) {
    return null;
  }
  const target = when.slice(0, 16);
  let best: Candle | null = null;
  for (const c of optionCandles) {
    if (c.date.slice(0, 16) <= target) {
      best = c;
    }
  }
  return best?.close ?? null;
}

function estimatePremiumMove(indexPoints: number): number {
  // Rough ATM delta ≈ 0.5 for paper fallback when option OHLC missing
  return indexPoints * 0.5;
}

let tradeSeq = 0;

function closePaperTrade(params: {
  instrumentId: string;
  instrumentName: string;
  open: IndexOpenPaper;
  exitPrice: number;
  exitTime: string;
  exitReason: string;
  optionCandlesByToken: Map<number, Candle[]>;
  /** Exchange lot × this (Testing + Live paper + Live money P&L). */
  lotsMultiplier?: number;
}): PaperTrade {
  const { open } = params;
  const lots = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const indexPoints =
    open.direction === 'BUY'
      ? params.exitPrice - open.entry
      : open.entry - params.exitPrice;

  let optionExitPremium: number | null = null;
  let optionPnlRs: number | null = null;
  let premiumEstimated = open.premiumEstimated;

  if (open.option) {
    optionExitPremium = lookupPremium(
      params.optionCandlesByToken.get(open.option.instrumentToken),
      params.exitTime,
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
    id: `pt-${tradeSeq}-${params.exitTime}`,
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

/**
 * Replay OR Swing Breakout on index candles (HT-compatible), attach ATM weekly options.
 */
export function replayPaperOnIndex(params: {
  instrumentId: string;
  instrumentName: string;
  kind: IndexOptionKind;
  candles: Candle[];
  /** Inclusive replay window YYYY-MM-DD */
  fromDate: string;
  toDate: string;
  instruments: Instrument[];
  optionCandlesByToken: Map<number, Candle[]>;
  /** Tokens we still need option history for (filled during entry). */
  neededOptionTokens: Set<number>;
  /** When false (live mid-session), leave open trades open. */
  forceCloseOpen?: boolean;
  /** Exchange lot × this for option ₹ P&L. */
  lotsMultiplier?: number;
  /** Optional Trade Desk day loss / profit lock overrides. */
  pdhlOverrides?: Partial<PdhlOrParams> | null;
}): ReplayInstrumentResult {
  const {
    instrumentId,
    instrumentName,
    kind,
    candles,
    fromDate,
    toDate,
    instruments,
    optionCandlesByToken,
    neededOptionTokens,
  } = params;
  const forceCloseOpen = params.forceCloseOpen !== false;
  const lotsMultiplier = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const pdhlParams = mergePdhlOrParams(instrumentId, params.pdhlOverrides);

  const state = createPdhlOrState();
  const trades: PaperTrade[] = [];
  const dayNetByDate: Record<string, number> = {};
  let open: IndexOpenPaper | null = null;
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

    const closes = candles.slice(0, i + 1).map((c) => c.close);

    if (open) {
      const exit = checkIndexExit(candle, open, closes);
      if (exit) {
        const closed = closePaperTrade({
          instrumentId,
          instrumentName,
          open,
          exitPrice: exit.exitPrice,
          exitTime: candle.date,
          exitReason: exit.reason,
          optionCandlesByToken,
          lotsMultiplier,
        });
        trades.push(closed);
        recordPdhlTradeClosed(state, closed.indexPoints, pdhlParams);
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }

    const ctx = buildContext(candles, i, instrumentId);
    const signal = runPdhlOpeningRange(ctx, state, pdhlParams);
    lastSignal = signal.reason;

    if (signal.action !== 'BUY' && signal.action !== 'SELL') {
      continue;
    }

    const resolved = resolveAtmWeeklyOption({
      instruments,
      kind,
      direction: signal.action,
      spot: signal.entryPrice,
      asOfDateTime: candle.date,
    });

    const option = toOptionContract(resolved.instrument, resolved.source);
    if (resolved.source === 'chain' && resolved.instrument.instrumentToken > 0) {
      neededOptionTokens.add(resolved.instrument.instrumentToken);
    }
    let optionEntryPremium: number | null = null;
    let premiumEstimated = resolved.source === 'synthetic';

    if (resolved.source === 'chain') {
      optionEntryPremium = lookupPremium(
        optionCandlesByToken.get(resolved.instrument.instrumentToken),
        candle.date,
      );
      if (optionEntryPremium == null) {
        premiumEstimated = true;
      }
    }

    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: candle.date,
      option,
      optionEntryPremium,
      premiumEstimated,
    };
    chosenOption = option;
    chosenBias = signal.action;
    indexSpot = signal.entryPrice;
    chosenAsOf = candle.date;
    lastSignal = `${signal.action} @ ${signal.entryPrice.toFixed(1)}`;
  }

  // Force close any open trade at last in-range bar (same as HT end-of-range)
  if (forceCloseOpen && open) {
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i]!.date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx]!;
      const day = extractTradeDate(candle.date);
      const closed = closePaperTrade({
        instrumentId,
        instrumentName,
        open,
        exitPrice: candle.close,
        exitTime: candle.date,
        exitReason: 'End of range',
        optionCandlesByToken,
        lotsMultiplier,
      });
      trades.push(closed);
      recordPdhlTradeClosed(state, closed.indexPoints, pdhlParams);
      dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
      if (closed.option) {
        chosenOption = closed.option;
        chosenBias = closed.direction;
        indexSpot = closed.indexEntry;
        chosenAsOf = closed.entryTime;
      }
      open = null;
      lastSignal = 'Closed: End of range';
    }
  }

  // If still open, that contract is the live choice
  if (open?.option) {
    chosenOption = open.option;
    chosenBias = open.direction;
    indexSpot = open.entry;
    chosenAsOf = open.entryTime;
  } else if (!chosenOption) {
    // No trade yet — show ATM for current OR bias at last in-range bar
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i]!.date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx]!;
      const dayBars = candles.filter((c) => extractTradeDate(c.date) === extractTradeDate(candle.date));
      const orBars = dayBars.filter((c) => {
        const t = extractHhMm(c.date);
        return t >= NSE_SESSION.marketOpen && t < NSE_SESSION.firstHourEnd;
      });
      if (orBars.length) {
        const orHigh = Math.max(...orBars.map((b) => b.high));
        const orLow = Math.min(...orBars.map((b) => b.low));
        const mid = (orHigh + orLow) / 2;
        const bias: 'BUY' | 'SELL' = candle.close >= mid ? 'BUY' : 'SELL';
        const resolved = resolveAtmWeeklyOption({
          instruments,
          kind,
          direction: bias,
          spot: candle.close,
          asOfDateTime: candle.date,
        });
        chosenOption = toOptionContract(resolved.instrument, resolved.source);
        chosenBias = bias;
        indexSpot = candle.close;
        chosenAsOf = candle.date;
        if (resolved.source === 'chain' && resolved.instrument.instrumentToken > 0) {
          neededOptionTokens.add(resolved.instrument.instrumentToken);
        }
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
    kind,
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

/** Second pass: fill premiums once option candles are loaded. */
export function enrichTradesWithOptionPremiums(
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
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.entryTime) ??
      t.optionEntryPremium;
    const exit =
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.exitTime) ??
      t.optionExitPremium;

    if (entry != null && exit != null) {
      const optionPnlRs = (exit - entry) * t.option.lotSize * lots;
      return {
        ...t,
        optionEntryPremium: entry,
        optionExitPremium: exit,
        optionPnlRs,
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

export { buildContext, checkIndexExit, toOptionContract, lookupPremium };
