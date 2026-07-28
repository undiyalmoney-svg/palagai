import { Candle } from '../models/candle.model';
import { Instrument } from '../models/instrument.model';
import { NSE_SESSION } from '../config/session.config';
import { extractTradeDate } from '../utils/trade-date.util';
import { extractHhMm } from '../strategy-engine/utils/market-session.util';
import { StrategyContext } from '../strategy-engine/models/strategy-context.model';
import {
  emaLast,
  PDHL_EMA_EXIT_PERIOD,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import {
  IndexOptionKind,
  resolveAtmWeeklyOption,
} from '../utils/option-chain.util';
import {
  PaperOptionContract,
  PaperTrade,
} from './paper-desk.models';
import { applyChargesToOptionTrade } from './trade-charges.util';
import {
  IManagedStrategy,
  ManagedOpenPosition,
} from '../strategy-manager/models/strategy-module.interface';
import { ChampionPdhlManagedStrategy } from '../strategy-manager/modules/champion-pdhl.managed-strategy';
import { rupeesPerPointForInstrument } from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import {
  KUTTY_ID,
  KUTTY_MARGIN_PER_TRADE_RS,
  KUTTY_NAME,
  canOpenKutty,
  createKuttyDayState,
  kuttyExitLogic,
  recordKuttyClosed,
  runKuttyScalp,
  trapOwnsBar,
} from '../strategy-manager/engines/kutty-scalp.engine';

/** Tighter of hard stop and swing trail — for live SL-M / UI (paper exit keeps them separate). */
export function effectiveProtectiveStop(open: {
  direction: 'BUY' | 'SELL';
  stop: number;
  trail?: number | null;
}): number {
  const trail = open.trail;
  if (trail == null || !Number.isFinite(trail)) {
    return open.stop;
  }
  return open.direction === 'BUY'
    ? Math.max(open.stop, trail)
    : Math.min(open.stop, trail);
}

export interface IndexOpenPaper {
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  entryTime: string;
  /** Research swing_trail separate trail level. */
  trail?: number | null;
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
  premiumEstimated: boolean;
  /** Which option OHLC side matched the strategy index fill. */
  optionEntryEdge?: 'open' | 'close';
  /** Running max favorable excursion (index pts). */
  mfeIndexPts?: number;
  /** Running max adverse excursion (index pts, ≥ 0). */
  maeIndexPts?: number;
  entryReason?: string;
  timeline?: Array<{ at: string; event: string; detail?: string }>;
  /** primary = Strat; kutty = background scalp (never counts as Trap day trade). */
  source?: 'primary' | 'kutty';
}

export interface ReplayInstrumentResult {
  instrumentId: string;
  instrumentName: string;
  kind: IndexOptionKind;
  trades: PaperTrade[];
  dayNetByDate: Record<string, number>;
  lastSignal: string;
  open: IndexOpenPaper | null;
  strategyId: string;
  strategyName: string;
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
  // Causal only: never expose bars after `index` (fixes swing look-ahead).
  const causal = candles.slice(0, index + 1);
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
    replayTo: candle5m.date,
    session: NSE_SESSION,
    instrumentId,
    series5m: causal,
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

/**
 * Normalize a timestamp for minute-level comparison:
 * strip 'T' vs space and timezone suffix → "YYYY-MM-DD HH:mm".
 * Both index and option candles use Kite `row[0]`, but this keeps the
 * lookup robust if a source ever differs.
 */
function normalizeMinute(ts: string): string {
  return ts.replace('T', ' ').slice(0, 16);
}

/**
 * Option premium from the option's OWN 5m OHLC at a given time.
 *
 * `edge`:
 *   'open'  → OPEN of the bar covering `when` (Trap next-bar open fill)
 *   'close' → CLOSE of the bar covering `when` (Genie / EOD / exit fill)
 *
 * Only matches bars on the SAME trading day as `when`, so a missing option
 * history never silently borrows a stale prior-day price.
 */
export function lookupPremium(
  optionCandles: Candle[] | undefined,
  when: string,
  edge: 'open' | 'close' = 'close',
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
  return edge === 'open' ? best.open : best.close;
}

/** Prefer the OHLC side that matches the strategy's index fill price. */
export function entryPremiumEdge(
  entryPrice: number,
  candle: Pick<Candle, 'open' | 'close'>,
): 'open' | 'close' {
  const dOpen = Math.abs(entryPrice - candle.open);
  const dClose = Math.abs(entryPrice - candle.close);
  return dOpen <= dClose ? 'open' : 'close';
}

function isLevelExitReason(reason: string): boolean {
  const r = reason.toLowerCase();
  // Word-boundary only — bare includes('sl') is too greedy.
  return (
    /\bstop\b/.test(r) ||
    /\btarget\b/.test(r) ||
    /\bsl\b/.test(r) ||
    r.includes('stop loss') ||
    r.includes('trail / stop')
  );
}

/**
 * When option OHLC is missing/unreliable, option ₹ MUST equal index ₹ proxy
 * (pts × Nifty65/Bank30 × lots). Old 0.5δ × lotSize diverged in sign on Nifty+Bank mixes.
 */
export function applyEstimatedOptionPnl(params: {
  indexPoints: number;
  entryPremium: number | null;
  lotSize: number;
  lots: number;
  instrumentId?: string | null;
}): { entry: number; exit: number; pnl: number } {
  const lots = Math.max(1, Math.floor(params.lots) || 1);
  const rpp = rupeesPerPointForInstrument(params.instrumentId);
  // Keep lotSize as fallback when instrument id unknown (crude etc.).
  const moneyPerPt =
    params.instrumentId != null && String(params.instrumentId).length > 0
      ? rpp
      : params.lotSize > 0
        ? params.lotSize
        : rpp;
  const pnl = params.indexPoints * moneyPerPt * lots;
  const estMove = moneyPerPt !== 0 ? pnl / (moneyPerPt * lots) : 0; // = indexPoints
  // Synthetic premiums for UI only — money comes from pnl above.
  const premiumMove = estMove * 0.5;
  const entry = params.entryPremium ?? Math.max(10, Math.abs(premiumMove) + 20);
  const exit = entry + premiumMove;
  return { entry, exit, pnl };
}

/**
 * Single source of truth for long-option money (Kite Positions style):
 *   (exitPremium − entryPremium) × lotSize × lots
 * e.g. (82 − 72) × 65 × 1 = 650.
 */
export function computeOptionPnl(params: {
  entryPremium: number;
  exitPremium: number;
  lotSize: number;
  lots: number;
}): number {
  const lots = Math.max(1, Math.floor(params.lots) || 1);
  const lotSize = params.lotSize > 0 ? params.lotSize : 1;
  return (params.exitPremium - params.entryPremium) * lotSize * lots;
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
  strategyId?: string;
  strategyName?: string;
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
  let optionEntryPremium = open.optionEntryPremium;

  if (open.option) {
    const useEstimate =
      open.option.source === 'synthetic' ||
      open.option.instrumentToken <= 0 ||
      open.premiumEstimated ||
      isLevelExitReason(params.exitReason);

    if (!useEstimate) {
      optionExitPremium = lookupPremium(
        params.optionCandlesByToken.get(open.option.instrumentToken),
        params.exitTime,
        'close',
      );
    }

    if (
      !useEstimate &&
      optionEntryPremium != null &&
      optionExitPremium != null
    ) {
      optionPnlRs = computeOptionPnl({
        entryPremium: optionEntryPremium,
        exitPremium: optionExitPremium,
        lotSize: open.option.lotSize,
        lots,
      });
      premiumEstimated = false;
    } else {
      const est = applyEstimatedOptionPnl({
        indexPoints,
        entryPremium: optionEntryPremium,
        lotSize: open.option.lotSize,
        lots,
        instrumentId: params.instrumentId,
      });
      optionEntryPremium = est.entry;
      optionExitPremium = est.exit;
      optionPnlRs = est.pnl;
      premiumEstimated = true;
    }
  }

  tradeSeq += 1;
  const qty =
    open.option != null
      ? Math.max(1, open.option.lotSize || 1) * lots
      : 0;
  let chargesRs: number | null = null;
  let netOptionPnlRs: number | null = null;
  if (optionPnlRs != null && optionEntryPremium != null && optionExitPremium != null && qty > 0) {
    const charged = applyChargesToOptionTrade({
      entryPremium: optionEntryPremium,
      exitPremium: optionExitPremium,
      quantity: qty,
      segment: open.option?.exchange === 'MCX' ? 'mcx_option' : 'nfo_option',
      grossPnlRs: optionPnlRs,
    });
    chargesRs = charged.chargesRs;
    netOptionPnlRs = charged.netPnlRs;
  }

  const moneyOutcome: PaperTrade['moneyOutcome'] =
    optionPnlRs == null
      ? undefined
      : optionPnlRs > 0
        ? 'WIN'
        : optionPnlRs < 0
          ? 'LOSS'
          : 'FLAT';

  const timeline = [
    ...(open.timeline ?? []),
    {
      at: params.exitTime,
      event: 'EXIT',
      detail: `${params.exitReason} @ ${params.exitPrice.toFixed(2)}`,
    },
  ];

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
    optionEntryPremium,
    optionExitPremium,
    optionPnlRs,
    premiumEstimated,
    optionEntryEdge: open.optionEntryEdge,
    outcome: indexPoints > 0 ? 'WIN' : indexPoints < 0 ? 'LOSS' : 'FLAT',
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    mfeIndexPts: open.mfeIndexPts ?? 0,
    maeIndexPts: open.maeIndexPts ?? 0,
    chargesRs,
    netOptionPnlRs,
    moneyOutcome,
    timeline,
    entryReason: open.entryReason,
  };
}

/**
 * Replay selected managed strategy on index candles; attach ATM weekly options.
 * Strategy modules own entry + exit logic — engine stays strategy-agnostic.
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
  /**
   * Active strategy module (from Strategy Manager).
   * When omitted, falls back to Champion PDHL so existing callers stay safe.
   */
  strategy?: IManagedStrategy;
  /**
   * Background Kutty scalp (default on). Never registered in Strat UI.
   * Skips when Trap owns the bar / margin reserve fails.
   */
  enableKutty?: boolean;
  /** Shared margin ledger across Nifty+Bank legs (mutated in place). */
  kuttyMargin?: { usedRs: number; trapOpenLegs: number };
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
  const enableKutty = params.enableKutty !== false;
  const kuttyMargin = params.kuttyMargin ?? { usedRs: 0, trapOpenLegs: 0 };
  const kuttyState = createKuttyDayState();

  const strategy =
    params.strategy ??
    (() => {
      const fallback = new ChampionPdhlManagedStrategy();
      fallback.initialize();
      return fallback;
    })();
  strategy.reset();

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
    const ctx = buildContext(candles, i, instrumentId);

    if (open) {
      // Track MFE/MAE on every bar while open (audit / giveback analysis).
      const fav =
        open.direction === 'BUY' ? candle.high - open.entry : open.entry - candle.low;
      const adv =
        open.direction === 'BUY' ? open.entry - candle.low : candle.high - open.entry;
      open.mfeIndexPts = Math.max(open.mfeIndexPts ?? 0, Math.max(0, fav));
      open.maeIndexPts = Math.max(open.maeIndexPts ?? 0, Math.max(0, adv));

      const isKutty = open.source === 'kutty';
      let exit = null as ReturnType<typeof kuttyExitLogic>;
      if (isKutty) {
        exit = kuttyExitLogic(candle, open);
      } else {
        const managedOpen: ManagedOpenPosition = {
          direction: open.direction,
          entry: open.entry,
          stop: open.stop,
          target: open.target,
          entryTime: open.entryTime,
          trail: open.trail ?? null,
        };
        exit = strategy.exitLogic(candle, managedOpen, closes, ctx);
        // Profit-protect may ratchet stop; swing_trail updates separate trail.
        if (managedOpen.stop !== open.stop) {
          open.timeline = [
            ...(open.timeline ?? []),
            {
              at: candle.date,
              event: 'STOP_MOVED',
              detail: `SL ${open.stop.toFixed(2)} → ${managedOpen.stop.toFixed(2)}`,
            },
          ];
          open.stop = managedOpen.stop;
        }
        if (managedOpen.trail !== open.trail) {
          open.trail = managedOpen.trail ?? null;
        }
      }
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
          strategyId: isKutty ? KUTTY_ID : strategy.id,
          strategyName: isKutty ? KUTTY_NAME : strategy.name,
        });
        trades.push(closed);
        if (isKutty) {
          recordKuttyClosed(kuttyState);
          kuttyMargin.usedRs = Math.max(0, kuttyMargin.usedRs - KUTTY_MARGIN_PER_TRADE_RS);
        } else {
          strategy.onTradeClosed?.(closed.indexPoints, day);
          kuttyMargin.trapOpenLegs = Math.max(0, kuttyMargin.trapOpenLegs - 1);
        }
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }

    const signal = strategy.generateSignal(ctx);
    lastSignal = signal.reason;

    let entryAction = signal.action;
    let entryPrice = signal.entryPrice;
    let entryStop = signal.stopLoss;
    let entryTarget = signal.target;
    let entryReason = signal.reason;
    let entrySource: 'primary' | 'kutty' = 'primary';
    let entryStrategyId = strategy.id;
    let entryStrategyName = strategy.name;

    if (entryAction !== 'BUY' && entryAction !== 'SELL') {
      // Background Kutty — only when Trap/primary does not own the bar.
      if (
        enableKutty &&
        !trapOwnsBar(signal.reason) &&
        canOpenKutty({
          usedMarginRs: kuttyMargin.usedRs,
          trapOpenAnywhere: kuttyMargin.trapOpenLegs > 0,
        })
      ) {
        const kSig = runKuttyScalp(ctx, kuttyState, kind);
        if (kSig.action === 'BUY' || kSig.action === 'SELL') {
          entryAction = kSig.action;
          entryPrice = kSig.entryPrice;
          entryStop = kSig.stopLoss;
          entryTarget = kSig.target;
          entryReason = kSig.reason;
          entrySource = 'kutty';
          entryStrategyId = KUTTY_ID;
          entryStrategyName = KUTTY_NAME;
          lastSignal = kSig.reason;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    const resolved = resolveAtmWeeklyOption({
      instruments,
      kind,
      direction: entryAction,
      spot: entryPrice,
      asOfDateTime: candle.date,
    });

    const option = toOptionContract(resolved.instrument, resolved.source);
    if (resolved.source === 'chain' && resolved.instrument.instrumentToken > 0) {
      neededOptionTokens.add(resolved.instrument.instrumentToken);
    }
    const fillEdge = entryPremiumEdge(entryPrice, candle);
    let optionEntryPremium: number | null = null;
    let premiumEstimated = resolved.source === 'synthetic';

    if (resolved.source === 'chain') {
      optionEntryPremium = lookupPremium(
        optionCandlesByToken.get(resolved.instrument.instrumentToken),
        candle.date,
        fillEdge,
      );
      if (optionEntryPremium == null) {
        premiumEstimated = true;
      }
    }

    open = {
      direction: entryAction,
      entry: entryPrice,
      stop: entryStop,
      target: entryTarget,
      entryTime: candle.date,
      trail: null,
      option,
      optionEntryPremium,
      premiumEstimated,
      optionEntryEdge: fillEdge,
      mfeIndexPts: 0,
      maeIndexPts: 0,
      entryReason,
      source: entrySource,
      timeline: [
        {
          at: candle.date,
          event: 'ENTRY',
          detail: `${entryAction} @ ${entryPrice.toFixed(2)} · SL ${entryStop.toFixed(2)} · T ${entryTarget.toFixed(2)} · ${entryReason}`,
        },
      ],
    };
    if (entrySource === 'kutty') {
      kuttyMargin.usedRs += KUTTY_MARGIN_PER_TRADE_RS;
    } else {
      kuttyMargin.trapOpenLegs += 1;
    }
    chosenOption = option;
    chosenBias = entryAction;
    indexSpot = entryPrice;
    chosenAsOf = candle.date;
    lastSignal = `${entryAction} @ ${entryPrice.toFixed(1)} · ${entryStrategyName}`;
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
      const isKutty = open.source === 'kutty';
      const closed = closePaperTrade({
        instrumentId,
        instrumentName,
        open,
        exitPrice: candle.close,
        exitTime: candle.date,
        exitReason: 'End of range',
        optionCandlesByToken,
        lotsMultiplier,
        strategyId: isKutty ? KUTTY_ID : strategy.id,
        strategyName: isKutty ? KUTTY_NAME : strategy.name,
      });
      trades.push(closed);
      if (isKutty) {
        recordKuttyClosed(kuttyState);
        kuttyMargin.usedRs = Math.max(0, kuttyMargin.usedRs - KUTTY_MARGIN_PER_TRADE_RS);
      } else {
        strategy.onTradeClosed?.(closed.indexPoints, day);
        kuttyMargin.trapOpenLegs = Math.max(0, kuttyMargin.trapOpenLegs - 1);
      }
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
    strategyId: strategy.id,
    strategyName: strategy.name,
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

    // Synthetic / missing token → option ₹ = index ₹ proxy (pts × 65/30).
    if (t.option.source === 'synthetic' || t.option.instrumentToken <= 0) {
      const est = applyEstimatedOptionPnl({
        indexPoints: t.indexPoints,
        entryPremium: null,
        lotSize: t.option.lotSize,
        lots,
        instrumentId: t.instrumentId,
      });
      return {
        ...t,
        optionEntryPremium: est.entry,
        optionExitPremium: est.exit,
        optionPnlRs: est.pnl,
        premiumEstimated: true,
      };
    }

    const entryEdge = t.optionEntryEdge ?? 'close';
    const entryHit = lookupPremium(
      optionCandlesByToken.get(t.option.instrumentToken),
      t.entryTime,
      entryEdge,
    );
    const levelExit = isLevelExitReason(t.exitReason);
    const exitHit = levelExit
      ? null
      : lookupPremium(
          optionCandlesByToken.get(t.option.instrumentToken),
          t.exitTime,
          'close',
        );

    // Both sides must come from real candles — never mix estimate + OHLC.
    if (entryHit != null && exitHit != null) {
      const optionPnlRs = computeOptionPnl({
        entryPremium: entryHit,
        exitPremium: exitHit,
        lotSize: t.option.lotSize,
        lots,
      });
      return {
        ...t,
        optionEntryPremium: entryHit,
        optionExitPremium: exitHit,
        optionPnlRs,
        premiumEstimated: false,
        optionEntryEdge: entryEdge,
      };
    }

    const est = applyEstimatedOptionPnl({
      indexPoints: t.indexPoints,
      entryPremium: entryHit,
      lotSize: t.option.lotSize,
      lots,
      instrumentId: t.instrumentId,
    });
    return {
      ...t,
      optionEntryPremium: est.entry,
      optionExitPremium: est.exit,
      optionPnlRs: est.pnl,
      premiumEstimated: true,
      optionEntryEdge: entryEdge,
    };
  });
}

export { buildContext, checkIndexExit, toOptionContract };
