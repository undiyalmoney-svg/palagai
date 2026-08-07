/**
 * Dry run: what will the Live desk do to an open Kite position if I press Start now?
 *
 * Fetches today's real 5m bars, drops the forming bar exactly like Live does,
 * replays the desk DNA, then reports whether the strategy still wants the leg
 * open — i.e. whether Start will HOLD (amend stop) or EXIT at market.
 *
 * Places no orders.
 *
 *   npx tsx scripts/what-would-restart-do.mts
 */
import { readFileSync } from 'node:fs';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import { instrumentIdForTradingSymbol } from '../src/app/core/live-desk/kite-order-book-fills.util';
import type { Candle } from '../src/app/core/models/candle.model';

const AUTH = readFileSync('/tmp/kite-auth', 'utf8').trim().split(/\s+/)[1]!;

async function kite<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.kite.trade${path}`, {
    headers: { 'X-Kite-Version': '3', Authorization: `token ${AUTH}` },
  });
  const body = (await res.json()) as { status?: string; data?: T; message?: string };
  if (body.status !== 'success' || body.data === undefined) {
    throw new Error(`Kite ${path}: ${body.message ?? res.status}`);
  }
  return body.data;
}

const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const istNow = new Date().toLocaleTimeString('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
});

async function bars(token: number): Promise<Candle[]> {
  const from = new Date(Date.now() - 14 * 864e5).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  const data = await kite<{ candles: [string, number, number, number, number, number][] }>(
    `/instruments/historical/${token}/5minute?from=${from}+09:00:00&to=${istToday}+15:30:00`,
  );
  return data.candles.map((c) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

const BOOKS = [
  { id: 'nifty-50', name: 'Nifty 50', kind: 'nifty' as const, token: 256265 },
  { id: 'bank-nifty', name: 'Bank Nifty', kind: 'banknifty' as const, token: 260105 },
];

interface PositionRow {
  tradingsymbol: string;
  quantity: number;
  day_buy_price: number;
  last_price: number;
  pnl: number;
}

const positions = await kite<{ day: PositionRow[] }>('/portfolio/positions');
const openLegs = positions.day.filter((p) => p.quantity !== 0);

console.log(`IST now ${istNow} · ${istToday}`);
console.log(`Open Kite positions: ${openLegs.length || 'none'}`);
for (const p of openLegs) {
  console.log(
    `  ${p.tradingsymbol} qty ${p.quantity} avg ${p.day_buy_price.toFixed(2)} ltp ${p.last_price} pnl ${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}`,
  );
}

for (const book of BOOKS) {
  const held = openLegs.find((p) => instrumentIdForTradingSymbol(p.tradingsymbol) === book.id);
  const raw = await bars(book.token);
  const live = dropFormingBars(raw);
  const dropped = raw.length - live.length;

  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  const out = replayPaperOnIndex({
    instrumentId: book.id,
    instrumentName: book.name,
    kind: book.kind,
    candles: live,
    fromDate: istToday,
    toDate: istToday,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy: strat,
    // Live never force-closes mid-session — mirror that.
    forceCloseOpen: false,
    lotsMultiplier: 1,
    enableKutty: false,
  });

  const stillOpen = out.open ?? null;
  console.log(`\n=== ${book.name} ===`);
  console.log(
    `  bars: ${live.length} closed (dropped ${dropped} forming) · last ${live.at(-1)?.date ?? '—'}`,
  );
  console.log(`  desk replay closed trades today: ${out.trades.length}`);
  for (const t of out.trades) {
    console.log(
      `    ${t.entryTime.slice(11, 16)}→${t.exitTime.slice(11, 16)} ${t.direction} fut ${t.indexPoints.toFixed(1)} · ${t.exitReason}`,
    );
  }
  console.log(`  strategy open leg now: ${stillOpen ? 'YES' : 'no'}`);
  if (stillOpen) {
    console.log(
      `    dir ${stillOpen.direction} entry ${String(stillOpen.entryTime).slice(11, 16)} idxEntry ${stillOpen.indexEntry} idxStop ${stillOpen.indexStop}`,
    );
  }

  if (!held) {
    console.log('  → no Kite position for this book. Restart is a no-op here.');
    continue;
  }
  if (stillOpen) {
    console.log(
      `  → RESTART = HOLD ${held.tradingsymbol}. Same contract, so the desk amends the stop only.`,
    );
  } else {
    console.log(
      `  → RESTART = EXIT ${held.tradingsymbol} AT MARKET (strategy is flat; broker is not).`,
    );
  }
}
