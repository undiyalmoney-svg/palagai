/** Jul–Aug window charge quality (Δ-option), same DNA set. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine.ts';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util.ts';
import { BOOK_LOT_SIZE, estimatedPremiumMove } from '../src/app/core/paper-desk/option-delta.util.ts';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util.ts';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy.ts';
import type { Candle } from '../src/app/core/models/candle.model.ts';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = '2026-07-01';
const TO = '2026-08-07';
const LIVE_DAY_LOCK_RS = 3000;
const OUT = resolve(ROOT, 'reports/option-profit-40k');
mkdirSync(OUT, { recursive: true });

type Dna = {
  id: string; piercePts: number; bankPiercePts: number; armRs: number; lockRs: number;
  givebackRs: number; maxTrades: number; dayStopPts: number; targetR: number;
};

function load(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'reports/analyst-cache', file), 'utf8')) as Array<{
    date: string; open: number; high: number; low: number; close: number; volume?: number;
  }>;
  return raw.map((c) => ({ date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
}

function tradeNet(t: PaperTrade) {
  const book = t.instrumentId.includes('bank') ? 'bank' : 'nifty';
  const lot = BOOK_LOT_SIZE[book];
  const dPrem = estimatedPremiumMove(t.indexPoints, t.instrumentId);
  const entry = 100;
  const exit = Math.max(0.05, entry + dPrem);
  const gross = dPrem * lot;
  const ch = estimateRoundTripCharges({ segment: 'nfo_option', entryPrice: entry, exitPrice: exit, quantity: lot }).totalRs;
  return { net: gross - ch, gross, ch };
}

function replay(kind: 'nifty' | 'banknifty', id: string, file: string, dna: Dna): PaperTrade[] {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(all.slice(Math.max(0, warm)), new Date(`${TO}T15:30:00+05:30`));
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  strat.updateSettings({
    dayStopPts: dna.dayStopPts, dayProfitLockPts: 0, maxTradesPerDay: dna.maxTrades, targetRMultiple: dna.targetR,
    extras: {
      piercePts: dna.piercePts, bankPiercePts: dna.bankPiercePts,
      profitLockArmRs: dna.armRs, profitLockLockRs: dna.lockRs, profitLockGivebackRs: dna.givebackRs,
      bounceOrPierceMult: 0, bounceOrPierceCap: 0, slConfirmCutoffEnabled: false, trapMode: 'both',
    },
  });
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
      day += tradeNet(t).net;
    }
  }
  return kept;
}

function analyze(trades: PaperTrade[]) {
  const dayTrades = new Map<string, number>();
  const dayNet = new Map<string, number>();
  let netSum = 0, chargesSum = 0, scrap = 0;
  for (const t of trades) {
    const { net, ch } = tradeNet(t);
    netSum += net; chargesSum += ch;
    const d = t.entryTime.slice(0, 10);
    dayTrades.set(d, (dayTrades.get(d) ?? 0) + 1);
    dayNet.set(d, (dayNet.get(d) ?? 0) + net);
    if (net < 100) scrap += 1;
  }
  const days = [...dayNet.values()];
  const tpd = [...dayTrades.values()];
  return {
    trades: trades.length,
    days: days.length,
    netSum: Math.round(netSum),
    chargesSum: Math.round(chargesSum),
    avgDay: days.length ? Math.round(netSum / days.length) : 0,
    avgTrade: trades.length ? Math.round(netSum / trades.length) : 0,
    avgTpd: tpd.length ? +(tpd.reduce((a,b)=>a+b,0)/tpd.length).toFixed(2) : 0,
    maxTpd: tpd.length ? Math.max(...tpd) : 0,
    scrap,
  };
}

const candidates: Dna[] = [
  { id: 'shipped_max5', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 5, dayStopPts: 60, targetR: 3.5 },
  { id: 'max3_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 3, dayStopPts: 60, targetR: 3.5 },
  { id: 'max2_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 2, dayStopPts: 60, targetR: 3.5 },
  { id: 'baseline_max3', piercePts: 15, bankPiercePts: 30, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 3, dayStopPts: 60, targetR: 2 },
];

const rows = [];
for (const dna of candidates) {
  const trades = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', dna),
    ...replay('banknifty', 'banknifty', 'banknifty-5m-2020-2026.json', dna),
  ];
  const raw = analyze(trades);
  const live = analyze(applyLiveDayLock(trades, LIVE_DAY_LOCK_RS));
  rows.push({ id: dna.id, raw, live });
  console.log(`${dna.id.padEnd(14)} raw₹${String(raw.netSum).padStart(6)} tpd ${raw.avgTpd} max ${raw.maxTpd} scrap ${raw.scrap} | live₹${String(live.netSum).padStart(6)} tpd ${live.avgTpd} max ${live.maxTpd} ₹/tr ${live.avgTrade} chg ${live.chargesSum}`);
}
writeFileSync(resolve(OUT, 'charge-trade-quality-2026-07-01_2026-08-07.json'), JSON.stringify({ rows }, null, 2));
