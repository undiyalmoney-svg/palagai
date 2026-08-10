/**
 * Tester: Live Kite option OHLC replay for July 2026 under shipped DNA.
 * Asserts whether Live option net ≈ Δ-estimate ₹50,461 (Live ₹3k day lock).
 *
 *   npx tsx scripts/live-july-profit-test.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPaperOnIndex } from '../src/app/core/paper-desk/paper-desk-engine';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
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
const FROM = '2026-07-01';
const TO = '2026-07-31';
const LIVE_DAY_LOCK_RS = 3000;
const DELTA_TARGET_RS = 50_461;
const OUT = resolve(ROOT, 'reports/option-profit-40k');
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
  const res = await fetch('https://api.kite.trade/instruments', {
    headers: { Authorization: auth, 'X-Kite-Version': '3' },
  });
  if (!res.ok) throw new Error(`instruments HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const out: Instrument[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    const p = parseCsvLine(line);
    if (p[11] !== 'NFO') continue;
    const name = (p[3] ?? '').toUpperCase();
    if (name !== 'NIFTY' && name !== 'BANKNIFTY') continue;
    const instrumentType = (p[9] ?? '') as Instrument['instrumentType'];
    if (instrumentType !== 'CE' && instrumentType !== 'PE') continue;
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
      instrumentType,
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
    data?: { candles?: unknown[] };
    message?: string;
  };
  if (j.status !== 'success' || !Array.isArray(j.data?.candles)) return [];
  return (j.data!.candles as unknown[][]).map((c) => ({
    date: String(c[0]).replace('T', ' ').slice(0, 19),
    open: +c[1]!,
    high: +c[2]!,
    low: +c[3]!,
    close: +c[4]!,
    volume: +(c[5] as number) || 0,
  }));
}

function deltaOptNet(indexPoints: number, instrumentId: string): {
  net: number;
  ch: number;
} {
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
  return { net: gross - ch, ch };
}

function tradeMoney(t: PaperTrade): {
  net: number;
  source: 'real_ohlc' | 'est_premium' | 'delta';
  ch: number;
} {
  if (t.optionPnlRs != null && t.premiumEstimated === false) {
    return {
      net: t.netOptionPnlRs ?? t.optionPnlRs,
      source: 'real_ohlc',
      ch: t.chargesRs ?? 0,
    };
  }
  if (t.optionPnlRs != null) {
    return {
      net: t.netOptionPnlRs ?? t.optionPnlRs,
      source: 'est_premium',
      ch: t.chargesRs ?? 0,
    };
  }
  const d = deltaOptNet(t.indexPoints, t.instrumentId);
  return { net: d.net, source: 'delta', ch: d.ch };
}

function replay(
  kind: IndexOptionKind,
  id: string,
  file: string,
  instruments: Instrument[],
  optMap: Map<number, Candle[]>,
): PaperTrade[] {
  const all = load(file);
  const warm = all.findIndex((c) => c.date.startsWith('2025-12-01'));
  const candles = dropFormingBars(
    all.slice(Math.max(0, warm)),
    new Date(`${TO}T15:30:00+05:30`),
  );
  const strat = new SrTrapConfirmManagedStrategy();
  strat.initialize();
  // Shipped DNA via initialize(); keep dayStop, no in-strategy day lock.
  strat.updateSettings({
    dayStopPts: 60,
    dayProfitLockPts: 0,
  });
  const s = strat.getSettings();
  if (s.maxTradesPerDay !== 3) {
    throw new Error(`DNA drift: maxTrades=${s.maxTradesPerDay} (need 3)`);
  }
  if (Number(s.extras?.['piercePts']) !== 20) {
    throw new Error(`DNA drift: piercePts=${s.extras?.['piercePts']}`);
  }
  return replayPaperOnIndex({
    instrumentId: id,
    instrumentName: id,
    kind,
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    optionCandlesByToken: optMap,
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
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(t);
  }
  const kept: PaperTrade[] = [];
  for (const [, list] of byDay) {
    let day = 0;
    for (const t of list) {
      if (day >= lockRs) break;
      kept.push(t);
      day += tradeMoney(t).net;
    }
  }
  return kept;
}

function summarize(trades: PaperTrade[], label: string) {
  let net = 0;
  let ch = 0;
  let real = 0;
  let est = 0;
  let delta = 0;
  let realNet = 0;
  let estNet = 0;
  let niftyNet = 0;
  let bankNet = 0;
  const day = new Map<string, number>();
  for (const t of trades) {
    const m = tradeMoney(t);
    net += m.net;
    ch += m.ch;
    if (m.source === 'real_ohlc') {
      real += 1;
      realNet += m.net;
    } else if (m.source === 'est_premium') {
      est += 1;
      estNet += m.net;
    } else {
      delta += 1;
    }
    if (t.instrumentId.includes('bank')) bankNet += m.net;
    else niftyNet += m.net;
    const d = t.entryTime.slice(0, 10);
    day.set(d, (day.get(d) ?? 0) + m.net);
  }
  const days = [...day.values()];
  return {
    label,
    netRs: Math.round(net),
    chargesRs: Math.round(ch),
    trades: trades.length,
    realOhlcTrades: real,
    estPremiumTrades: est,
    deltaFallback: delta,
    realOhlcNetRs: Math.round(realNet),
    estPremiumNetRs: Math.round(estNet),
    niftyNetRs: Math.round(niftyNet),
    bankNetRs: Math.round(bankNet),
    days: days.length,
    avgDay: days.length ? Math.round(net / days.length) : 0,
    green: days.filter((v) => v > 0).length,
    red: days.filter((v) => v < 0).length,
    worstDay: days.length ? Math.round(Math.min(...days)) : 0,
    bestDay: days.length ? Math.round(Math.max(...days)) : 0,
  };
}

async function main() {
  const auth = authHeader();
  if (!auth) throw new Error('Need .kite-auth for Live option OHLC');

  console.log('=== LIVE JULY PROFIT TEST ===');
  console.log(`Window ${FROM} → ${TO}`);
  console.log('DNA: pierce20/B40 · peak₹100 · max3 · 3.5R · N1/B1');
  console.log(`Δ-target (prior estimate): ₹${DELTA_TARGET_RS.toLocaleString('en-IN')}`);
  console.log(`Live day lock: ₹${LIVE_DAY_LOCK_RS.toLocaleString('en-IN')}\n`);

  const instruments = await loadNfo(auth);
  console.log(`NFO CE/PE loaded: ${instruments.length}`);

  // Pass 1: discover tokens (empty opt map — index path)
  const seed = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', instruments, new Map()),
    ...replay(
      'banknifty',
      'banknifty',
      'banknifty-5m-2020-2026.json',
      instruments,
      new Map(),
    ),
  ];
  console.log(`Seed trades (index path): ${seed.length}`);

  const tokenMeta = new Map<number, { sym: string; from: string; to: string }>();
  for (const t of seed) {
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
      const prev = tokenMeta.get(tok);
      if (!prev) {
        tokenMeta.set(tok, {
          sym: resolved.instrument.tradingSymbol,
          from: day,
          to: day,
        });
      } else {
        prev.from = day < prev.from ? day : prev.from;
        prev.to = day > prev.to ? day : prev.to;
      }
    } catch {
      /* skip unresolved */
    }
  }
  console.log(`Unique option tokens to fetch: ${tokenMeta.size}`);

  const optMap = new Map<number, Candle[]>();
  let i = 0;
  for (const [tok, meta] of tokenMeta) {
    i += 1;
    await new Promise((r) => setTimeout(r, 200));
    const bars = await hist(tok, `${meta.from} 09:15:00`, `${meta.to} 15:30:00`, auth);
    if (bars.length) {
      optMap.set(tok, bars);
      console.log(`  [${i}/${tokenMeta.size}] ${meta.sym} ${bars.length} bars`);
    } else {
      console.log(`  [${i}/${tokenMeta.size}] ${meta.sym} NO BARS`);
    }
  }
  console.log(`Option tokens with bars: ${optMap.size}/${tokenMeta.size}\n`);

  // Pass 2: with Live option OHLC
  const liveTrades = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', instruments, optMap),
    ...replay(
      'banknifty',
      'banknifty',
      'banknifty-5m-2020-2026.json',
      instruments,
      optMap,
    ),
  ];
  const locked = applyLiveDayLock(liveTrades, LIVE_DAY_LOCK_RS);

  // Pure Δ on seed with no option marks (strip option pnl)
  const pureDelta = applyLiveDayLock(
    seed.map((t) => ({
      ...t,
      optionPnlRs: null,
      netOptionPnlRs: null,
      chargesRs: null,
      premiumEstimated: undefined,
    })),
    LIVE_DAY_LOCK_RS,
  );
  const deltaSum = summarize(pureDelta, 'delta_estimate');
  const liveSum = summarize(locked, 'live_option_mixed');
  const realOhlcOnly = summarize(
    locked.filter((t) => t.optionPnlRs != null && t.premiumEstimated === false),
    'real_ohlc_only',
  );

  const deltaMatch =
    Math.abs(deltaSum.netRs - DELTA_TARGET_RS) <= 100
      ? 'PASS'
      : `DRIFT (Δ ₹${deltaSum.netRs} vs target ₹${DELTA_TARGET_RS})`;
  const liveVsDeltaPct =
    deltaSum.netRs !== 0
      ? Math.round((100 * (liveSum.netRs - deltaSum.netRs)) / Math.abs(deltaSum.netRs))
      : 0;

  const verdict = {
    deltaTargetRs: DELTA_TARGET_RS,
    deltaReplayRs: deltaSum.netRs,
    deltaTargetMatch: deltaMatch,
    liveOptionNetRs: liveSum.netRs,
    liveVsDeltaRs: liveSum.netRs - deltaSum.netRs,
    liveVsDeltaPct,
    realOhlcTrades: `${liveSum.realOhlcTrades}/${liveSum.trades}`,
    estPremiumTrades: liveSum.estPremiumTrades,
    optionTokensFetched: optMap.size,
    caveat:
      'Kite instruments dump only lists unexpired contracts — July weeklies may be gone; ' +
      'AUG BANK symbols can still price late-July Bank fills. Nifty often falls back to est/Δ.',
    sameNumberAs50461:
      Math.abs(liveSum.netRs - DELTA_TARGET_RS) <= 2_000
        ? 'CLOSE (±₹2k)'
        : Math.abs(liveSum.netRs - DELTA_TARGET_RS) <= 10_000
          ? 'IN BAND (±₹10k)'
          : 'NOT SAME — Live option money differs from Δ estimate',
  };

  console.log('--- RESULTS ---');
  console.log(JSON.stringify({ deltaSum, liveSum, realOhlcOnly, verdict }, null, 2));

  const path = resolve(OUT, `live-july-test-${FROM}_${TO}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        from: FROM,
        to: TO,
        dna: 'pierce20/B40 · peak₹100 · max3 · 3.5R',
        deltaSum,
        liveSum,
        realOhlcOnly,
        verdict,
      },
      null,
      2,
    ),
  );
  console.log('\nWrote', path);
  console.log('\nTESTER VERDICT:');
  console.log(`  Δ replay vs ₹50,461: ${verdict.deltaTargetMatch}`);
  console.log(
    `  Mixed Live/est net: ₹${liveSum.netRs.toLocaleString('en-IN')} ` +
      `(real OHLC ${liveSum.realOhlcTrades}, est ${liveSum.estPremiumTrades}, Δ ${liveSum.deltaFallback})`,
  );
  console.log(
    `  Real OHLC-only net: ₹${realOhlcOnly.netRs.toLocaleString('en-IN')} (${realOhlcOnly.trades} fills)`,
  );
  console.log(`  Same as ₹50,461? ${verdict.sameNumberAs50461}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
