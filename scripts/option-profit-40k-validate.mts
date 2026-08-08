/**
 * Validate top DNA candidates on longer Δ-option window + Live-shaped ₹3k day lock.
 *   npx tsx scripts/option-profit-40k-validate.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import {
  BOOK_LOT_SIZE,
  estimatedPremiumMove,
} from '../src/app/core/paper-desk/option-delta.util';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import type { Candle } from '../src/app/core/models/candle.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = '2026-01-01';
const TO = '2026-08-07';
const OUT = resolve(ROOT, 'reports/option-profit-40k');
mkdirSync(OUT, { recursive: true });
const LIVE_DAY_LOCK_RS = 3000;

type Dna = {
  id: string;
  piercePts: number;
  bankPiercePts: number;
  armRs: number;
  lockRs: number;
  givebackRs: number;
  maxTrades: number;
  dayStopPts: number;
  targetR: number;
};

function load(file: string): Candle[] {
  const raw = JSON.parse(
    readFileSync(resolve(ROOT, 'reports/analyst-cache', file), 'utf8'),
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

function deltaOptNet(indexPoints: number, instrumentId: string): number {
  const book = instrumentId.includes('bank') ? 'bank' : 'nifty';
  const lot = BOOK_LOT_SIZE[book];
  const dPrem = estimatedPremiumMove(indexPoints, instrumentId);
  const entry = 100;
  const exit = Math.max(0.05, entry + dPrem);
  const gross = dPrem * lot;
  const ch = estimateRoundTripCharges({
    segment: 'nfo_option',
    entryPrice: entry,
    exitPrice: exit,
    quantity: lot,
  }).totalRs;
  return gross - ch;
}

function replay(
  kind: 'nifty' | 'banknifty',
  id: string,
  file: string,
  dna: Dna,
): PaperTrade[] {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(
    all.slice(Math.max(0, warm)),
    new Date(`${TO}T15:30:00+05:30`),
  );
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  strat.updateSettings({
    dayStopPts: dna.dayStopPts,
    dayProfitLockPts: 0,
    maxTradesPerDay: dna.maxTrades,
    targetRMultiple: dna.targetR,
    extras: {
      piercePts: dna.piercePts,
      bankPiercePts: dna.bankPiercePts,
      profitLockArmRs: dna.armRs,
      profitLockLockRs: dna.lockRs,
      profitLockGivebackRs: dna.givebackRs,
      bounceOrPierceMult: 0,
      bounceOrPierceCap: 0,
      slConfirmCutoffEnabled: false,
      trapMode: 'both',
    },
  });
  return replayPaperOnIndex({
    instrumentId: id,
    instrumentName: id,
    kind,
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
  }).trades;
}

/** Simulate Live: after combined day option ₹ ≥ lock, drop later trades that day. */
function applyLiveDayLock(trades: PaperTrade[], lockRs: number): PaperTrade[] {
  const byDay = new Map<string, PaperTrade[]>();
  for (const t of [...trades].sort((a, b) => a.entryTime.localeCompare(b.entryTime))) {
    const d = t.entryTime.slice(0, 10);
    const list = byDay.get(d) ?? [];
    list.push(t);
    byDay.set(d, list);
  }
  const kept: PaperTrade[] = [];
  for (const [, list] of byDay) {
    let day = 0;
    for (const t of list) {
      if (day >= lockRs) break;
      kept.push(t);
      day += deltaOptNet(t.indexPoints, t.instrumentId);
    }
  }
  return kept;
}

function score(trades: PaperTrade[]) {
  const day = new Map<string, number>();
  let sum = 0;
  for (const t of trades) {
    const v = deltaOptNet(t.indexPoints, t.instrumentId);
    sum += v;
    const d = t.entryTime.slice(0, 10);
    day.set(d, (day.get(d) ?? 0) + v);
  }
  const vals = [...day.values()];
  const green = vals.filter((x) => x > 0).length;
  const red = vals.filter((x) => x < 0).length;
  return {
    trades: trades.length,
    optSum: Math.round(sum),
    days: vals.length,
    green,
    red,
    greenPct: vals.length ? Math.round((100 * green) / vals.length) : 0,
    worst: vals.length ? Math.round(Math.min(...vals)) : 0,
    avgDay: vals.length ? Math.round(sum / vals.length) : 0,
  };
}

const candidates: Dna[] = [
  {
    id: 'baseline_peak100_max3_rr2',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 3,
    dayStopPts: 60,
    targetR: 2,
  },
  {
    id: 'max5',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 5,
    dayStopPts: 60,
    targetR: 2,
  },
  {
    id: 'max8',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 8,
    dayStopPts: 60,
    targetR: 2,
  },
  {
    id: 'rr35',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 3,
    dayStopPts: 60,
    targetR: 3.5,
  },
  {
    id: 'max5_rr35',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 5,
    dayStopPts: 60,
    targetR: 3.5,
  },
  {
    id: 'tight_lock',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 80,
    givebackRs: 40,
    maxTrades: 3,
    dayStopPts: 60,
    targetR: 2,
  },
  {
    id: 'pierce20_40_max5_rr35',
    piercePts: 20,
    bankPiercePts: 40,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 5,
    dayStopPts: 60,
    targetR: 3.5,
  },
];

const rows = [];
for (const dna of candidates) {
  const trades = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', dna),
    ...replay('banknifty', 'banknifty', 'banknifty-5m-2020-2026.json', dna),
  ];
  const raw = score(trades);
  const lockedLive = score(applyLiveDayLock(trades, LIVE_DAY_LOCK_RS));
  const row = {
    id: dna.id,
    dna,
    raw,
    liveDayLock3k: lockedLive,
    score: lockedLive.optSum + lockedLive.greenPct * 80 + Math.min(0, lockedLive.worst),
  };
  rows.push(row);
  console.log(
    `${dna.id.padEnd(28)} rawΔ₹${String(raw.optSum).padStart(7)} (${raw.greenPct}%g)  ` +
      `liveLockΔ₹${String(lockedLive.optSum).padStart(7)} (${lockedLive.greenPct}%g worst ${lockedLive.worst})`,
  );
}
rows.sort((a, b) => b.score - a.score);
console.log('\nTOP (Live-shaped ₹3k day lock on Δ-option Jan–Aug):');
for (const r of rows.slice(0, 5)) {
  console.log(
    `  ${r.id}  liveLock₹${r.liveDayLock3k.optSum}  green ${r.liveDayLock3k.greenPct}%  worst ${r.liveDayLock3k.worst}`,
  );
}
writeFileSync(resolve(OUT, `validate-${FROM}_${TO}.json`), JSON.stringify({ rows }, null, 2));
console.log('Wrote validate json');
