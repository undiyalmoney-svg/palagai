import { extractTradeDate, formatDayOfWeek } from '../utils/trade-date.util';
import { PaperTrade, PaperDeskSnapshot } from './paper-desk.models';
import { buildPaperDeskDayStats, emptyPaperDeskDayStats, DayStatsRankBy } from './paper-desk-day-stats';
import { sumPointsMoneyRs } from './paper-desk-points-money';

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
  lotsUsed: number,
): PaperDeskSnapshot['totals'] {
  const lots = Math.max(1, Math.floor(lotsUsed) || 1);
  const indexNetPts = trades.reduce((a, t) => a + t.indexPoints, 0);
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.outcome === 'WIN').length,
    losses: trades.filter((t) => t.outcome === 'LOSS').length,
    indexNetPts,
    optionNetRs: trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0),
    lotsUsed: lots,
    pointsMoneyRs: sumPointsMoneyRs(trades, lots),
  };
}

/** Filtered testing view: same fetch, weekdays Mon–Fri only as selected. */
export function buildWeekdayFilteredView(
  trades: PaperTrade[],
  selection: PaperWeekdaySelection,
  lotsUsed: number,
  rankBy: DayStatsRankBy = 'option',
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
    totals: summarizePaperTrades(filtered, lotsUsed),
    dayStats: filtered.length
      ? buildPaperDeskDayStats(filtered, 5, lotsUsed, rankBy)
      : { ...emptyPaperDeskDayStats(), rankBy },
    weekdayLabel: names.length ? names.join(', ') : 'none',
  };
}
