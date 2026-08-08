/**
 * Paper ↔ Live equality research (Trap DNA).
 *
 * With a live `.kite-auth` token, attaches real NFO 5m OHLC for recent days
 * (only unexpired contracts exist in today's instruments dump).
 *
 * Measures:
 *  1) Locked index ₹ vs Δ-option ₹ vs real-option ₹
 *  2) Days where Locked/Δ green but real option red (paper-green / live-red)
 *  3) OLD next-open trail flips vs NEW resting trail
 *
 *   npx tsx scripts/paper-live-option-gap-research.mts [from] [to]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import {
  RESEARCH_DAY_LOCK_RS,
  researchDayNetsRs,
  applyResearchDayLock,
} from '../src/app/core/paper-desk/research-locked-pnl.util';
import {
  buildBarIndex,
  isRestingExit,
  repriceTradesToExecutableFills,
} from '../src/app/core/paper-desk/executable-fill.util';
import {
  BOOK_LOT_SIZE,
  estimatedPremiumMove,
} from '../src/app/core/paper-desk/option-delta.util';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { resolveAtmWeeklyOption } from '../src/app/core/utils/option-chain.util';
import type { Candle } from '../src/app/core/models/candle.model';
import type { Instrument } from '../src/app/core/models/instrument.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';
import type { IndexOptionKind } from '../src/app/core/utils/option-chain.util';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = process.argv[2] ?? '2026-01-01';
const TO = process.argv[3] ?? '2026-08-07';
const OUT = resolve(ROOT, 'reports/paper-live-gap');
mkdirSync(OUT, { recursive: true });

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

function authHeader(): string | null {
  const p = resolve(ROOT, '.kite-auth');
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8').trim();
  return raw.startsWith('token ') ? raw : `token ${raw}`;
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

async function loadNfo(auth: string): Promise<Instrument[]> {
  const csv = await (
    await fetch('https://api.kite.trade/instruments', {
      headers: { Authorization: auth, 'X-Kite-Version': '3' },
    })
  ).text();
  const out: Instrument[] = [];
  for (const line of csv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const p = parseCsvLine(line);
    if (p[11] !== 'NFO') continue;
    const name = p[3] ?? '';
    if (name !== 'NIFTY' && name !== 'BANKNIFTY') continue;
    const instrumentType = (p[9] ?? '').toUpperCase();
    if (instrumentType !== 'CE' && instrumentType !== 'PE') continue;
    if (!p[5] || !(+p[6]! > 0) || !(+p[0]! > 0)) continue;
    out.push({
      instrumentToken: +p[0]!,
      exchangeToken: +p[1]! || 0,
      tradingSymbol: p[2]!, // camelCase — required by isIndexOption
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
}

async function hist(
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
  const j = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: unknown[] };
  };
  if (j.status !== 'success' || !Array.isArray(j.data?.candles)) {
    if (j.message) console.warn(`  hist ${token}: ${j.message}`);
    return [];
  }
  return (j.data!.candles as unknown[][]).map((c) => ({
    date: String(c[0]).replace('T', ' ').slice(0, 19),
    open: +c[1]!,
    high: +c[2]!,
    low: +c[3]!,
    close: +c[4]!,
    volume: +(c[5] as number) || 0,
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

function premiumAt(
  bars: Candle[],
  time: string,
  field: 'open' | 'close',
): number | null {
  const t = time.replace('T', ' ').slice(0, 16);
  const exact = bars.find((b) => b.date.replace('T', ' ').slice(0, 16) === t);
  if (exact) return exact[field];
  const hit = bars.find((b) => b.date.replace('T', ' ').slice(0, 16) >= t);
  return hit ? hit[field] : null;
}

function realOptNet(
  t: PaperTrade,
  bars: Candle[],
  candles: Candle[],
  idx: Map<string, number>,
): number | null {
  const lot =
    t.option?.lotSize ||
    (t.instrumentId.includes('bank') ? BOOK_LOT_SIZE.bank : BOOK_LOT_SIZE.nifty);
  const ei = idx.get(t.entryTime);
  const fillEntry =
    ei != null && candles[ei + 1] ? candles[ei + 1]!.date : t.entryTime;
  const fillExit = isRestingExit(t.exitReason)
    ? t.exitTime
    : (() => {
        const xi = idx.get(t.exitTime);
        return xi != null && candles[xi + 1] ? candles[xi + 1]!.date : t.exitTime;
      })();
  const pe = premiumAt(bars, fillEntry, 'open');
  const px = premiumAt(bars, fillExit, isRestingExit(t.exitReason) ? 'close' : 'open');
  if (pe == null || px == null) return null;
  const gross = (px - pe) * lot;
  const ch = estimateRoundTripCharges({
    segment: 'nfo_option',
    entryPrice: pe,
    exitPrice: px,
    quantity: lot,
  }).totalRs;
  return Math.round((gross - ch) * 100) / 100;
}

function oldExecPts(
  t: PaperTrade,
  idx: Map<string, number>,
  candles: Candle[],
): number | null {
  const ei = idx.get(t.entryTime);
  const xi = idx.get(t.exitTime);
  if (ei == null || xi == null) return null;
  const entryBar = candles[ei + 1];
  if (!entryBar) return null;
  const r = (t.exitReason ?? '').toLowerCase();
  const resting = r.includes('stop loss') || r.includes('target');
  let exitPrice: number;
  if (resting) {
    if (xi < ei + 1) return null;
    exitPrice = t.indexExit;
  } else {
    const exitBar = candles[xi + 1];
    if (!exitBar || xi + 1 <= ei + 1) return null;
    exitPrice = exitBar.open;
  }
  return t.direction === 'BUY'
    ? exitPrice - entryBar.open
    : entryBar.open - exitPrice;
}

function replay(
  kind: IndexOptionKind,
  id: string,
  file: string,
  instruments: Instrument[],
  optionCandlesByToken: Map<number, Candle[]>,
): { trades: PaperTrade[]; candles: Candle[] } {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(
    all.slice(Math.max(0, warm)),
    new Date(`${TO}T15:30:00+05:30`),
  );
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  strat.updateSettings({
    dayStopPts: 60,
    dayProfitLockPts: 0,
    maxTradesPerDay: 3,
    targetRMultiple: 2,
  });
  const trades = replayPaperOnIndex({
    instrumentId: id,
    instrumentName: id,
    kind,
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    optionCandlesByToken,
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
  }).trades;
  return { trades, candles };
}

async function main() {
  console.log(`Paper↔Live gap research · ${FROM} → ${TO}`);
  console.log('DNA: Trap peak₹100 · max3 · stop60 · bounceOR=0 · 1 lot\n');

  const auth = authHeader();
  let instruments: Instrument[] = [];
  if (auth) {
    instruments = await loadNfo(auth);
    console.log(`NFO chain: ${instruments.length} CE/PE (NIFTY+BANKNIFTY)`);
  } else {
    console.log('No .kite-auth — Δ-option only');
  }

  // Pass 1: index-only replay to discover ATM tokens needed for recent days
  const n0 = replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', [], new Map());
  const b0 = replay(
    'banknifty',
    'banknifty',
    'banknifty-5m-2020-2026.json',
    [],
    new Map(),
  );
  const seedTrades = [...n0.trades, ...b0.trades];
  console.log(`Index trades N${n0.trades.length} B${b0.trades.length}`);

  const optMap = new Map<number, Candle[]>();
  const tokenMeta = new Map<number, { sym: string; days: Set<string> }>();
  if (auth && instruments.length) {
    // Only request hist for trades whose as-of day can still resolve a live chain contract
    for (const t of seedTrades) {
      const kind: IndexOptionKind = t.instrumentId.includes('bank')
        ? 'banknifty'
        : 'nifty';
      try {
        const resolved = resolveAtmWeeklyOption({
          instruments,
          kind,
          direction: t.direction,
          spot: t.indexEntry,
          asOfDateTime: t.entryTime,
        });
        if (resolved.source !== 'chain' || resolved.instrument.instrumentToken <= 0) {
          continue;
        }
        const tok = resolved.instrument.instrumentToken;
        const day = t.entryTime.slice(0, 10);
        const meta = tokenMeta.get(tok) ?? {
          sym: resolved.instrument.tradingSymbol,
          days: new Set<string>(),
        };
        meta.days.add(day);
        tokenMeta.set(tok, meta);
      } catch {
        /* chain gap */
      }
    }
    console.log(`Resolvable chain tokens: ${tokenMeta.size}`);
    let i = 0;
    for (const [tok, meta] of tokenMeta) {
      i += 1;
      const days = [...meta.days].sort();
      const from = `${days[0]} 09:15:00`;
      const to = `${days[days.length - 1]} 15:30:00`;
      await new Promise((r) => setTimeout(r, 200));
      const bars = await hist(tok, from, to, auth);
      if (bars.length) {
        optMap.set(tok, bars);
        console.log(
          `  [${i}/${tokenMeta.size}] ${meta.sym} ${bars.length} bars (${days[0]}→${days[days.length - 1]})`,
        );
      } else {
        console.log(`  [${i}/${tokenMeta.size}] ${meta.sym} NO BARS`);
      }
    }
  }

  // Pass 2: replay with chain + option candles so trades bind real contracts
  const n = replay(
    'nifty',
    'nifty',
    'nifty-5m-2020-2026.json',
    instruments,
    optMap,
  );
  const b = replay(
    'banknifty',
    'banknifty',
    'banknifty-5m-2020-2026.json',
    instruments,
    optMap,
  );
  const trades = [...n.trades, ...b.trades];

  const unlocked = researchDayNetsRs(trades);
  const locked = applyResearchDayLock(unlocked, RESEARCH_DAY_LOCK_RS);
  const optDay = new Map<string, number>();
  const realDay = new Map<string, number>();
  const realDaysCovered = new Set<string>();
  let realTradeCount = 0;
  let realTradeSum = 0;
  const sampleReal: Array<Record<string, unknown>> = [];

  for (const [id, candles, bookTrades] of [
    ['nifty', n.candles, n.trades] as const,
    ['banknifty', b.candles, b.trades] as const,
  ]) {
    const idx = buildBarIndex(candles);
    for (const t of bookTrades) {
      const d = t.entryTime.slice(0, 10);
      optDay.set(d, (optDay.get(d) ?? 0) + deltaOptNet(t.indexPoints, t.instrumentId));

      const tok = t.option?.instrumentToken;
      if (!tok || !optMap.has(tok)) continue;
      // Prefer engine option ₹ (includes option-native trail floor fills).
      const engineNet =
        t.netOptionPnlRs != null
          ? t.netOptionPnlRs
          : t.optionPnlRs != null && t.premiumEstimated === false
            ? t.optionPnlRs
            : null;
      const net =
        engineNet != null ? engineNet : realOptNet(t, optMap.get(tok)!, candles, idx);
      if (net == null) continue;
      realDay.set(d, (realDay.get(d) ?? 0) + net);
      realDaysCovered.add(d);
      realTradeCount += 1;
      realTradeSum += net;
      if (sampleReal.length < 20) {
        sampleReal.push({
          day: d,
          book: id,
          sym: t.option?.tradingSymbol,
          entry: t.entryTime.slice(11, 16),
          exit: t.exitTime.slice(11, 16),
          indexPts: +t.indexPoints.toFixed(2),
          deltaOpt: +deltaOptNet(t.indexPoints, t.instrumentId).toFixed(0),
          realOpt: +Number(net).toFixed(2),
          enginePriced: engineNet != null,
          entryPrem: t.optionEntryPremium,
          exitPrem: t.optionExitPremium,
          reason: (t.exitReason ?? '').slice(0, 40),
          drained: /profit drained/i.test(t.exitReason ?? ''),
        });
      }
    }
  }

  const optLocked = applyResearchDayLock(optDay, RESEARCH_DAY_LOCK_RS);

  let lockedSum = 0;
  let optSum = 0;
  let optLockSum = 0;
  for (const v of locked.values()) lockedSum += v;
  for (const v of optDay.values()) optSum += v;
  for (const v of optLocked.values()) optLockSum += v;

  // Sign mismatch: locked green vs real option red (and vice versa)
  let bothGreen = 0;
  let bothRed = 0;
  let lockGreenRealRed = 0;
  let lockRedRealGreen = 0;
  let deltaGreenRealRed = 0;
  const gapDays: Array<Record<string, unknown>> = [];
  for (const d of [...realDaysCovered].sort()) {
    const L = locked.get(d) ?? 0;
    const R = realDay.get(d) ?? 0;
    const D = optDay.get(d) ?? 0;
    if (L > 0 && R > 0) bothGreen += 1;
    else if (L < 0 && R < 0) bothRed += 1;
    else if (L > 0 && R < 0) {
      lockGreenRealRed += 1;
      gapDays.push({
        day: d,
        lockedRs: Math.round(L),
        deltaOptRs: Math.round(D),
        realOptRs: Math.round(R),
        kind: 'lock_green_real_red',
      });
    } else if (L < 0 && R > 0) {
      lockRedRealGreen += 1;
      gapDays.push({
        day: d,
        lockedRs: Math.round(L),
        deltaOptRs: Math.round(D),
        realOptRs: Math.round(R),
        kind: 'lock_red_real_green',
      });
    }
    if (D > 0 && R < 0) deltaGreenRealRed += 1;
  }

  // Executable flips
  let modelWin = 0;
  let oldFlip = 0;
  let newStillGreen = 0;
  let oldFlipOptRed = 0;
  const flipSamples: Array<Record<string, unknown>> = [];
  for (const [id, candles, bookTrades] of [
    ['nifty', n.candles, n.trades] as const,
    ['banknifty', b.candles, b.trades] as const,
  ]) {
    const idx = buildBarIndex(candles);
    const neu = repriceTradesToExecutableFills(
      bookTrades,
      new Map([[id, candles]]),
    );
    for (const t of bookTrades) {
      if (t.indexPoints <= 0) continue;
      modelWin += 1;
      const oldPts = oldExecPts(t, idx, candles);
      const nTrade = neu.find(
        (x) => x.entryTime === t.entryTime && x.exitTime === t.exitTime,
      );
      if (oldPts != null && oldPts < 0) {
        oldFlip += 1;
        const opt = deltaOptNet(oldPts, t.instrumentId);
        if (opt < 0) oldFlipOptRed += 1;
        if (flipSamples.length < 12) {
          flipSamples.push({
            day: t.entryTime.slice(0, 10),
            book: id,
            modelPts: +t.indexPoints.toFixed(1),
            oldExecPts: +oldPts.toFixed(1),
            newExecPts: nTrade ? +nTrade.indexPoints.toFixed(1) : null,
            resting: isRestingExit(t.exitReason),
            reason: (t.exitReason ?? '').slice(0, 36),
          });
        }
      }
      if (nTrade && nTrade.indexPoints > 0) newStillGreen += 1;
    }
  }

  const julLocked = [...locked.entries()]
    .filter(([d]) => d.startsWith('2026-07'))
    .reduce((a, [, v]) => a + v, 0);
  const julOpt = [...optDay.entries()]
    .filter(([d]) => d.startsWith('2026-07'))
    .reduce((a, [, v]) => a + v, 0);

  const realOnCoveredLocked = [...realDaysCovered].reduce(
    (a, d) => a + (locked.get(d) ?? 0),
    0,
  );
  const realOnCoveredDelta = [...realDaysCovered].reduce(
    (a, d) => a + (optDay.get(d) ?? 0),
    0,
  );

  console.log('\n======== 1) METERS ========');
  console.log(`Locked index ₹     ${Math.round(lockedSum)}`);
  console.log(
    `Δ-option ₹         ${Math.round(optSum)}   (${((100 * optSum) / Math.max(1, lockedSum)).toFixed(0)}% of Locked)`,
  );
  console.log(`July Locked ₹      ${Math.round(julLocked)}  (table 65041)`);
  console.log(`July Δ-option ₹    ${Math.round(julOpt)}`);

  console.log('\n======== 2) REAL OPTION OHLC (chain-resolvable days) ========');
  console.log(`Tokens with bars: ${optMap.size}/${tokenMeta.size}`);
  console.log(`Days with real option ₹: ${realDaysCovered.size}`);
  console.log(`Trades with real option ₹: ${realTradeCount}`);
  console.log(`Real option sum ₹: ${Math.round(realTradeSum)}`);
  console.log(`Same days Locked ₹: ${Math.round(realOnCoveredLocked)}`);
  console.log(`Same days Δ-opt ₹:  ${Math.round(realOnCoveredDelta)}`);
  console.log(
    `Sign: bothGreen=${bothGreen} bothRed=${bothRed} lockGreen→realRed=${lockGreenRealRed} lockRed→realGreen=${lockRedRealGreen}`,
  );
  console.log(`Δ-green → real-red days: ${deltaGreenRealRed}`);
  if (gapDays.length) {
    console.log('Gap days:');
    for (const g of gapDays) console.log(' ', g);
  }
  console.log('Sample real trades:');
  for (const s of sampleReal.slice(0, 12)) console.log(' ', s);

  console.log('\n======== 3) EXECUTABLE FLIPS ========');
  console.log(`Model winners: ${modelWin}`);
  console.log(
    `OLD next-open flips: ${oldFlip} (${modelWin ? ((100 * oldFlip) / modelWin).toFixed(1) : 0}%)`,
  );
  console.log(`NEW resting still green: ${newStillGreen}/${modelWin}`);

  const report = {
    from: FROM,
    to: TO,
    kite: auth ? 'ok' : 'missing',
    nfoInstruments: instruments.length,
    tokensRequested: tokenMeta.size,
    tokensWithBars: optMap.size,
    meters: {
      lockedIndexRs: Math.round(lockedSum),
      deltaOptionRs: Math.round(optSum),
      deltaOptionLockedRs: Math.round(optLockSum),
      julyLocked: Math.round(julLocked),
      julyDeltaOption: Math.round(julOpt),
    },
    realOption: {
      days: realDaysCovered.size,
      trades: realTradeCount,
      sumRs: Math.round(realTradeSum),
      sameDaysLockedRs: Math.round(realOnCoveredLocked),
      sameDaysDeltaRs: Math.round(realOnCoveredDelta),
      bothGreen,
      bothRed,
      lockGreenRealRed,
      lockRedRealGreen,
      deltaGreenRealRed,
      gapDays,
      sampleTrades: sampleReal,
      coveredDays: [...realDaysCovered].sort(),
    },
    executable: {
      modelWinners: modelWin,
      oldNextOpenFlips: oldFlip,
      oldFlipOptRed,
      newRestingStillGreen: newStillGreen,
      samples: flipSamples,
    },
    equalityPlan: [
      'DONE: Testing Profit ₹ = option money; Locked ₹ side meter from index-only pass',
      'DONE: option-MFE gate before arming index peak trail (paper + live two-pass)',
      'DONE: resting trail + Live SL-M hold',
      'Still true: Live Kite fill avgs ≠ paper OHLC marks (usually small)',
      'Still true: Locked index table ≠ option ₹ — do not use Locked as Live forecast',
    ],
  };
  const path = resolve(OUT, `gap-${FROM}_to_${TO}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log('\nWrote', path);

  console.log('\n======== EQUALITY VERDICT ========');
  if (realDaysCovered.size) {
    const ratio = realTradeSum / Math.max(1, realOnCoveredLocked);
    console.log(
      `On ${realDaysCovered.size} real-option days: Locked ₹${Math.round(realOnCoveredLocked)} vs Real ₹${Math.round(realTradeSum)} (${(100 * ratio).toFixed(0)}%)`,
    );
    console.log(
      `Paper-green/Live-red days (Locked>0, Real<0): ${lockGreenRealRed}`,
    );
  } else {
    console.log('No real option days — refresh token / widen recent window.');
  }
  console.log(
    `Full window: Locked overstates Δ-option by ~${(100 - (100 * optSum) / Math.max(1, lockedSum)).toFixed(0)}%.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
