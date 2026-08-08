/**
 * Hunt higher REAL option ₹ at ₹40k capital (N1/B1).
 *
 * Paper ≡ Live money path:
 *  - Trap DNA variants
 *  - option OHLC when Kite chain resolves (Jul–Aug window)
 *  - option-native peak trail (engine)
 *  - score = option net ₹ (engine), not Locked index
 *
 *   npx tsx scripts/option-profit-40k-hunt.mts
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
  BOOK_LOT_SIZE,
  estimatedPremiumMove,
} from '../src/app/core/paper-desk/option-delta.util';
import { estimateRoundTripCharges } from '../src/app/core/paper-desk/trade-charges.util';
import { SrTrapConfirmManagedStrategy } from '../src/app/core/strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { resolveAtmWeeklyOption } from '../src/app/core/utils/option-chain.util';
import { planLotsForCapital } from '../src/app/core/paper-desk/capital-plan.util';
import type { Candle } from '../src/app/core/models/candle.model';
import type { Instrument } from '../src/app/core/models/instrument.model';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';
import type { IndexOptionKind } from '../src/app/core/utils/option-chain.util';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = '2026-07-01';
const TO = '2026-08-07';
const OUT = resolve(ROOT, 'reports/option-profit-40k');
mkdirSync(OUT, { recursive: true });

const plan = planLotsForCapital(40_000);
console.log('Capital plan', plan.note);

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
  kind: IndexOptionKind,
  id: string,
  file: string,
  dna: Dna,
  instruments: Instrument[],
  optMap: Map<number, Candle[]>,
  lots: number,
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
    dayProfitLockPts: 0, // post-hoc meter only; Live lock is separate
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
    instruments,
    optionCandlesByToken: optMap,
    neededOptionTokens: new Set(),
    strategy: strat,
    forceCloseOpen: true,
    lotsMultiplier: lots,
    enableKutty: false,
  }).trades;
}

function scoreTrades(trades: PaperTrade[]) {
  let optSum = 0;
  let realN = 0;
  let estN = 0;
  let deltaSum = 0;
  const dayOpt = new Map<string, number>();
  for (const t of trades) {
    const d = t.entryTime.slice(0, 10);
    deltaSum += deltaOptNet(t.indexPoints, t.instrumentId);
    const net =
      t.netOptionPnlRs != null
        ? t.netOptionPnlRs
        : t.optionPnlRs != null
          ? t.optionPnlRs
          : deltaOptNet(t.indexPoints, t.instrumentId);
    if (t.premiumEstimated === false && t.optionPnlRs != null) realN += 1;
    else estN += 1;
    optSum += net;
    dayOpt.set(d, (dayOpt.get(d) ?? 0) + net);
  }
  const days = [...dayOpt.values()];
  const green = days.filter((v) => v > 0).length;
  const red = days.filter((v) => v < 0).length;
  const worst = days.length ? Math.min(...days) : 0;
  const best = days.length ? Math.max(...days) : 0;
  const locked = applyResearchDayLock(researchDayNetsRs(trades), RESEARCH_DAY_LOCK_RS);
  let lockedSum = 0;
  for (const v of locked.values()) lockedSum += v;
  return {
    trades: trades.length,
    optSum: Math.round(optSum),
    deltaSum: Math.round(deltaSum),
    lockedSum: Math.round(lockedSum),
    days: days.length,
    green,
    red,
    greenPct: days.length ? Math.round((100 * green) / days.length) : 0,
    worstDay: Math.round(worst),
    bestDay: Math.round(best),
    realPriced: realN,
    estPriced: estN,
    avgDay: days.length ? Math.round(optSum / days.length) : 0,
  };
}

function grid(): Dna[] {
  const base: Dna = {
    id: 'baseline_peak100',
    piercePts: 15,
    bankPiercePts: 30,
    armRs: 100,
    lockRs: 50,
    givebackRs: 50,
    maxTrades: 3,
    dayStopPts: 60,
    targetR: 2,
  };
  const out: Dna[] = [{ ...base }];
  // Trail: let winners run (higher arm) vs tighter lock
  for (const [arm, lock, gb, tag] of [
    [150, 75, 75, 'peak150'],
    [200, 100, 100, 'peak200'],
    [300, 150, 150, 'peak300'],
    [100, 80, 40, 'tight_lock'],
    [200, 100, 150, 'wide_gb'],
    [400, 200, 200, 'peak400'],
  ] as const) {
    out.push({
      ...base,
      id: tag,
      armRs: arm,
      lockRs: lock,
      givebackRs: gb,
    });
  }
  // More trades / wider stop / higher R
  out.push({ ...base, id: 'max5', maxTrades: 5 });
  out.push({ ...base, id: 'max8', maxTrades: 8 });
  out.push({ ...base, id: 'stop80', dayStopPts: 80 });
  out.push({ ...base, id: 'stop100', dayStopPts: 100 });
  out.push({ ...base, id: 'rr3', targetR: 3 });
  out.push({ ...base, id: 'rr35', targetR: 3.5 });
  // Pierce variants
  out.push({ ...base, id: 'pierce10_20', piercePts: 10, bankPiercePts: 20 });
  out.push({ ...base, id: 'pierce20_40', piercePts: 20, bankPiercePts: 40 });
  // Combos that often help option money: higher arm + more trades
  out.push({
    ...base,
    id: 'peak200_max5',
    armRs: 200,
    lockRs: 100,
    givebackRs: 100,
    maxTrades: 5,
  });
  out.push({
    ...base,
    id: 'peak300_max5_rr3',
    armRs: 300,
    lockRs: 150,
    givebackRs: 150,
    maxTrades: 5,
    targetR: 3,
  });
  out.push({
    ...base,
    id: 'peak200_stop80_max5',
    armRs: 200,
    lockRs: 100,
    givebackRs: 100,
    maxTrades: 5,
    dayStopPts: 80,
  });
  // Long-window Δ winners
  out.push({
    ...base,
    id: 'pierce20_max5',
    piercePts: 20,
    bankPiercePts: 40,
    maxTrades: 5,
  });
  out.push({
    ...base,
    id: 'pierce20_max5_rr35',
    piercePts: 20,
    bankPiercePts: 40,
    maxTrades: 5,
    targetR: 3.5,
  });
  out.push({
    ...base,
    id: 'max5_rr35',
    maxTrades: 5,
    targetR: 3.5,
  });
  return out;
}

async function main() {
  const auth = authHeader();
  if (!auth) throw new Error('Need .kite-auth');
  const instruments = await loadNfo(auth);
  console.log(`NFO ${instruments.length} · window ${FROM}→${TO}`);

  // Discover tokens with baseline DNA
  const seed = grid()[0]!;
  const seedTrades = [
    ...replay('nifty', 'nifty', 'nifty-5m-2020-2026.json', seed, instruments, new Map(), 1),
    ...replay(
      'banknifty',
      'banknifty',
      'banknifty-5m-2020-2026.json',
      seed,
      instruments,
      new Map(),
      1,
    ),
  ];
  const tokenMeta = new Map<number, { sym: string; from: string; to: string }>();
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
      if (resolved.source !== 'chain' || resolved.instrument.instrumentToken <= 0) continue;
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
      /* skip */
    }
  }
  const optMap = new Map<number, Candle[]>();
  let i = 0;
  for (const [tok, meta] of tokenMeta) {
    i += 1;
    await new Promise((r) => setTimeout(r, 180));
    const bars = await hist(tok, `${meta.from} 09:15:00`, `${meta.to} 15:30:00`, auth);
    if (bars.length) {
      optMap.set(tok, bars);
      console.log(`  [${i}/${tokenMeta.size}] ${meta.sym} ${bars.length} bars`);
    }
  }
  console.log(`Option tokens with bars: ${optMap.size}/${tokenMeta.size}\n`);

  const rows: Array<Record<string, unknown>> = [];
  for (const dna of grid()) {
    const nLots = plan.niftyLots;
    const bLots = plan.bankLots;
    const trades = [
      ...replay(
        'nifty',
        'nifty',
        'nifty-5m-2020-2026.json',
        dna,
        instruments,
        optMap,
        nLots,
      ),
      ...replay(
        'banknifty',
        'banknifty',
        'banknifty-5m-2020-2026.json',
        dna,
        instruments,
        optMap,
        bLots,
      ),
    ];
    const s = scoreTrades(trades);
    // Prefer option ₹, then green%, then avoid deep red days
    const score = s.optSum + s.greenPct * 50 + Math.min(0, s.worstDay);
    const row = { ...dna, ...s, score: Math.round(score) };
    rows.push(row);
    console.log(
      `${dna.id.padEnd(22)} opt₹${String(s.optSum).padStart(7)}  Δ₹${String(s.deltaSum).padStart(7)}  ` +
        `L₹${String(s.lockedSum).padStart(6)}  days ${s.green}g/${s.red}r (${s.greenPct}%)  ` +
        `worst ${s.worstDay}  real ${s.realPriced}  score ${row.score}`,
    );
  }

  rows.sort((a, b) => Number(b.score) - Number(a.score));
  const path = resolve(OUT, `hunt-${FROM}_${TO}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        capital: plan,
        from: FROM,
        to: TO,
        optionTokens: optMap.size,
        ranking: rows,
        winner: rows[0],
        baseline: rows.find((r) => r.id === 'baseline_peak100'),
      },
      null,
      2,
    ),
  );
  console.log('\n======== TOP 5 (option ₹ first) ========');
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  ${r.id}  opt₹${r.optSum}  green ${r.greenPct}%  worst ${r.worstDay}  vs baseline locked was research-only`,
    );
  }
  const base = rows.find((r) => r.id === 'baseline_peak100');
  const win = rows[0];
  if (base && win) {
    console.log(
      `\nBaseline opt₹${base.optSum} → Winner ${win.id} opt₹${win.optSum} ` +
        `(${Math.round((100 * (Number(win.optSum) - Number(base.optSum))) / Math.max(1, Math.abs(Number(base.optSum))))}% )`,
    );
  }
  console.log('Wrote', path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
