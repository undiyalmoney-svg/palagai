/**
 * Charge-aware trade quality for current DNA vs fewer-trade caps.
 * Uses analyst cache + Δ-option net (charges already in deltaOptNet).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine.ts';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util.ts';
import {
  BOOK_LOT_SIZE,
  estimatedPremiumMove,
} from '../src/app/core/paper-desk/option-delta.util.ts';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util.ts';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy.ts';
import type { Candle } from '../src/app/core/models/candle.model.ts';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = '2026-01-01';
const TO = '2026-08-07';
const LIVE_DAY_LOCK_RS = 3000;
const OUT = resolve(ROOT, 'reports/option-profit-40k');
mkdirSync(OUT, { recursive: true });

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
  ) as Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number }>;
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
  return { net: gross - ch, gross, ch, lot };
}

function tradeNet(t: PaperTrade) {
  return deltaOptNet(t.indexPoints, t.instrumentId);
}

function replay(kind: 'nifty' | 'banknifty', id: string, file: string, dna: Dna): PaperTrade[] {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(all.slice(Math.max(0, warm)), new Date(`${TO}T15:30:00+05:30`));
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
      day += tradeNet(t).net;
    }
  }
  return kept;
}

function analyze(trades: PaperTrade[]) {
  const dayTrades = new Map<string, number>();
  const dayNet = new Map<string, number>();
  let netSum = 0;
  let grossSum = 0;
  let chargesSum = 0;
  let scrap = 0; // net < 100 after charges
  let scrapNet = 0;
  let lossTrades = 0;
  for (const t of trades) {
    const { net, gross, ch } = tradeNet(t);
    netSum += net;
    grossSum += gross;
    chargesSum += ch;
    const d = t.entryTime.slice(0, 10);
    dayTrades.set(d, (dayTrades.get(d) ?? 0) + 1);
    dayNet.set(d, (dayNet.get(d) ?? 0) + net);
    if (net < 100) {
      scrap += 1;
      scrapNet += net;
    }
    if (net < 0) lossTrades += 1;
  }
  const days = [...dayNet.values()];
  const tpd = [...dayTrades.values()];
  const green = days.filter((v) => v > 0).length;
  return {
    trades: trades.length,
    days: days.length,
    netSum: Math.round(netSum),
    grossSum: Math.round(grossSum),
    chargesSum: Math.round(chargesSum),
    avgDay: days.length ? Math.round(netSum / days.length) : 0,
    avgTrade: trades.length ? Math.round(netSum / trades.length) : 0,
    avgTpd: tpd.length ? +(tpd.reduce((a, b) => a + b, 0) / tpd.length).toFixed(2) : 0,
    maxTpd: tpd.length ? Math.max(...tpd) : 0,
    greenPct: days.length ? Math.round((100 * green) / days.length) : 0,
    worstDay: days.length ? Math.round(Math.min(...days)) : 0,
    scrapTrades: scrap,
    scrapNet: Math.round(scrapNet),
    lossTrades,
    // net after removing scrap (diagnostic)
    netIfDropScrap: Math.round(netSum - scrapNet),
  };
}

const candidates: Dna[] = [
  { id: 'shipped_max5_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 5, dayStopPts: 60, targetR: 3.5 },
  { id: 'pierce20_max3_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 3, dayStopPts: 60, targetR: 3.5 },
  { id: 'pierce20_max2_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 2, dayStopPts: 60, targetR: 3.5 },
  { id: 'pierce20_max4_rr35', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 4, dayStopPts: 60, targetR: 3.5 },
  { id: 'baseline_max3_rr2', piercePts: 15, bankPiercePts: 30, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 3, dayStopPts: 60, targetR: 2 },
  { id: 'pierce20_max3_rr2', piercePts: 20, bankPiercePts: 40, armRs: 100, lockRs: 50, givebackRs: 50, maxTrades: 3, dayStopPts: 60, targetR: 2 },
];

const rows = [];
for (const dna of candidates) {
  const trades = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', dna),
    ...replay('banknifty', 'banknifty', 'banknifty-5m-2020-2026.json', dna),
  ];
  const raw = analyze(trades);
  const live = analyze(applyLiveDayLock(trades, LIVE_DAY_LOCK_RS));
  // Prefer high net, low scrap, reasonable tpd. Penalize scrap + high trade count.
  const score =
    live.netSum +
    live.greenPct * 50 +
    Math.min(0, live.worstDay) -
    live.scrapTrades * 80 -
    Math.max(0, live.avgTpd - 4) * 2000;
  rows.push({ id: dna.id, dna, raw, live, score });
  console.log(
    `${dna.id.padEnd(22)} liveNet₹${String(live.netSum).padStart(7)} avgT₹${String(live.avgTrade).padStart(4)} ` +
      `tpd ${String(live.avgTpd).padStart(4)} maxTpd ${String(live.maxTpd).padStart(2)} ` +
      `scrap ${String(live.scrapTrades).padStart(3)} chg₹${String(live.chargesSum).padStart(6)} ` +
      `trades ${live.trades}`,
  );
}
rows.sort((a, b) => b.score - a.score);
console.log('\nTOP by charge-aware fewer-trade score:');
for (const r of rows) {
  console.log(
    `  ${r.id.padEnd(22)} score ${Math.round(r.score)}  net₹${r.live.netSum}  tpd ${r.live.avgTpd}  scrap ${r.live.scrapTrades}  ₹/tr ${r.live.avgTrade}`,
  );
}
writeFileSync(resolve(OUT, 'charge-trade-quality-2026-01-01_2026-08-07.json'), JSON.stringify({ rows }, null, 2));
console.log('wrote report');
