/**
 * Verify Live money Profit ₹ equals Kite Positions ₹ for a day.
 *
 * Feeds the real Kite order book through the same code the desk uses
 * (summaryRowsFromKiteOrderBook → syncTradesToKiteFills) and compares the
 * per-book totals with portfolio/positions day P&L.
 *
 *   KITE_AUTH="apikey:access_token" npx tsx scripts/verify-kite-fill-money.mts
 */
import { readFileSync } from 'node:fs';
import {
  summaryRowsFromKiteOrderBook,
  type KiteOrderBookRow,
} from '../src/app/core/live-desk/kite-order-book-fills.util';
import { syncTradesToKiteFills } from '../src/app/core/paper-desk/apply-kite-fill-pnl';

function auth(): string {
  if (process.env.KITE_AUTH) {
    return process.env.KITE_AUTH;
  }
  return readFileSync('/tmp/kite-auth', 'utf8').trim().split(/\s+/)[1]!;
}

async function kite<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.kite.trade${path}`, {
    headers: { 'X-Kite-Version': '3', Authorization: `token ${auth()}` },
  });
  const body = (await res.json()) as { status?: string; data?: T; message?: string };
  if (body.status !== 'success' || body.data === undefined) {
    throw new Error(`Kite ${path}: ${body.message ?? res.status}`);
  }
  return body.data;
}

interface PositionRow {
  tradingsymbol: string;
  pnl: number;
  multiplier: number;
}

const bookOf = (sym: string): string => {
  const s = sym.toUpperCase();
  if (s.startsWith('BANKNIFTY')) return 'bank-nifty';
  if (s.startsWith('NIFTY')) return 'nifty-50';
  if (s.startsWith('CRUDEOILM')) return 'crude-oil-mini';
  return 'other';
};

const orders = await kite<KiteOrderBookRow[]>('/orders');
const positions = await kite<{ day: PositionRow[] }>('/portfolio/positions');

const rows = summaryRowsFromKiteOrderBook(orders);
console.log(`PALAGAI COMPLETE fills rebuilt from order book: ${rows.length}`);

// No desk replay at all — every leg must come from Kite fills alone.
const trades = syncTradesToKiteFills([], rows);

const deskByBook = new Map<string, number>();
for (const t of trades) {
  deskByBook.set(t.instrumentId, (deskByBook.get(t.instrumentId) ?? 0) + (t.optionPnlRs ?? 0));
}

const kiteByBook = new Map<string, number>();
for (const p of positions.day) {
  const b = bookOf(p.tradingsymbol);
  kiteByBook.set(b, (kiteByBook.get(b) ?? 0) + p.pnl);
}

console.log('\nbook              desk Profit ₹     Kite Positions ₹   diff');
let deskTotal = 0;
let kiteTotal = 0;
let bad = 0;
for (const book of new Set([...deskByBook.keys(), ...kiteByBook.keys()])) {
  const d = Math.round((deskByBook.get(book) ?? 0) * 100) / 100;
  const k = Math.round((kiteByBook.get(book) ?? 0) * 100) / 100;
  const diff = Math.round((d - k) * 100) / 100;
  deskTotal += d;
  kiteTotal += k;
  if (Math.abs(diff) > 0.5) bad += 1;
  console.log(
    `${book.padEnd(16)} ${String(d).padStart(12)} ${String(k).padStart(18)} ${String(diff).padStart(8)}`,
  );
}
console.log(
  `${'TOTAL'.padEnd(16)} ${String(Math.round(deskTotal * 100) / 100).padStart(12)} ${String(Math.round(kiteTotal * 100) / 100).padStart(18)} ${String(Math.round((deskTotal - kiteTotal) * 100) / 100).padStart(8)}`,
);

console.log('\nper closed leg:');
for (const t of trades.sort((a, b) => a.entryTime.localeCompare(b.entryTime))) {
  console.log(
    `  ${t.option?.tradingSymbol.padEnd(24)} ${String(t.optionEntryPremium).padStart(8)} → ${String(t.optionExitPremium).padStart(8)}  = ${String(t.optionPnlRs).padStart(9)}  ${t.outcome}`,
  );
}

if (bad > 0) {
  console.error(`\nFAIL: ${bad} book(s) disagree with Kite Positions`);
  process.exit(1);
}
console.log('\nOK: every book matches Kite Positions ₹');
