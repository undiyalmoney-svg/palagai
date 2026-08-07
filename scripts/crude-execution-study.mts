/**
 * Crude under real execution — does it trade enough, and does it net money?
 *
 * Same rule as the index study: entry at next-bar open, resting SL/TP intrabar.
 * Crude holds far longer than the index books, so lag should cost much less.
 *
 *   npx tsx scripts/crude-execution-study.mts [days]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnCrude } from '../src/app/core/paper-desk/crude-paper-engine';
import {
  CRUDE_STRATEGY_PROFILES,
  resolveCrudeStrategyProfile,
  type CrudeTradeParams,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../src/app/core/paper-desk/option-delta.util';
import type { Candle } from '../src/app/core/models/candle.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const CACHE = resolve(import.meta.dirname, '..', 'reports/analyst-cache');
const DAYS = Number(process.argv[2] ?? 180);

const raw = JSON.parse(
  readFileSync(resolve(CACHE, 'crudeoilm-5m-merged.json'), 'utf8'),
) as Candle[];
const candles: Candle[] = raw.map((c) => ({ ...c, volume: c.volume ?? 0 }));
const day = (ts: string) => ts.replace('T', ' ').slice(0, 10);

const allDays = [...new Set(candles.map((c) => day(c.date)))].sort();
const from = allDays[Math.max(0, allDays.length - DAYS)]!;
const to = allDays.at(-1)!;

const byTime = new Map<string, number>();
candles.forEach((c, i) => byTime.set(c.date, i));

function isRestingExit(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes('stop loss') || r.includes('target');
}

/** MCX option round-trip cost (no STT on MCX options; higher exchange fee). */
function chargesRs(premium: number): number {
  const qty = BOOK_LOT_SIZE.crude;
  const turnover = premium * qty;
  const brokerage = 40;
  const exch = turnover * 2 * 0.0005;
  const ctt = turnover * 0.0005;
  const gst = (brokerage + exch) * 0.18;
  return brokerage + exch + ctt + gst;
}
const TYPICAL_PREMIUM = 300;

function repriceAll(trades: PaperTrade[]): {
  modelledPts: number;
  realPts: number;
  executed: number;
  wins: number;
  losses: number;
  oneBar: number;
  medianBars: number;
} {
  let modelledPts = 0;
  let realPts = 0;
  let executed = 0;
  let wins = 0;
  let losses = 0;
  let oneBar = 0;
  const barsList: number[] = [];

  for (const t of trades) {
    modelledPts += t.indexPoints;
    const ei = byTime.get(t.entryTime);
    const xi = byTime.get(t.exitTime);
    if (ei == null || xi == null) continue;
    const bars = xi - ei;
    barsList.push(bars);
    if (bars <= 1) oneBar += 1;
    const fillEntry = candles[ei + 1];
    if (!fillEntry) continue;
    const entryPx = fillEntry.open;
    let exitPx: number;
    if (isRestingExit(t.exitReason)) {
      if (xi < ei + 1) continue;
      exitPx = t.indexExit;
    } else {
      const fillExit = candles[xi + 1];
      if (!fillExit || xi + 1 <= ei + 1) continue;
      exitPx = fillExit.open;
    }
    const pts = t.direction === 'BUY' ? exitPx - entryPx : entryPx - exitPx;
    realPts += pts;
    executed += 1;
    if (pts > 0) wins += 1;
    else if (pts < 0) losses += 1;
  }
  barsList.sort((a, b) => a - b);
  return {
    modelledPts,
    realPts,
    executed,
    wins,
    losses,
    oneBar,
    medianBars: barsList[Math.floor(barsList.length / 2)] ?? 0,
  };
}

function run(label: string, params: CrudeTradeParams): void {
  const out = replayPaperOnCrude({
    instrumentId: 'crude-oil-mini',
    instrumentName: 'Crude Oil Mini',
    candles,
    fromDate: from,
    toDate: to,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableMorning: params.defaultEnableMorning,
    enableEvening: params.defaultEnableEvening,
    tradeParams: params,
    dayLossStopPts: params.dayLossStopPts,
  });
  const r = repriceAll(out.trades);
  const tradedDays = new Set(out.trades.map((t) => day(t.entryTime))).size;
  const optRs = (pts: number) => pts * ATM_OPTION_DELTA.crude * BOOK_LOT_SIZE.crude;
  const gross = optRs(r.realPts);
  const cost = r.executed * chargesRs(TYPICAL_PREMIUM);
  const net = gross - cost;
  console.log(
    `${label.padEnd(34)} n${String(out.trades.length).padStart(4)} ` +
      `days${String(tradedDays).padStart(4)}/${allDays.filter((d) => d >= from).length} ` +
      `medBars${String(r.medianBars).padStart(3)} ` +
      `model ₹${optRs(r.modelledPts).toFixed(0).padStart(7)} ` +
      `gross ₹${gross.toFixed(0).padStart(7)} ` +
      `cost ₹${cost.toFixed(0).padStart(6)} ` +
      `NET ₹${net.toFixed(0).padStart(8)} ` +
      `(₹${(net / Math.max(1, tradedDays)).toFixed(0).padStart(5)}/traded day) W/L ${r.wins}/${r.losses}`,
  );
}

console.log(`Crude execution realism · ${from} → ${to} · 1 lot (₹10/pt, lot 10)\n`);

const sel = resolveCrudeStrategyProfile('selective');
run('Selective (current desk DNA)', sel);

// Looser trap = more setups. Pierce widens the trap band.
for (const pierce of [10, 20, 40]) {
  run(`Selective pierce${pierce}`, { ...sel, piercePts: pierce });
}
// Confirm off = take the trap without the follow-through bar.
run('Selective no-confirm', { ...sel, requireConfirm: false });
// Wider stop / bigger target variants.
run('Selective SL80/TP240', { ...sel, stopPts: 80, morningTargetPts: 240, eveningTargetPts: 240 });
run('Selective SL30/TP120', { ...sel, stopPts: 30, morningTargetPts: 120, eveningTargetPts: 120 });
// Morning session on as well as evening.
run('Selective + morning', { ...sel, defaultEnableMorning: true });

for (const id of ['all-green', 'daily-profit', 'champion', 'daily-income', 'trap-confirm'] as const) {
  run(`profile: ${id}`, CRUDE_STRATEGY_PROFILES[id]);
}
