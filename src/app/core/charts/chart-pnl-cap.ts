/**
 * Optional rupee max-profit / max-loss per Charts book.
 *
 * Blank (null) means the book keeps the 25% premium stop and 0.5R target.
 * A positive rupee cap is watched against the live fill: when it is hit the
 * Charts tab cancels the resting SL/TP and market-exits that contract.
 */
import { ChartBookId } from './live-chart-data.service';

export interface ChartPnlCap {
  maxProfitRs: number | null;
  maxLossRs: number | null;
}

export type ChartPnlCaps = Record<ChartBookId, ChartPnlCap>;

export type ChartPnlHit = 'PROFIT' | 'LOSS';

export function defaultPnlCap(): ChartPnlCap {
  return { maxProfitRs: null, maxLossRs: null };
}

export function defaultPnlCaps(): ChartPnlCaps {
  return {
    nifty: defaultPnlCap(),
    bank: defaultPnlCap(),
    crude: defaultPnlCap(),
  };
}

/** Positive rupees only. Blank, 0 or junk means "not set — use the system stop/target". */
export function parseRsCap(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function parsePnlCap(value: unknown): ChartPnlCap {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    maxProfitRs: parseRsCap(row['maxProfitRs']),
    maxLossRs: parseRsCap(row['maxLossRs']),
  };
}

export function parsePnlCaps(value: unknown): ChartPnlCaps {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    nifty: parsePnlCap(row['nifty']),
    bank: parsePnlCap(row['bank']),
    crude: parsePnlCap(row['crude']),
  };
}

export function capSet(cap: ChartPnlCap | null | undefined): boolean {
  return (
    (cap?.maxProfitRs != null && cap.maxProfitRs > 0) ||
    (cap?.maxLossRs != null && cap.maxLossRs > 0)
  );
}

export function anyCapSet(caps: ChartPnlCaps): boolean {
  return capSet(caps.nifty) || capSet(caps.bank) || capSet(caps.crude);
}

/**
 * Whether an open fill's rupee P&L has reached that book's cap.
 * Unset sides never fire; loss is checked first so a gap that crosses both
 * still exits as a loss.
 */
export function hitChartPnlCap(
  pnl: number | null | undefined,
  cap: ChartPnlCap | null | undefined,
): ChartPnlHit | null {
  if (pnl == null || !Number.isFinite(pnl) || !cap) return null;
  if (cap.maxLossRs != null && cap.maxLossRs > 0 && pnl <= -cap.maxLossRs) return 'LOSS';
  if (cap.maxProfitRs != null && cap.maxProfitRs > 0 && pnl >= cap.maxProfitRs) return 'PROFIT';
  return null;
}
