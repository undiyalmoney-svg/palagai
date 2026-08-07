/**
 * Assert Paper Trap DNA reproduces the published Locked monthly table.
 *
 *   npx tsx scripts/desk-locked-monthly.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import { researchLockedByMonth } from '../src/app/core/paper-desk/research-locked-pnl.util';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import type { Candle } from '../src/app/core/models/candle.model';

const TARGET: Record<string, number> = {
  '2026-01': 53474,
  '2026-02': 56229,
  '2026-03': 45835,
  '2026-04': 47878,
  '2026-05': 47122,
  '2026-06': 57159,
  '2026-07': 65041,
  '2026-08': 14545,
};

function load(file: string): Candle[] {
  const raw = JSON.parse(
    readFileSync(resolve('reports/analyst-cache', file), 'utf8'),
  ) as Array<{
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

function run(kind: 'nifty' | 'banknifty', id: string, file: string) {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(
    all.slice(Math.max(0, warm)),
    new Date('2026-08-07T15:30:00+05:30'),
  );
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  const x = strat.getSettings().extras ?? {};
  if (Number(x['bounceOrPierceMult'] ?? 0) !== 0) {
    throw new Error(
      `DNA drift: bounceOrPierceMult=${x['bounceOrPierceMult']} (must be 0 for Locked table)`,
    );
  }
  strat.updateSettings({
    dayStopPts: 60,
    dayProfitLockPts: 0,
    maxTradesPerDay: 3,
    targetRMultiple: 2,
  });
  return replayPaperOnIndex({
    instrumentId: id,
    instrumentName: id,
    kind,
    candles,
    fromDate: '2026-01-01',
    toDate: '2026-08-07',
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
  }).trades;
}

const nifty = run('nifty', 'nifty', 'nifty-5m-2020-2026.json');
const bank = run('banknifty', 'banknifty', 'banknifty-5m-2020-2026.json');
const by = researchLockedByMonth([...nifty, ...bank], { toDate: '2026-08-07' });

console.log('Month        Got      Target   Δ');
let ok = true;
for (const [m, t] of Object.entries(TARGET)) {
  const g = by[m] ?? 0;
  const d = g - t;
  if (Math.abs(d) > 0) ok = false;
  console.log(
    `${m}  ${String(g).padStart(8)}  ${String(t).padStart(8)}  ${String(d).padStart(6)} ${Math.abs(d) === 0 ? '✓' : 'FAIL'}`,
  );
}
if (!ok) {
  console.error('\nLOCKED MONTHLY MISMATCH — Paper DNA ≠ published table');
  process.exit(1);
}
console.log('\nLOCKED MONTHLY MATCH — Jul ₹65,041 and all months OK');
