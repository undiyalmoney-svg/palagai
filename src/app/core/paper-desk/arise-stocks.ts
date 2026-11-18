/**
 * Arise cash MIS books. Same mom 0.8× skip range as the four index names.
 * Share count is not a fixed 50. A cheap name that only moves ₹1 a day needs
 * 370 shares to bank ₹370; a ₹3,500 name that moves ~₹35 needs about 11.
 * Qty = round(₹370 / (1% of last)). Not a guaranteed profit.
 */
export const ARISE_STOCK_BANK_RS = 370;
/** Typical cash day used to size qty. ₹100 last → ₹1 move → 370 shares. */
export const ARISE_STOCK_DAY_MOVE_PCT = 0.01;

export const ARISE_STOCKS = [
  { id: 'hdfcbank', label: 'HDFC Bank', symbol: 'HDFCBANK' },
  { id: 'reliance', label: 'Reliance', symbol: 'RELIANCE' },
  { id: 'icicibank', label: 'ICICI Bank', symbol: 'ICICIBANK' },
  { id: 'infy', label: 'Infosys', symbol: 'INFY' },
  { id: 'tcs', label: 'TCS', symbol: 'TCS' },
] as const;

export type AriseStockId = (typeof ARISE_STOCKS)[number]['id'];

const STOCK_IDS: readonly string[] = ARISE_STOCKS.map((s) => s.id);

export function isAriseStock(under: string): boolean {
  return STOCK_IDS.includes(under);
}

export function ariseStockOf(under: string): (typeof ARISE_STOCKS)[number] | undefined {
  return ARISE_STOCKS.find((s) => s.id === under);
}

/** Shares so a 1% day nets ₹370. ₹100 last → 370. ₹1,400 last → 26. */
export function ariseStockQty(last: number): number {
  const px = Number(last);
  const move = px * ARISE_STOCK_DAY_MOVE_PCT;
  if (!(px > 0) || !(move > 0) || !Number.isFinite(move)) return 0;
  return Math.max(1, Math.round(ARISE_STOCK_BANK_RS / move));
}
