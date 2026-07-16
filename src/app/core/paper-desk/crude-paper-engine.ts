import { Candle } from '../models/candle.model';
import { Instrument } from '../models/instrument.model';
import { MCX_CRUDE_SESSION } from '../config/session.config';
import { extractTradeDate } from '../utils/trade-date.util';
import { extractHhMm } from '../strategy-engine/utils/market-session.util';
import {
  CRUDE_EXIT_BY,
  createCrudePdhlState,
  CrudePdhlState,
  recordCrudeTradeClosed,
  runCrudePdhlEvening,
} from '../strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
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
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
  premiumEstimated: boolean;
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

function checkFuturesExit(
  candle: Candle,
  open: CrudeOpenPaper,
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

  if (time >= CRUDE_EXIT_BY) {
    return { exitPrice: candle.close, reason: `Session exit (${CRUDE_EXIT_BY})` };
  }

  return null;
}

function lookupPremium(optionCandles: Candle[] | undefined, when: string): number | null {
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

/** Replay champion PDHL evening strategy on CRUDEOILM + ATM mini options. */
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

  const state = createCrudePdhlState();
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
      const exit = checkFuturesExit(candle, open);
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
        recordCrudeTradeClosed(state, closed.indexPoints);
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }

    const signal = runCrudePdhlEvening({
      candle,
      series: candles,
      index: i,
      state,
    });
    lastSignal = signal.reason;

    if (signal.action !== 'BUY' && signal.action !== 'SELL') {
      continue;
    }

    const resolved = resolveAtmCrudeMiniOption({
      instruments,
      direction: signal.action,
      spot: candle.close,
      asOfDateTime: candle.date,
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
    );

    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: candle.date,
      option,
      optionEntryPremium: entryPremium,
      premiumEstimated: entryPremium == null,
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
      exitReason: MCX_CRUDE_SESSION.sessionCloseLabel,
      optionCandlesByToken,
      lotsMultiplier,
    });
    trades.push(closed);
    recordCrudeTradeClosed(state, closed.indexPoints);
    dayNetByDate[extractTradeDate(last.date)] =
      (dayNetByDate[extractTradeDate(last.date)] ?? 0) + closed.indexPoints;
    open = null;
    lastSignal = `Closed: ${MCX_CRUDE_SESSION.sessionCloseLabel}`;
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
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.entryTime) ??
      t.optionEntryPremium;
    const exit =
      lookupPremium(optionCandlesByToken.get(t.option.instrumentToken), t.exitTime) ??
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
