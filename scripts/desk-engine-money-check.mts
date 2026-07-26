/**
 * Replay app Trap / Donch / Genie via paper-desk engine on analyst cache.
 * Metric: Index ₹ proxy (pts × 65/30) — same as research.
 *
 *   npx tsx scripts/desk-engine-money-check.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex, enrichTradesWithOptionPremiums } from '../src/app/core/paper-desk/paper-desk-engine';
import { rupeesPerPointForInstrument } from '../src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { DonchRetestOrMid2rManagedStrategy } from '../src/app/core/strategy-manager/modules/donch-retest-or-mid-2r.managed-strategy';
import { AlignComboGenieManagedStrategy } from '../src/app/core/strategy-manager/modules/align-combo-genie.managed-strategy';
import type { Candle } from '../src/app/core/models/candle.model';
import type { IManagedStrategy } from '../src/app/core/strategy-manager/models/strategy-module.interface';

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

function money(trades: { indexPoints: number; instrumentId: string; optionPnlRs: number | null }[]) {
  const pts = trades.reduce((a, t) => a + t.indexPoints, 0);
  const proxy = trades.reduce(
    (a, t) => a + t.indexPoints * rupeesPerPointForInstrument(t.instrumentId),
    0,
  );
  const opt = trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
  const est = trades.filter((t) => (t as { premiumEstimated?: boolean }).premiumEstimated).length;
  return {
    trades: trades.length,
    pts: Math.round(pts * 10) / 10,
    proxy: Math.round(proxy),
    option: Math.round(opt),
    est,
  };
}

function runBook(
  name: string,
  make: () => IManagedStrategy,
  nifty: Candle[],
  bank: Candle[],
  from: string,
  to: string,
) {
  const nStrat = make();
  nStrat.initialize();
  const bStrat = make();
  bStrat.initialize();

  const n = replayPaperOnIndex({
    instrumentId: 'nifty-50',
    instrumentName: 'Nifty 50',
    kind: 'nifty',
    candles: nifty,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    strategy: nStrat,
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
    strategy: bStrat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
  });

  const trades = enrichTradesWithOptionPremiums(
    [...n.trades, ...b.trades],
    new Map(),
    1,
  );
  const m = money(trades);
  const gap = m.option - m.proxy;
  console.log(
    `${name.padEnd(14)} ${from}→${to}  trades=${String(m.trades).padStart(3)}  Index₹=${String(m.proxy).padStart(8)}  Opt₹=${String(m.option).padStart(8)}  gap=${gap}  est=${m.est}/${m.trades}`,
  );
  return m;
}

const nifty = loadCandles('nifty-5m-2020-2026.json');
const bank = loadCandles('banknifty-5m-2020-2026.json');
const last = nifty[nifty.length - 1]!.date.slice(0, 10);
console.log(`Cache bars nifty=${nifty.length} bank=${bank.length} last=${last}`);
console.log('Expect: with all synthetic, Opt₹ MUST equal Index₹ (gap=0)\n');

const windows: Array<[string, string]> = [
  ['2026-07-01', last],
  ['2026-06-01', '2026-06-30'],
  ['2026-01-01', last],
];

for (const [from, to] of windows) {
  console.log(`--- ${from} → ${to} ---`);
  runBook('Trap', () => new SrTrapConfirmManagedStrategy(), nifty, bank, from, to);
  runBook('DonchRetest', () => new DonchRetestOrMid2rManagedStrategy(), nifty, bank, from, to);
  runBook('Genie', () => new AlignComboGenieManagedStrategy(), nifty, bank, from, to);
  console.log('');
}
