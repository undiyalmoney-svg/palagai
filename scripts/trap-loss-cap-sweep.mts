/**
 * Sweep Trap ₹ day-loss cap levels. Reports per-instrument AND combined
 * (Nifty+Bank same calendar day) worst loss, since the cap is enforced per book.
 *   npx tsx scripts/trap-loss-cap-sweep.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { rupeesPerPointForInstrument } from '../src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import type { Candle } from '../src/app/core/models/candle.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, 'reports/analyst-cache');

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(resolve(CACHE, file), 'utf8')) as Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
  return raw.map((c) => ({
    date: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

function yearSlice(candles: Candle[], year: number): Candle[] {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  let start = candles.findIndex((c) => c.date.slice(0, 10) >= from);
  if (start < 0) return [];
  start = Math.max(0, start - 80);
  let end = candles.length;
  for (let i = start; i < candles.length; i++) {
    if (candles[i]!.date.slice(0, 10) > to) {
      end = i;
      break;
    }
  }
  return candles.slice(start, end);
}

function run(capRs: number, nifty: Candle[], bank: Candle[], from: string, to: string): PaperTrade[] {
  const mk = () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize();
    s.updateSettings({ dayLossCapRs: capRs });
    return s;
  };
  const n = replayPaperOnIndex({
    instrumentId: 'nifty-50',
    instrumentName: 'Nifty 50',
    kind: 'nifty',
    candles: nifty,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    strategy: mk(),
    forceCloseOpen: true,
    lotsMultiplier: 1,
  });
  const b = replayPaperOnIndex({
    instrumentId: 'bank-nifty',
    instrumentName: 'Bank Nifty',
    kind: 'banknifty',
    candles: bank,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    strategy: mk(),
    forceCloseOpen: true,
    lotsMultiplier: 1,
  });
  return [...n.trades, ...b.trades];
}

function stats(trades: PaperTrade[]) {
  let net = 0;
  const perBook = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const t of trades) {
    const rs = t.indexPoints * rupeesPerPointForInstrument(t.instrumentId);
    net += rs;
    const d = t.entryTime.slice(0, 10);
    perBook.set(`${d}|${t.instrumentId}`, (perBook.get(`${d}|${t.instrumentId}`) ?? 0) + rs);
    perDay.set(d, (perDay.get(d) ?? 0) + rs);
  }
  const worstBook = Math.min(0, ...perBook.values());
  const worstDay = Math.min(0, ...perDay.values());
  let redDays = 0;
  for (const v of perDay.values()) if (v < 0) redDays++;
  return {
    net: Math.round(net),
    trades: trades.length,
    worstBook: Math.round(worstBook),
    worstDay: Math.round(worstDay),
    redDays,
    days: perDay.size,
  };
}

const nifty = loadCandles('nifty-5m-2020-2026.json');
const bank = loadCandles('banknifty-5m-2020-2026.json');
const cacheTo = nifty[nifty.length - 1]!.date.slice(0, 10);
const firstYear = 2020;
const lastYear = Number(cacheTo.slice(0, 4));

const CAPS = [500, 750, 1000, 1500, 2000];
const out: Record<string, ReturnType<typeof stats>> = {};

for (const cap of CAPS) {
  const all: PaperTrade[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const nSlice = yearSlice(nifty, y);
    const bSlice = yearSlice(bank, y);
    if (!nSlice.length) continue;
    const to = y === lastYear ? cacheTo : `${y}-12-31`;
    all.push(...run(cap, nSlice, bSlice, `${y}-01-01`, to));
  }
  out[String(cap)] = stats(all);
  const s = out[String(cap)]!;
  console.log(
    `cap ₹${String(cap).padStart(4)}  net ₹${String(s.net).padStart(8)}  trades ${String(s.trades).padStart(4)}  ` +
      `worst/book ₹${String(s.worstBook).padStart(6)}  worst/day ₹${String(s.worstDay).padStart(6)}  red days ${s.redDays}/${s.days}`,
  );
}

writeFileSync(resolve(ROOT, 'reports/trap-loss-cap-sweep.json'), JSON.stringify(out, null, 2));
console.log('\nWrote reports/trap-loss-cap-sweep.json');
