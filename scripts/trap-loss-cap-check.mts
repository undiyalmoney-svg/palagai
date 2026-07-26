/**
 * Trap ₹ day-loss cap: does it hold, and what does it cost?
 * Compares cap OFF vs cap ON per year on the analyst cache.
 *   npx tsx scripts/trap-loss-cap-check.mts
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

/** Net ₹, and worst single-day ₹ per (day, instrument) — the cap is per instrument book. */
function stats(trades: PaperTrade[]) {
  let net = 0;
  const byDayInst = new Map<string, number>();
  for (const t of trades) {
    const rs = t.indexPoints * rupeesPerPointForInstrument(t.instrumentId);
    net += rs;
    const k = `${t.entryTime.slice(0, 10)}|${t.instrumentId}`;
    byDayInst.set(k, (byDayInst.get(k) ?? 0) + rs);
  }
  let worst = 0;
  let worstKey = '';
  let daysOver1k = 0;
  for (const [k, v] of byDayInst) {
    if (v < -1000) daysOver1k++;
    if (v < worst) {
      worst = v;
      worstKey = k;
    }
  }
  return {
    net: Math.round(net),
    trades: trades.length,
    worst: Math.round(worst),
    worstKey,
    daysOver1k,
    days: byDayInst.size,
  };
}

const nifty = loadCandles('nifty-5m-2020-2026.json');
const bank = loadCandles('banknifty-5m-2020-2026.json');
const cacheFrom = nifty[0]!.date.slice(0, 10);
const cacheTo = nifty[nifty.length - 1]!.date.slice(0, 10);
const firstYear = Number(cacheFrom.slice(0, 4));
const lastYear = Number(cacheTo.slice(0, 4));

console.log(`Cache ${cacheFrom} → ${cacheTo}\n`);
console.log('Year      OFF net ₹   OFF worst   OFF >1k |    ON net ₹    ON worst    ON >1k');
console.log('-'.repeat(82));

const rows = [];
for (let y = firstYear; y <= lastYear; y++) {
  const nSlice = yearSlice(nifty, y);
  const bSlice = yearSlice(bank, y);
  if (!nSlice.length) continue;
  const from = `${y}-01-01`;
  const to = y === lastYear ? cacheTo : `${y}-12-31`;
  const off = stats(run(0, nSlice, bSlice, from, to));
  const on = stats(run(1000, nSlice, bSlice, from, to));
  console.log(
    `${y}  ${String(off.net).padStart(11)}  ${String(off.worst).padStart(10)}  ${String(off.daysOver1k).padStart(7)} | ` +
      `${String(on.net).padStart(11)}  ${String(on.worst).padStart(10)}  ${String(on.daysOver1k).padStart(8)}`,
  );
  rows.push({ year: y, off, on });
}

const sum = (k: 'off' | 'on', f: 'net' | 'trades' | 'daysOver1k') =>
  rows.reduce((a, r) => a + (r[k][f] as number), 0);
const worstOf = (k: 'off' | 'on') => Math.min(...rows.map((r) => r[k].worst));

console.log('-'.repeat(82));
console.log(
  `TOTAL ${String(sum('off', 'net')).padStart(11)}  ${String(worstOf('off')).padStart(10)}  ` +
    `${String(sum('off', 'daysOver1k')).padStart(7)} | ${String(sum('on', 'net')).padStart(11)}  ` +
    `${String(worstOf('on')).padStart(10)}  ${String(sum('on', 'daysOver1k')).padStart(8)}`,
);
console.log(`\nTrades  OFF ${sum('off', 'trades')}   ON ${sum('on', 'trades')}`);
console.log(`Worst day  OFF ₹${worstOf('off')}   ON ₹${worstOf('on')}`);

writeFileSync(
  resolve(ROOT, 'reports/trap-loss-cap-check.json'),
  JSON.stringify({ from: cacheFrom, to: cacheTo, rows }, null, 2),
);
console.log('\nWrote reports/trap-loss-cap-check.json');
