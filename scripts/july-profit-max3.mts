/** July 2026 profit under shipped Trap DNA (pierce20 · max3 · 3.5R). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine.ts';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util.ts';
import { BOOK_LOT_SIZE, estimatedPremiumMove } from '../src/app/core/paper-desk/option-delta.util.ts';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util.ts';
import { researchLockedByMonth } from '../src/app/core/paper-desk/research-locked-pnl.util.ts';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy.ts';
import type { Candle } from '../src/app/core/models/candle.model.ts';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = '2026-07-01';
const TO = '2026-07-31';
const LIVE_DAY_LOCK_RS = 3000;

function load(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'reports/analyst-cache', file), 'utf8')) as Array<{
    date: string; open: number; high: number; low: number; close: number; volume?: number;
  }>;
  return raw.map((c) => ({
    date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
  }));
}

function deltaNet(t: PaperTrade) {
  const book = t.instrumentId.includes('bank') ? 'bank' : 'nifty';
  const lot = BOOK_LOT_SIZE[book];
  const dPrem = estimatedPremiumMove(t.indexPoints, t.instrumentId);
  const entry = 100;
  const exit = Math.max(0.05, entry + dPrem);
  const gross = dPrem * lot;
  const ch = estimateRoundTripCharges({
    segment: 'nfo_option', entryPrice: entry, exitPrice: exit, quantity: lot,
  }).totalRs;
  return { net: gross - ch, ch, gross };
}

function replay(kind: 'nifty' | 'banknifty', id: string, file: string): PaperTrade[] {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(all.slice(Math.max(0, warm)), new Date(`${TO}T15:30:00+05:30`));
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  strat.updateSettings({ dayStopPts: 60, dayProfitLockPts: 0 });
  return replayPaperOnIndex({
    instrumentId: id, instrumentName: id, kind, candles, fromDate: FROM, toDate: TO,
    instruments: [], optionCandlesByToken: new Map(), neededOptionTokens: new Set(),
    strategy: strat, forceCloseOpen: true, lotsMultiplier: 1, enableKutty: false,
  }).trades;
}

function applyLiveDayLock(trades: PaperTrade[], lockRs: number): PaperTrade[] {
  const byDay = new Map<string, PaperTrade[]>();
  for (const t of [...trades].sort((a, b) => a.entryTime.localeCompare(b.entryTime))) {
    const d = t.entryTime.slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(t);
  }
  const kept: PaperTrade[] = [];
  for (const [, list] of byDay) {
    let day = 0;
    for (const t of list) {
      if (day >= lockRs) break;
      kept.push(t);
      day += deltaNet(t).net;
    }
  }
  return kept;
}

const trades = [
  ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json'),
  ...replay('banknifty', 'banknifty', 'banknifty-5m-2020-2026.json'),
];
const live = applyLiveDayLock(trades, LIVE_DAY_LOCK_RS);
const day = new Map<string, number>();
let net = 0, ch = 0;
for (const t of live) {
  const x = deltaNet(t);
  net += x.net; ch += x.ch;
  const d = t.entryTime.slice(0, 10);
  day.set(d, (day.get(d) ?? 0) + x.net);
}
const locked = researchLockedByMonth(trades, { toDate: TO });
const days = [...day.values()];
console.log(JSON.stringify({
  month: '2026-07',
  dna: 'pierce20/B40 · peak₹100 · max3 · 3.5R · N1/B1 ₹40k',
  optionNetAfterChargesLiveLock3k: Math.round(net),
  chargesEst: Math.round(ch),
  trades: live.length,
  tradingDays: days.length,
  avgDay: days.length ? Math.round(net / days.length) : 0,
  greenDays: days.filter((v) => v > 0).length,
  worstDay: days.length ? Math.round(Math.min(...days)) : 0,
  bestDay: days.length ? Math.round(Math.max(...days)) : 0,
  lockedSideMeterIndexProxy: locked['2026-07'] ?? null,
  note: 'Option ₹ = Live money path. Locked = research side meter only (not Live forecast).',
}, null, 2));
