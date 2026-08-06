/**
 * Replay current Trade Desk DNA on analyst cache and print profits.
 * Nifty/Bank: Trap pierce15 · Bank30 · peak₹400 · soft OFF · RR2
 * Crude: Selective Trap SL50/TP200 · unlimited · 10:00–23:00
 *
 * Metric: Index/futures ₹ proxy (pts × ₹65 / ₹30 / ₹10) × 1 lot — same as research.
 * Option candles not in cache → Opt₹ estimated / N/A; trust Index₹ for comparison.
 *
 *   npx tsx scripts/desk-current-dna-profit.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { replayPaperOnCrude } from '../src/app/core/paper-desk/crude-paper-engine';
import { rupeesPerPointForInstrument } from '../src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { CRUDE_RUPEES_PER_POINT } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { resolveCrudeStrategyProfile } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import type { Candle } from '../src/app/core/models/candle.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const ROOT = resolve(import.meta.dirname, '..');
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

function dayOf(ts: string): string {
  return ts.replace('T', ' ').slice(0, 10);
}

function clock(ts: string): string {
  const m = ts.replace('T', ' ').match(/\b(\d{2}:\d{2})\b/);
  return m?.[1] ?? '—';
}

function indexRs(t: PaperTrade): number {
  if (t.instrumentId.includes('crude') || /CRUDE/i.test(t.instrumentName)) {
    return t.indexPoints * CRUDE_RUPEES_PER_POINT;
  }
  return t.indexPoints * rupeesPerPointForInstrument(t.instrumentId);
}

function sumRs(trades: PaperTrade[]): number {
  return Math.round(trades.reduce((a, t) => a + indexRs(t), 0));
}

function printTrades(title: string, trades: PaperTrade[], limit = 40): void {
  console.log(`\n### ${title} (${trades.length} fills)`);
  if (!trades.length) {
    console.log('  (none)');
    return;
  }
  const show = trades.slice(-limit);
  if (trades.length > limit) {
    console.log(`  … showing last ${limit} of ${trades.length}`);
  }
  for (const t of show) {
    const rs = indexRs(t);
    const sign = rs >= 0 ? '+' : '';
    console.log(
      `  ${dayOf(t.entryTime)} ${clock(t.entryTime)}→${clock(t.exitTime)}  ${t.direction.padEnd(4)}  ` +
        `fut ${t.indexPoints >= 0 ? '+' : ''}${t.indexPoints.toFixed(1).padStart(6)}  ` +
        `₹${sign}${rs.toFixed(0).padStart(5)}  ${t.exitReason}`,
    );
  }
  const wins = trades.filter((t) => indexRs(t) > 0).length;
  const losses = trades.filter((t) => indexRs(t) < 0).length;
  console.log(
    `  → net Index₹ ${sumRs(trades) >= 0 ? '+' : ''}${sumRs(trades)}  · W/L ${wins}/${losses}`,
  );
}

function byDay(trades: PaperTrade[]): Map<string, PaperTrade[]> {
  const m = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    const d = dayOf(t.entryTime);
    const list = m.get(d) ?? [];
    list.push(t);
    m.set(d, list);
  }
  return m;
}

function printDayTable(
  nifty: PaperTrade[],
  bank: PaperTrade[],
  crude: PaperTrade[],
  from: string,
  to: string,
): void {
  const nD = byDay(nifty);
  const bD = byDay(bank);
  const cD = byDay(crude);
  const days = [
    ...new Set([...nD.keys(), ...bD.keys(), ...cD.keys()]),
  ]
    .filter((d) => d >= from && d <= to)
    .sort();

  console.log(`\n## Day × book · Index₹ proxy · 1 lot · ${from} → ${to}`);
  console.log(
    `${'Day'.padEnd(12)} ${'Nifty'.padStart(8)} ${'Bank'.padStart(8)} ${'Crude'.padStart(8)} ${'Total'.padStart(8)}  fills`,
  );
  let tn = 0;
  let tb = 0;
  let tc = 0;
  for (const d of days) {
    const n = sumRs(nD.get(d) ?? []);
    const b = sumRs(bD.get(d) ?? []);
    const c = sumRs(cD.get(d) ?? []);
    const tot = n + b + c;
    tn += n;
    tb += b;
    tc += c;
    const fills =
      (nD.get(d)?.length ?? 0) + (bD.get(d)?.length ?? 0) + (cD.get(d)?.length ?? 0);
    const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x}`;
    console.log(
      `${d.padEnd(12)} ${fmt(n).padStart(8)} ${fmt(b).padStart(8)} ${fmt(c).padStart(8)} ${fmt(tot).padStart(8)}  ${fills}`,
    );
  }
  const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x}`;
  console.log(
    `${'TOTAL'.padEnd(12)} ${fmt(tn).padStart(8)} ${fmt(tb).padStart(8)} ${fmt(tc).padStart(8)} ${fmt(tn + tb + tc).padStart(8)}`,
  );
  const green = days.filter((d) => {
    const tot =
      sumRs(nD.get(d) ?? []) + sumRs(bD.get(d) ?? []) + sumRs(cD.get(d) ?? []);
    return tot > 0;
  }).length;
  console.log(
    `Green days ${green}/${days.length} (${days.length ? ((100 * green) / days.length).toFixed(0) : 0}%) · avg/day ₹${days.length ? Math.round((tn + tb + tc) / days.length) : 0}`,
  );
}

function runIndex(
  instrumentId: string,
  instrumentName: string,
  kind: 'nifty' | 'banknifty',
  candles: Candle[],
  from: string,
  to: string,
): PaperTrade[] {
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  const out = replayPaperOnIndex({
    instrumentId,
    instrumentName,
    kind,
    candles,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
  });
  return out.trades;
}

function runCrude(candles: Candle[], from: string, to: string): PaperTrade[] {
  const params = resolveCrudeStrategyProfile('selective');
  const out = replayPaperOnCrude({
    instrumentId: 'crude-oil-mini',
    instrumentName: 'Crude Oil Mini',
    candles,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableMorning: params.defaultEnableMorning,
    enableEvening: params.defaultEnableEvening,
    tradeParams: params,
  });
  return out.trades;
}

const niftyC = loadCandles('nifty-5m-2020-2026.json');
const bankC = loadCandles('banknifty-5m-2020-2026.json');
const crudeC = loadCandles('crudeoilm-5m-merged.json');

const cacheLast = dayOf(niftyC[niftyC.length - 1]!.date);
const crudeLast = dayOf(crudeC[crudeC.length - 1]!.date);
const crudeFirst = dayOf(crudeC[0]!.date);

console.log('=== Current Trade Desk DNA profit (v1.3.70 engines) ===');
console.log('Nifty/Bank: Trap · pierce15 · Bank30 · bounce OR · peak₹400 · soft OFF · RR2 · dayStop 80');
console.log('Crude: Selective · Trap SL50/TP200 · confirm · unlimited · 10:00–23:00 · protect OFF');
console.log(`Cache: Nifty/Bank → ${cacheLast} 14:20 · Crude ${crudeFirst} → ${crudeLast}`);
console.log('Money = futures/index ₹ proxy @ 1 lot (Nifty ₹65 · Bank ₹30 · Crude ₹10 / pt)');
console.log('NOTE: Aug 4 cache ends 14:20 — afternoon incomplete.\n');

const windows: Array<[string, string, string]> = [
  ['Last 2 sessions', '2026-08-03', cacheLast],
  ['This week (Mon–Tue cache)', '2026-08-03', cacheLast],
  ['Last 5 sessions', '2026-07-29', cacheLast],
  ['July 2026', '2026-07-01', '2026-07-31'],
  ['Crude overlap (desk)', crudeFirst < '2026-03-23' ? '2026-03-23' : crudeFirst, crudeLast],
];

for (const [label, from, to] of windows) {
  console.log(`\n======== ${label}: ${from} → ${to} ========`);
  const nifty = runIndex('nifty-50', 'Nifty 50', 'nifty', niftyC, from, to);
  const bank = runIndex('bank-nifty', 'Bank Nifty', 'banknifty', bankC, from, to);
  const crude = runCrude(crudeC, from, to);

  printDayTable(nifty, bank, crude, from, to);
  printTrades('Nifty 50', nifty, 25);
  printTrades('Bank Nifty', bank, 25);
  printTrades('Crude Oil Mini', crude, 25);

  const total = sumRs(nifty) + sumRs(bank) + sumRs(crude);
  console.log(
    `\n>>> ${label} TOTAL Index₹ ${total >= 0 ? '+' : ''}${total}  (N ${sumRs(nifty) >= 0 ? '+' : ''}${sumRs(nifty)} · B ${sumRs(bank) >= 0 ? '+' : ''}${sumRs(bank)} · C ${sumRs(crude) >= 0 ? '+' : ''}${sumRs(crude)})`,
  );
}
