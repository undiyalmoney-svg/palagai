import { extractTradeDate, formatDayOfWeek, formatDisplayDate } from '../utils/trade-date.util';
import { PaperTrade } from './paper-desk.models';
import { indexPointsMoneyRs } from './paper-desk-points-money';

export interface PaperDayStat {
  date: string;
  weekday: string;
  displayDate: string;
  trades: number;
  wins: number;
  losses: number;
  indexNetPts: number;
  optionNetRs: number;
  /** Research-scale: pts × ₹65/₹30 × lots. */
  pointsMoneyRs: number;
}

export interface PaperWeekdayStat {
  weekday: string;
  trades: number;
  wins: number;
  losses: number;
  indexNetPts: number;
  optionNetRs: number;
  pointsMoneyRs: number;
}

export interface PaperDeskDayStats {
  bestDay: PaperDayStat | null;
  worstDay: PaperDayStat | null;
  topProfitDays: PaperDayStat[];
  topLossDays: PaperDayStat[];
  byWeekday: PaperWeekdayStat[];
  tradingDays: number;
  /** Which money column was used for best/worst / top lists. */
  rankBy: 'option' | 'pointsMoney';
}

const WEEKDAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function emptyPaperDeskDayStats(): PaperDeskDayStats {
  return {
    bestDay: null,
    worstDay: null,
    topProfitDays: [],
    topLossDays: [],
    byWeekday: [],
    tradingDays: 0,
    rankBy: 'option',
  };
}

export type DayStatsRankBy = 'option' | 'pointsMoney';

/** Group closed paper trades by calendar day and rank best / worst days. */
export function buildPaperDeskDayStats(
  trades: PaperTrade[],
  topN: number = 5,
  lotsUsed: number = 1,
  rankBy: DayStatsRankBy = 'option',
): PaperDeskDayStats {
  if (!trades.length) {
    return { ...emptyPaperDeskDayStats(), rankBy };
  }

  const lots = Math.max(1, Math.floor(lotsUsed) || 1);
  const byDate = new Map<string, PaperDayStat>();
  for (const t of trades) {
    const date = extractTradeDate(t.entryTime);
    let row = byDate.get(date);
    if (!row) {
      row = {
        date,
        weekday: formatDayOfWeek(date),
        displayDate: formatDisplayDate(date),
        trades: 0,
        wins: 0,
        losses: 0,
        indexNetPts: 0,
        optionNetRs: 0,
        pointsMoneyRs: 0,
      };
      byDate.set(date, row);
    }
    row.trades += 1;
    if (t.outcome === 'WIN') {
      row.wins += 1;
    } else if (t.outcome === 'LOSS') {
      row.losses += 1;
    }
    row.indexNetPts += t.indexPoints;
    row.optionNetRs += t.optionPnlRs ?? 0;
    row.pointsMoneyRs += indexPointsMoneyRs(t.indexPoints, t.instrumentId, lots);
  }

  // Keep day rows as raw OHLC pts money. Research day-cap belongs on the
  // totals.research card — replacing every loss day with −₹1,000 looked like a bug.
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const money = (d: PaperDayStat) => (rankBy === 'pointsMoney' ? d.pointsMoneyRs : d.optionNetRs);
  const byProfit = [...days].sort((a, b) => money(b) - money(a));
  const n = Math.max(1, Math.floor(topN) || 5);

  const weekdayMap = new Map<string, PaperWeekdayStat>();
  for (const d of days) {
    let w = weekdayMap.get(d.weekday);
    if (!w) {
      w = {
        weekday: d.weekday,
        trades: 0,
        wins: 0,
        losses: 0,
        indexNetPts: 0,
        optionNetRs: 0,
        pointsMoneyRs: 0,
      };
      weekdayMap.set(d.weekday, w);
    }
    w.trades += d.trades;
    w.wins += d.wins;
    w.losses += d.losses;
    w.indexNetPts += d.indexNetPts;
    w.optionNetRs += d.optionNetRs;
    w.pointsMoneyRs += d.pointsMoneyRs;
  }

  const byWeekday = WEEKDAY_ORDER.map((name) => weekdayMap.get(name)).filter(
    (x): x is PaperWeekdayStat => !!x,
  );

  return {
    bestDay: byProfit[0] ?? null,
    worstDay: byProfit[byProfit.length - 1] ?? null,
    topProfitDays: byProfit.filter((d) => money(d) > 0).slice(0, n),
    topLossDays: [...byProfit]
      .filter((d) => money(d) < 0)
      .sort((a, b) => money(a) - money(b))
      .slice(0, n),
    byWeekday,
    tradingDays: days.length,
    rankBy,
  };
}
