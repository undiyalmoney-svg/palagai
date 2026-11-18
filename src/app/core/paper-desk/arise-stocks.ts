/**
 * Arise cash MIS books. Same mom 0.8× skip range as the four index names.
 * Count is 50 shares so a ₹370 stop/target is ₹7.40 a share. Not a guaranteed profit.
 */
export const ARISE_STOCK_QTY = 50;

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
