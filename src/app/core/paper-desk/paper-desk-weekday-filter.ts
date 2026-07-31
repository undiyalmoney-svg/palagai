import { extractTradeDate, formatDayOfWeek } from '../utils/trade-date.util';
import { PaperTrade, PaperDeskSnapshot } from './paper-desk.models';
import { buildPaperDeskDayStats, emptyPaperDeskDayStats } from './paper-desk-day-stats';
import { rupeesPerPointForInstrument } from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';

export const PAPER_WEEKDAY_OPTIONS = [
  { key: 'Monday', short: 'Mon' },
  { key: 'Tuesday', short: 'Tue' },
  { key: 'Wednesday', short: 'Wed' },
  { key: 'Thursday', short: 'Thu' },
  { key: 'Friday', short: 'Fri' },
] as const;

export type PaperWeekdayKey = (typeof PAPER_WEEKDAY_OPTIONS)[number]['key'];

export type PaperWeekdaySelection = Record<PaperWeekdayKey, boolean>;

export function defaultPaperWeekdaySelection(): PaperWeekdaySelection {
  return {
    Monday: true,
    Tuesday: true,
    Wednesday: true,
    Thursday: true,
    Friday: true,
  };
}

export function selectedWeekdayNames(selection: PaperWeekdaySelection): Set<string> {
  const set = new Set<string>();
  for (const opt of PAPER_WEEKDAY_OPTIONS) {
    if (selection[opt.key]) {
      set.add(opt.key);
    }
  }
  return set;
}

export function filterTradesByWeekdays(
  trades: PaperTrade[],
  selection: PaperWeekdaySelection,
): PaperTrade[] {
  const selected = selectedWeekdayNames(selection);
  if (!selected.size) {
    return [];
  }
  return trades.filter((t) => selected.has(formatDayOfWeek(extractTradeDate(t.entryTime))));
}

export function summarizePaperTrades(
  trades: PaperTrade[],
  lotsUsedOrResolver: number | ((instrumentId: string) => number),
  rupeesPerPoint: number,
): PaperDeskSnapshot['totals'] {
  const lotsFor =
    typeof lotsUsedOrResolver === 'function'
      ? lotsUsedOrResolver
      : () => Math.max(1, Math.floor(lotsUsedOrResolver) || 1);
  const displayLots =
    typeof lotsUsedOrResolver === 'function'
      ? Math.max(1, ...trades.map((t) => lotsFor(t.instrumentId)), 1)
      : Math.max(1, Math.floor(lotsUsedOrResolver) || 1);
  const indexNetPts = trades.reduce((a, t) => a + t.indexPoints, 0);
  const optionNetRs = trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
  const optionChargesRs = trades.reduce((a, t) => a + (t.chargesRs ?? 0), 0);
  const pointsMoneyRs = trades.reduce((a, t) => {
    const rpp = rupeesPerPointForInstrument(t.instrumentId) || rupeesPerPoint;
    return a + t.indexPoints * rpp * lotsFor(t.instrumentId);
  }, 0);
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.outcome === 'WIN').length,
    losses: trades.filter((t) => t.outcome === 'LOSS').length,
    indexNetPts,
    optionNetRs,
    lotsUsed: displayLots,
    pointsMoneyRs,
    optionChargesRs,
    optionNetAfterChargesRs: Math.round((optionNetRs - optionChargesRs) * 100) / 100,
    premiumEstimatedCount: trades.filter((t) => t.premiumEstimated).length,
  };
}

/** Filtered testing view: same fetch, weekdays Mon–Fri only as selected. */
export function buildWeekdayFilteredView(
  trades: PaperTrade[],
  selection: PaperWeekdaySelection,
  lotsUsedOrResolver: number | ((instrumentId: string) => number),
  rupeesPerPoint: number,
): {
  trades: PaperTrade[];
  totals: PaperDeskSnapshot['totals'];
  dayStats: ReturnType<typeof buildPaperDeskDayStats>;
  weekdayLabel: string;
} {
  const filtered = filterTradesByWeekdays(trades, selection);
  const names = PAPER_WEEKDAY_OPTIONS.filter((o) => selection[o.key]).map((o) => o.short);
  return {
    trades: filtered,
    totals: summarizePaperTrades(filtered, lotsUsedOrResolver, rupeesPerPoint),
    dayStats: filtered.length ? buildPaperDeskDayStats(filtered) : emptyPaperDeskDayStats(),
    weekdayLabel: names.length ? names.join(', ') : 'none',
  };
}
