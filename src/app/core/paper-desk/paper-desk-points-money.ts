import {
  PDHL_BANK_RUPEES_PER_POINT,
  PDHL_RUPEES_PER_POINT,
  rupeesPerPointForInstrument,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { clipRulerDayInr } from '../strategy-manager/engines/ruler-morning.util';
import { extractTradeDate } from '../utils/trade-date.util';
import { PaperTrade } from './paper-desk.models';

/** Research / Ruler money scale: Nifty ₹65/pt · Bank ₹30/pt × lots. */
export function indexPointsMoneyRs(
  indexPoints: number,
  instrumentId: string | null | undefined,
  lots: number,
): number {
  const rs = rupeesPerPointForInstrument(instrumentId);
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  return indexPoints * rs * lotMult;
}

/** Sum research-scale pts money across paper trades (per-instrument ₹65/₹30). */
export function sumPointsMoneyRs(trades: PaperTrade[], lots: number): number {
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  return trades.reduce(
    (a, t) => a + indexPointsMoneyRs(t.indexPoints, t.instrumentId, lotMult),
    0,
  );
}

export function pointsMoneyLabel(): string {
  return `Pts money ₹ (Nifty ₹${PDHL_RUPEES_PER_POINT} · Bank ₹${PDHL_BANK_RUPEES_PER_POINT})`;
}

/** Raw pts-money by calendar day (Nifty+Bank combined). */
export function pointsMoneyByDate(
  trades: PaperTrade[],
  lots: number,
): Map<string, number> {
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  const byDate = new Map<string, number>();
  for (const t of trades) {
    const date = extractTradeDate(t.entryTime);
    byDate.set(
      date,
      (byDate.get(date) ?? 0) +
        indexPointsMoneyRs(t.indexPoints, t.instrumentId, lotMult),
    );
  }
  return byDate;
}

/**
 * Research-faithful pts money: walk days in order, clip each combined day ₹
 * with dyn0 (−₹500 / min(cap, MTD) when month green).
 * This is what the Ruler research monthly totals use — not the uncapped trade sum.
 */
export function applyRulerDayClipByDate(
  rawByDate: Map<string, number> | Record<string, number>,
): { total: number; clippedByDate: Map<string, number> } {
  const entries =
    rawByDate instanceof Map
      ? [...rawByDate.entries()]
      : Object.entries(rawByDate);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const clippedByDate = new Map<string, number>();
  let mtd = 0;
  let total = 0;
  let curMonth: string | null = null;
  for (const [date, raw] of entries) {
    const ym = date.slice(0, 7);
    if (ym !== curMonth) {
      curMonth = ym;
      mtd = 0;
    }
    const clipped = clipRulerDayInr(raw, mtd);
    clippedByDate.set(date, clipped);
    total += clipped;
    mtd += clipped;
  }
  return { total, clippedByDate };
}

/** Uncapped trade sum → research day-clipped total (Ruler Testing card). */
export function sumPointsMoneyRsRulerClipped(
  trades: PaperTrade[],
  lots: number,
): number {
  return applyRulerDayClipByDate(pointsMoneyByDate(trades, lots)).total;
}

/** True when trades (or the run) used Ruler flow — drives day-cap P&L. */
export function tradesUsedRuler(trades: PaperTrade[]): boolean {
  return trades.some((t) => t.strategyId === 'ruler-flow');
}

/** Unique calendar days that produced at least one closed trade. */
export function tradedSessionCount(trades: PaperTrade[]): number {
  const days = new Set<string>();
  for (const t of trades) {
    days.add(extractTradeDate(t.entryTime));
  }
  return days.size;
}

/**
 * Count Mon–Fri sessions in an inclusive IST date range (index cash sessions).
 * Used for research-style average daily profit across the Testing window.
 */
export function countWeekdaySessions(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate || fromDate > toDate) {
    return 0;
  }
  let n = 0;
  const cur = new Date(`${fromDate}T12:00:00`);
  const end = new Date(`${toDate}T12:00:00`);
  while (cur <= end) {
    const dow = cur.getDay(); // 0 Sun … 6 Sat
    if (dow >= 1 && dow <= 5) {
      n += 1;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export interface RulerProfitTotals {
  pointsMoneyRs: number;
  pointsMoneyResearchRs?: number;
  /** Days with ≥1 closed trade. */
  tradedDays: number;
  /**
   * Denominator for avg/day: weekday sessions in [from,to] when provided,
   * else tradedDays (Live / unknown range).
   */
  sessionDays: number;
  /** Raw OHLC pts money ÷ sessionDays. */
  avgDailyProfitRs: number;
  /** Day-capped research book ÷ sessionDays (Ruler only). */
  avgDailyResearchRs?: number;
}

/** Central profit math for Nifty 50 + Bank Nifty Paper / Live / Testing. */
export function buildRulerProfitTotals(
  trades: PaperTrade[],
  lots: number,
  options?: {
    rulerDayClip?: boolean;
    fromDate?: string;
    toDate?: string;
  },
): RulerProfitTotals {
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  const pointsMoneyRs = sumPointsMoneyRs(trades, lotMult);
  const tradedDays = tradedSessionCount(trades);
  const rangeSessions =
    options?.fromDate && options?.toDate
      ? countWeekdaySessions(options.fromDate, options.toDate)
      : 0;
  const sessionDays = rangeSessions > 0 ? rangeSessions : Math.max(1, tradedDays);
  const avgDailyProfitRs =
    trades.length === 0 ? 0 : Math.round((pointsMoneyRs / sessionDays) * 10) / 10;

  if (!options?.rulerDayClip) {
    return {
      pointsMoneyRs,
      tradedDays,
      sessionDays: trades.length === 0 ? 0 : sessionDays,
      avgDailyProfitRs: trades.length === 0 ? 0 : avgDailyProfitRs,
    };
  }

  const pointsMoneyResearchRs = sumPointsMoneyRsRulerClipped(trades, lotMult);
  const denom = trades.length === 0 ? 0 : sessionDays;
  return {
    pointsMoneyRs,
    pointsMoneyResearchRs,
    tradedDays,
    sessionDays: denom,
    avgDailyProfitRs: denom ? Math.round((pointsMoneyRs / denom) * 10) / 10 : 0,
    avgDailyResearchRs: denom
      ? Math.round((pointsMoneyResearchRs / denom) * 10) / 10
      : 0,
  };
}
