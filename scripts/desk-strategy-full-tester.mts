/**
 * Full Trade Desk strategy tester — do NOT trust the UI totals.
 *
 * Replays Trap all-day-green DNA on closed 5m bars from analyst cache
 * (Kite hist for "yesterday" is often empty right after midnight IST),
 * applies the same day-lock / day-stop the desk uses, then checks
 * executable fills vs the old next-open bug that painted −₹33 days.
 *
 *   npx tsx scripts/desk-strategy-full-tester.mts [YYYY-MM-DD]
 *
 * Optional: when `.kite-auth` works and Kite has option bars for DAY,
 * also attaches real ATM PE/CE OHLC and prints option net.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import {
  buildBarIndex,
  isRestingExit,
  repriceTradesToExecutableFills,
} from '../src/app/core/paper-desk/executable-fill.util';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import {
  buildIndexDeskRiskSettings,
  rupeesPerPointForInstrument,
} from '../src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util';
import {
  resolveAtmWeeklyOption,
  type IndexOptionKind,
} from '../src/app/core/utils/option-chain.util';
import type { Candle } from '../src/app/core/models/candle.model';
import type { Instrument } from '../src/app/core/models/instrument.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

const ROOT = resolve(import.meta.dirname, '..');
const DAY = process.argv[2] ?? '2026-08-07';
const OUT = resolve(ROOT, 'reports/desk-strategy-tester');
mkdirSync(OUT, { recursive: true });

const LOT = { nifty: 65, bank: 30 } as const;

function loadCache(file: string): Candle[] {
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

function atmStrike(spot: number, kind: IndexOptionKind): number {
  const step = kind === 'nifty' ? 50 : 100;
  return Math.round(spot / step) * step;
}

/** Pre-fix resting check — only hard SL / target. */
function oldIsResting(exitReason: string): boolean {
  const r = (exitReason ?? '').toLowerCase();
  return r.includes('stop loss') || r.includes('target');
}

function oldExecutablePts(
  trade: PaperTrade,
  idx: Map<string, number>,
  candles: readonly Candle[],
): number | null {
  const ei = idx.get(trade.entryTime);
  const xi = idx.get(trade.exitTime);
  if (ei == null || xi == null) return null;
  const entryBar = candles[ei + 1];
  if (!entryBar) return null;
  const entryPrice = entryBar.open;
  let exitPrice: number;
  if (oldIsResting(trade.exitReason)) {
    if (xi < ei + 1) return null;
    exitPrice = trade.indexExit;
  } else {
    const exitBar = candles[xi + 1];
    if (!exitBar || xi + 1 <= ei + 1) return null;
    exitPrice = exitBar.open;
  }
  return trade.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
}

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === ',' && !q) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

async function tryLoadNfo(): Promise<Instrument[]> {
  const authPath = resolve(ROOT, '.kite-auth');
  if (!existsSync(authPath)) return [];
  try {
    const AUTH_RAW = readFileSync(authPath, 'utf8').trim();
    const AUTH = AUTH_RAW.startsWith('token ') ? AUTH_RAW : `token ${AUTH_RAW}`;
    const csv = await (
      await fetch('https://api.kite.trade/instruments', {
        headers: { Authorization: AUTH, 'X-Kite-Version': '3' },
      })
    ).text();
    const out: Instrument[] = [];
    for (const line of csv.split('\n').slice(1)) {
      if (!line.trim()) continue;
      const p = parseCsvLine(line);
      // exchange is last field — lines end with ",NFO" (no trailing comma)
      if (p[11] !== 'NFO') continue;
      const name = p[3] ?? '';
      if (name !== 'NIFTY' && name !== 'BANKNIFTY') continue;
      const instrumentType = (p[9] ?? '').toUpperCase();
      if (instrumentType !== 'CE' && instrumentType !== 'PE') continue;
      if (!p[5] || !(+p[6]! > 0) || !(+p[0]! > 0)) continue;
      out.push({
        instrumentToken: +p[0]!,
        exchangeToken: +p[1]! || 0,
        tradingSymbol: p[2]!,
        name,
        lastPrice: 0,
        expiry: p[5]!,
        strike: +p[6]!,
        tickSize: 0.05,
        lotSize: +p[8]!,
        instrumentType: instrumentType as Instrument['instrumentType'],
        segment: p[10]!,
        exchange: 'NFO',
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function tryHist(
  token: number,
  from: string,
  to: string,
  auth: string,
): Promise<Candle[]> {
  const q = new URLSearchParams({ from, to });
  const res = await fetch(
    `https://api.kite.trade/instruments/historical/${token}/5minute?${q}`,
    { headers: { Authorization: auth, 'X-Kite-Version': '3' } },
  );
  const j = await res.json();
  if (j.status !== 'success' || !Array.isArray(j.data?.candles)) return [];
  return (j.data.candles as any[]).map((c) => ({
    date: String(c[0]).replace('T', ' ').slice(0, 19),
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4],
    volume: +c[5] || 0,
  }));
}

function premiumAt(bars: Candle[], time: string, field: 'open' | 'close'): number | null {
  const t = time.replace('T', ' ').slice(0, 16);
  const exact = bars.find((b) => b.date.replace('T', ' ').slice(0, 16) === t);
  if (exact) return exact[field];
  const hit = bars.find((b) => b.date.replace('T', ' ').slice(0, 16) >= t);
  return hit ? hit[field] : null;
}

type BookResult = {
  kind: IndexOptionKind;
  trades: PaperTrade[];
  executable: PaperTrade[];
  rows: Array<{
    entry: string;
    exit: string;
    atm: string;
    modelPts: number;
    modelRs: number;
    oldExecPts: number | null;
    newExecPts: number | null;
    flippedByOldBug: boolean;
    exitReason: string;
    optNet: number | null;
  }>;
};

async function runBook(
  kind: IndexOptionKind,
  instrumentId: string,
  instrumentName: string,
  cacheFile: string,
  instruments: Instrument[],
  auth: string | null,
): Promise<BookResult> {
  const all = loadCache(cacheFile);
  const warmFrom = all.findIndex((c) => c.date.startsWith('2026-07-01'));
  const candles = dropFormingBars(
    all.slice(Math.max(0, warmFrom)),
    new Date(`${DAY}T15:30:00+05:30`),
  );
  const dayBars = candles.filter((c) => c.date.startsWith(DAY));
  console.log(`\n======== ${instrumentName} · ${dayBars.length} bars on ${DAY} ========`);

  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  const risk = buildIndexDeskRiskSettings({
    instrumentId,
    enableNifty: true,
    enableBank: true,
    strictDayStop: true,
    dayProfitLock: true,
  });
  if (!risk?.dayStopPts || !risk.dayProfitLockPts) {
    throw new Error(`Desk risk missing for ${instrumentId}`);
  }
  strat.updateSettings({
    dayStopPts: risk.dayStopPts,
    dayProfitLockPts: risk.dayProfitLockPts,
  });
  const settings = strat.getSettings();
  console.log('DNA', {
    piercePts: settings.extras?.['piercePts'],
    bankPiercePts: settings.extras?.['bankPiercePts'],
    peakArm: settings.extras?.['profitLockArmRs'],
    peakLock: settings.extras?.['profitLockLockRs'],
    peakGb: settings.extras?.['profitLockGivebackRs'],
    maxTrades: settings.maxTradesPerDay,
    dayStopPts: settings.dayStopPts,
    dayProfitLockPts: settings.dayProfitLockPts,
    rr: settings.targetRMultiple,
  });

  // Index replay first (no chain) — strategy path must not depend on NFO CSV.
  const replay = replayPaperOnIndex({
    instrumentId,
    instrumentName,
    kind,
    candles,
    fromDate: DAY,
    toDate: DAY,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
  });

  // Optional real option OHLC when Kite has the day.
  const optMap = new Map<number, Candle[]>();
  let trades = replay.trades;
  if (auth && instruments.length) {
    const tokens = new Set<number>();
    for (const t of replay.trades) {
      try {
        const resolved = resolveAtmWeeklyOption({
          instruments,
          kind,
          direction: t.direction,
          spot: t.indexEntry,
          asOfDateTime: t.entryTime,
        });
        if (resolved.instrument.instrumentToken > 0) {
          tokens.add(resolved.instrument.instrumentToken);
        }
      } catch {
        /* chain gap — skip */
      }
    }
    for (const token of tokens) {
      await new Promise((r) => setTimeout(r, 250));
      const bars = await tryHist(token, `${DAY} 09:15:00`, `${DAY} 15:30:00`, auth);
      if (bars.length) optMap.set(token, bars);
    }
    console.log(`Kite option bars: ${optMap.size}/${tokens.size} tokens`);
    if (optMap.size) {
      const strat2 = new SrTrapConfirmManagedStrategy();
      strat2.initialize();
      strat2.updateSettings({
        dayStopPts: risk.dayStopPts,
        dayProfitLockPts: risk.dayProfitLockPts,
      });
      trades = replayPaperOnIndex({
        instrumentId,
        instrumentName,
        kind,
        candles,
        fromDate: DAY,
        toDate: DAY,
        instruments,
        optionCandlesByToken: optMap,
        neededOptionTokens: new Set(),
        strategy: strat2,
        forceCloseOpen: true,
        lotsMultiplier: 1,
        enableKutty: false,
      }).trades;
    }
  } else {
    console.log('Kite options skipped (no auth / no NFO)');
  }

  const idx = buildBarIndex(candles);
  const executable = repriceTradesToExecutableFills(
    trades,
    new Map([[instrumentId, candles]]),
  );
  const lot = kind === 'nifty' ? LOT.nifty : LOT.bank;
  const rs = rupeesPerPointForInstrument(instrumentId);

  const rows: BookResult['rows'] = [];
  for (const t of trades) {
    const oldPts = oldExecutablePts(t, idx, candles);
    const neu = executable.find(
      (e) => e.entryTime === t.entryTime && e.exitTime === t.exitTime,
    );
    const strike = atmStrike(t.indexEntry, kind);
    const optType = t.direction === 'SELL' ? 'PE' : 'CE';
    const flippedByOldBug = oldPts != null && t.indexPoints > 0 && oldPts < 0;

    let optNet: number | null = neu?.netOptionPnlRs ?? neu?.optionPnlRs ?? null;
    if (optNet == null && t.option?.instrumentToken && optMap.has(t.option.instrumentToken)) {
      const bars = optMap.get(t.option.instrumentToken)!;
      const ei = idx.get(t.entryTime);
      const fillEntry = ei != null && candles[ei + 1] ? candles[ei + 1]!.date : t.entryTime;
      const fillExit = isRestingExit(t.exitReason)
        ? t.exitTime
        : (() => {
            const xi = idx.get(t.exitTime);
            return xi != null && candles[xi + 1] ? candles[xi + 1]!.date : t.exitTime;
          })();
      const pe = premiumAt(bars, fillEntry, 'open');
      const px = premiumAt(bars, fillExit, isRestingExit(t.exitReason) ? 'close' : 'open');
      if (pe != null && px != null) {
        const gross = (px - pe) * lot;
        const ch = estimateRoundTripCharges({
          segment: 'nfo_option',
          entryPrice: pe,
          exitPrice: px,
          quantity: lot,
        }).totalRs;
        optNet = Math.round((gross - ch) * 100) / 100;
      }
    }

    rows.push({
      entry: t.entryTime.slice(11, 16),
      exit: t.exitTime.slice(11, 16),
      atm: `${strike}${optType}`,
      modelPts: t.indexPoints,
      modelRs: t.indexPoints * rs,
      oldExecPts: oldPts,
      newExecPts: neu?.indexPoints ?? null,
      flippedByOldBug,
      exitReason: t.exitReason,
      optNet,
    });

    console.log(
      `${t.entryTime.slice(11, 16)}→${t.exitTime.slice(11, 16)} ${t.direction} ${strike}${optType}` +
        `  model ${t.indexPoints.toFixed(1)}pts (₹${(t.indexPoints * rs).toFixed(0)})` +
        `  OLD ${oldPts == null ? 'DROP' : oldPts.toFixed(1)}` +
        `  NEW ${neu ? neu.indexPoints.toFixed(1) : 'DROP'}` +
        (flippedByOldBug ? '  *** OLD BUG FLIP ***' : '') +
        `  ${t.exitReason.slice(0, 34)}` +
        (optNet != null ? `  optNet₹${optNet}` : ''),
    );
  }

  return { kind, trades, executable, rows };
}

async function main() {
  console.log('Desk strategy full tester ·', DAY);
  console.log(
    'Path: analyst-cache index · Trap DNA · desk day-lock/stop · executable resting trail',
  );

  let auth: string | null = null;
  const authPath = resolve(ROOT, '.kite-auth');
  if (existsSync(authPath)) {
    const raw = readFileSync(authPath, 'utf8').trim();
    auth = raw.startsWith('token ') ? raw : `token ${raw}`;
  }
  const instruments = await tryLoadNfo();
  console.log('NFO instruments', instruments.length);

  const nifty = await runBook(
    'nifty',
    'nifty',
    'Nifty 50',
    'nifty-5m-2020-2026.json',
    instruments,
    auth,
  );
  const bank = await runBook(
    'banknifty',
    'banknifty',
    'Bank Nifty',
    'banknifty-5m-2020-2026.json',
    instruments,
    auth,
  );

  const allRows = [...nifty.rows, ...bank.rows];
  const flips = allRows.filter((r) => r.flippedByOldBug);
  const newDayRs = [...nifty.executable, ...bank.executable].reduce(
    (s, t) => s + t.indexPoints * rupeesPerPointForInstrument(t.instrumentId),
    0,
  );
  const modelDayRs = [...nifty.trades, ...bank.trades].reduce(
    (s, t) => s + t.indexPoints * rupeesPerPointForInstrument(t.instrumentId),
    0,
  );

  console.log('\n======== ASSERTIONS ========');
  const dna = new SrTrapConfirmManagedStrategy();
  dna.initialize();
  const s = dna.getSettings();
  const dnaOk =
    s.extras?.['profitLockArmRs'] === 100 &&
    s.extras?.['profitLockLockRs'] === 50 &&
    s.extras?.['profitLockGivebackRs'] === 50 &&
    s.maxTradesPerDay === 3;
  console.log('Trap peak₹100/50/50 · max3:', dnaOk ? 'PASS' : 'FAIL');

  // Aug-7 specific regression (the −₹33 day).
  if (DAY === '2026-08-07') {
    const atms = allRows.map((r) => r.atm).sort().join(',');
    const expectAtms = '24550PE,24600PE,57900PE';
    const legsOk = atms === expectAtms;
    console.log(
      `Aug7 day-lock legs (${atms}):`,
      legsOk ? 'PASS (matches UI 24600PE / 24550PE / 57900)' : `FAIL expected ${expectAtms}`,
    );
    const nifty24550 = allRows.find((r) => r.atm === '24550PE');
    const flipCaught = !!nifty24550?.flippedByOldBug;
    const newStillGreen =
      nifty24550 != null && nifty24550.newExecPts != null && nifty24550.newExecPts > 0;
    console.log(
      'Aug7 24550PE old next-open flip:',
      flipCaught ? 'PASS (bug reproduced)' : 'FAIL (expected OLD flip)',
    );
    console.log(
      'Aug7 24550PE new resting trail stays green:',
      newStillGreen ? 'PASS' : 'FAIL',
    );
    if (!legsOk || !flipCaught || !newStillGreen || !dnaOk) {
      console.error('\nTESTER FAILED');
      process.exitCode = 1;
    } else {
      console.log('\nTESTER PASSED — −₹33 was the next-open trail bug under day-lock');
    }
  } else {
    const anyFlipFixed = flips.every((r) => r.newExecPts != null && r.newExecPts > 0);
    console.log(
      `Old-bug flips on day: ${flips.length}; all fixed green under new fill:`,
      flips.length === 0 ? 'n/a' : anyFlipFixed ? 'PASS' : 'FAIL',
    );
    if (!dnaOk || (flips.length > 0 && !anyFlipFixed)) {
      process.exitCode = 1;
    }
  }

  console.log(`Day model index ₹ ${modelDayRs.toFixed(0)}`);
  console.log(`Day executable index ₹ ${newDayRs.toFixed(0)}`);

  const report = {
    day: DAY,
    modelIndexRs: Math.round(modelDayRs),
    executableIndexRs: Math.round(newDayRs),
    oldBugFlips: flips.map((r) => r.atm),
    trades: allRows,
    note:
      'Profit drained = resting SL-M (intrabar at trail). Old code used next-bar open and flipped winners red after day-lock left 3 legs.',
  };
  const path = resolve(OUT, `desk-strategy-${DAY}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log('Wrote', path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
