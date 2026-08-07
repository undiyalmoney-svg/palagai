/**
 * How much of the modelled edge survives real execution?
 *
 * The desk only sees a 5m bar once it closes, so it can act no earlier than the
 * NEXT bar's open. Stops and targets are resting exchange orders and still fire
 * intrabar. This re-prices every replay trade under that rule and compares.
 *
 * Also sweeps the peak-trail (profitLockArmRs), because a trail that fires
 * inside one bar produces trades too short to execute at all.
 *
 *   npx tsx scripts/execution-realism-study.mts [days]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../src/app/core/paper-desk/option-delta.util';
import type { Candle } from '../src/app/core/models/candle.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const CACHE = resolve(import.meta.dirname, '..', 'reports/analyst-cache');
const DAYS = Number(process.argv[2] ?? 180);

function load(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(resolve(CACHE, file), 'utf8')) as Candle[];
  return raw.map((c) => ({ ...c, volume: c.volume ?? 0 }));
}

const day = (ts: string) => ts.replace('T', ' ').slice(0, 10);

/** Resting SL/TP fire intrabar; anything the desk decides needs the next bar. */
function isRestingExit(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes('stop loss') || r.includes('target');
}

interface Repriced {
  modelledPts: number;
  realPts: number;
  bars: number;
  executable: boolean;
}

/** Re-price one trade with next-bar-open entry and (for decided exits) next-bar-open exit. */
function reprice(t: PaperTrade, byTime: Map<string, number>, candles: Candle[]): Repriced {
  const ei = byTime.get(t.entryTime);
  const xi = byTime.get(t.exitTime);
  const modelledPts = t.indexPoints;
  if (ei == null || xi == null) {
    return { modelledPts, realPts: modelledPts, bars: 0, executable: false };
  }
  const bars = xi - ei;
  const fillEntry = candles[ei + 1];
  if (!fillEntry) {
    return { modelledPts, realPts: 0, bars, executable: false };
  }
  const entryPx = fillEntry.open;

  let exitPx: number;
  if (isRestingExit(t.exitReason)) {
    // Stop/target sits at the exchange. It can only fire on or after our entry bar.
    if (xi < ei + 1) {
      // Trade was already over before we could get in.
      return { modelledPts, realPts: 0, bars, executable: false };
    }
    exitPx = t.indexExit;
  } else {
    const fillExit = candles[xi + 1];
    if (!fillExit) {
      return { modelledPts, realPts: 0, bars, executable: false };
    }
    if (xi + 1 <= ei + 1) {
      // Decided exit lands on the same bar we entered → nothing to hold.
      return { modelledPts, realPts: 0, bars, executable: false };
    }
    exitPx = fillExit.open;
  }

  const realPts = t.direction === 'BUY' ? exitPx - entryPx : entryPx - exitPx;
  return { modelledPts, realPts, bars, executable: true };
}

function optionRs(pts: number, book: 'nifty' | 'bank'): number {
  return pts * ATM_OPTION_DELTA[book] * BOOK_LOT_SIZE[book];
}

/** Round-trip cost for one option leg — brokerage, STT, exchange, GST, stamp. */
function chargesRs(book: 'nifty' | 'bank', premium: number): number {
  const qty = BOOK_LOT_SIZE[book];
  const turnover = premium * qty;
  const brokerage = 40; // ₹20 per executed order
  const stt = turnover * 0.001; // sell side
  const exch = turnover * 2 * 0.0005;
  const sebi = turnover * 2 * 0.000001;
  const stamp = turnover * 0.00003;
  const gst = (brokerage + exch + sebi) * 0.18;
  return brokerage + stt + exch + sebi + stamp + gst;
}

/** Typical ATM premium, used only to size charges. */
const TYPICAL_PREMIUM = { nifty: 130, bank: 600 } as const;

function run(
  label: string,
  book: 'nifty' | 'bank',
  instrumentId: string,
  kind: 'nifty' | 'banknifty',
  candles: Candle[],
  from: string,
  to: string,
  armRs: number,
  overrides: { maxTradesPerDay?: number; targetRMultiple?: number; piercePts?: number } = {},
): void {
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize({
    maxTradesPerDay: overrides.maxTradesPerDay ?? 0,
    targetRMultiple: overrides.targetRMultiple ?? 2,
    extras: {
      ...strat.defaultSettings.extras,
      profitLockArmRs: armRs,
      profitLockLockRs: armRs > 0 ? Math.round(armRs / 2) : 0,
      profitLockGivebackRs: armRs > 0 ? Math.round(armRs / 2) : 0,
      ...(overrides.piercePts != null
        ? { piercePts: overrides.piercePts, bankPiercePts: overrides.piercePts * 2 }
        : {}),
    },
  });
  const out = replayPaperOnIndex({
    instrumentId,
    instrumentName: book,
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

  const byTime = new Map<string, number>();
  candles.forEach((c, i) => byTime.set(c.date, i));

  let modelled = 0;
  let real = 0;
  let oneBar = 0;
  let unexecutable = 0;
  let realWins = 0;
  let realLosses = 0;
  const days = new Set<string>();

  for (const t of out.trades) {
    const r = reprice(t, byTime, candles);
    modelled += r.modelledPts;
    days.add(day(t.entryTime));
    if (r.bars <= 1) oneBar += 1;
    if (!r.executable) {
      unexecutable += 1;
      continue;
    }
    real += r.realPts;
    if (r.realPts > 0) realWins += 1;
    else if (r.realPts < 0) realLosses += 1;
  }

  const n = out.trades.length;
  const executed = realWins + realLosses;
  const grossRs = optionRs(real, book);
  const costRs = executed * chargesRs(book, TYPICAL_PREMIUM[book]);
  const netRs = grossRs - costRs;
  const perDay = days.size ? netRs / days.size : 0;
  const pct = (x: number) => (n ? ((x / n) * 100).toFixed(0) + '%' : '—');
  console.log(
    `${label.padEnd(30)} n${String(n).padStart(5)} 1bar${pct(oneBar).padStart(4)} ` +
      `model ₹${optionRs(modelled, book).toFixed(0).padStart(7)} ` +
      `gross ₹${grossRs.toFixed(0).padStart(7)} ` +
      `cost ₹${costRs.toFixed(0).padStart(6)} ` +
      `NET ₹${netRs.toFixed(0).padStart(8)} ` +
      `(₹${perDay.toFixed(0).padStart(5)}/day) W/L ${realWins}/${realLosses}`,
  );
}

const nifty = load('nifty-5m-2020-2026.json');
const bank = load('banknifty-5m-2020-2026.json');
const allDays = [...new Set(nifty.map((c) => day(c.date)))].sort();
const from = allDays[Math.max(0, allDays.length - DAYS)]!;
const to = allDays.at(-1)!;

console.log(`Execution realism · ${from} → ${to} (${DAYS} trading days) · 1 lot`);
console.log(
  'modelled = replay fills at signal levels · REAL = next-bar-open entry, resting SL/TP intrabar\n',
);

const CASES: Array<{
  tag: string;
  arm: number;
  o?: { maxTradesPerDay?: number; targetRMultiple?: number; piercePts?: number };
}> = [
  { tag: 'arm400 (current)', arm: 400 },
  { tag: 'arm400 max2/day', arm: 400, o: { maxTradesPerDay: 2 } },
  { tag: 'arm400 max1/day', arm: 400, o: { maxTradesPerDay: 1 } },
  { tag: 'arm400 pierce30', arm: 400, o: { piercePts: 30 } },
  { tag: 'arm400 pierce30 max2', arm: 400, o: { piercePts: 30, maxTradesPerDay: 2 } },
  { tag: 'arm400 RR3', arm: 400, o: { targetRMultiple: 3 } },
];

for (const c of CASES) {
  run(`Nifty ${c.tag}`, 'nifty', 'nifty-50', 'nifty', nifty, from, to, c.arm, c.o);
  run(`Bank  ${c.tag}`, 'bank', 'bank-nifty', 'banknifty', bank, from, to, c.arm, c.o);
  console.log('');
}
