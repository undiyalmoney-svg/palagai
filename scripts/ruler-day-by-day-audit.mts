#!/usr/bin/env npx tsx
/**
 * Day-by-day Ruler audit: candles → morning features → arm → Angular index-rule
 * P&L vs research March books. Prints the table the Trade Desk should match.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import type { Candle } from '../src/app/core/models/candle.model';
import type { StrategyContext } from '../src/app/core/strategy-engine/models/strategy-context.model';
import {
  computeRulerMorningFeatures,
  pickRulerArm,
  clipRulerDayInr,
  type RulerArm,
  type RulerMorningFeatures,
} from '../src/app/core/strategy-manager/engines/ruler-morning.util';
import {
  createRuleDayState,
  indexRuleExitLogic,
  mergeSettings,
  recordRuleTradeClosed,
  runIndexRuleStrategy,
  type IndexRuleSpec,
  type RuleDayState,
} from '../src/app/core/strategy-manager/engines/index-rule.engine';
import { defaultStrategySettings } from '../src/app/core/strategy-manager/models/strategy-settings.model';
import type {
  ManagedOpenPosition,
} from '../src/app/core/strategy-manager/models/strategy-module.interface';
import { extractTradeDate } from '../src/app/core/utils/trade-date.util';
import { extractHhMm } from '../src/app/core/strategy-engine/utils/market-session.util';

const ROOT = '/workspace';
const CACHE = path.join(ROOT, 'reports/analyst-cache');
const OUT = '/tmp/ruler-verify';
const FROM = '2026-03-01';
const TO = '2026-03-31';

const NIFTY_ID = 'nifty-50';
const BANK_ID = 'bank-nifty';
const RS: Record<string, number> = { [NIFTY_ID]: 65, [BANK_ID]: 30 };

const ARM_DNA: Record<
  Exclude<RulerArm, 'STAND'>,
  { spec: IndexRuleSpec; targetR: number; profitProtect: boolean }
> = {
  DONCH_TRAIL: {
    spec: { entry: 'donch_retest', bias: 'or_break', exit: 'swing_trail' },
    targetR: 0,
    profitProtect: false,
  },
  DONCH_2R: {
    spec: { entry: 'donch_retest', bias: 'or_mid', exit: 'eod' },
    targetR: 2,
    profitProtect: false,
  },
  DONCH_15R: {
    spec: { entry: 'donch_retest', bias: 'or_mid', exit: 'eod' },
    targetR: 1.5,
    profitProtect: false,
  },
  SWING_2R: {
    spec: { entry: 'swing_retest', bias: 'ema', exit: 'eod' },
    targetR: 2,
    profitProtect: false,
  },
};

type CacheBar = {
  date?: string;
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type TradeRow = {
  date: string;
  instrument: string;
  direction: string;
  entryTime: string;
  exitTime: string;
  pts: number;
  inr: number;
  exitReason: string;
  arm: string;
};

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as CacheBar[] | { candles: CacheBar[] };
  const rows = Array.isArray(raw) ? raw : raw.candles;
  return rows.map((b) => {
    const date =
      b.date?.includes('T') || (b.date?.length ?? 0) > 10
        ? b.date!
        : `${b.date ?? b.time?.slice(0, 10)}T${String(b.time ?? '').slice(11, 19) || '09:15:00'}`;
    const normalized = date.includes('T') ? date : date.replace(' ', 'T');
    return {
      date: normalized.length >= 16 ? normalized : `${normalized}T09:15:00`,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 0,
    };
  });
}

function stubCandle(c: Candle): Candle {
  return { ...c };
}

function buildContext(candles: Candle[], i: number, instrumentId: string): StrategyContext {
  const candle5m = candles[i]!;
  return {
    candle60m: stubCandle(candle5m),
    candle30m: stubCandle(candle5m),
    candle15m: stubCandle(candle5m),
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(0, i),
    candleIndex5m: i,
    replayStepIndex: i,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candles.at(-1)?.date ?? candle5m.date,
    instrumentId,
    series5m: candles,
  };
}

function tradingDays(candles: Candle[], from: string, to: string): string[] {
  const set = new Set<string>();
  for (const c of candles) {
    const d = extractTradeDate(c.date);
    if (d >= from && d <= to) set.add(d);
  }
  return [...set].sort();
}

function seriesThrough(candles: Candle[], day: string, hhmmEnd: string): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const d = extractTradeDate(c.date);
    if (d > day) break;
    if (d < day) {
      out.push(c);
      continue;
    }
    const hhmm = extractHhMm(c.date);
    // Research OR: mins < orEnd (do not include the orEnd bar).
    if (hhmm < hhmmEnd) out.push(c);
    else break;
  }
  return out;
}

function featLine(f: RulerMorningFeatures | null): string {
  if (!f) return 'features=null (pre-OR / missing)';
  return `choppy=${f.choppy} wide=${f.wide} strong=${f.strong} emaBuy=${f.emaBuy} emaSell=${f.emaSell} drive=${f.drive.toFixed(3)} orW=${f.orWidth.toFixed(1)} atr=${f.atr.toFixed(1)}`;
}

/** Replay one index for locked arm (Angular DNA). */
function replayArm(
  candles: Candle[],
  instrumentId: string,
  from: string,
  to: string,
  dayArm: Map<string, RulerArm>,
): TradeRow[] {
  const base = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 20,
    emaLength: 50,
    swingLookback: 5,
    maxTradesPerDay: 1,
    dayStopPts: 60,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  const state: RuleDayState = createRuleDayState();
  let open: ManagedOpenPosition | null = null;
  let activeArm: Exclude<RulerArm, 'STAND'> | null = null;
  const trades: TradeRow[] = [];
  const isBank = instrumentId === BANK_ID;
  const name = isBank ? 'Bank' : 'Nifty';

  for (let i = 40; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const day = extractTradeDate(candle.date);
    if (day < from || day > to) continue;

    const arm = dayArm.get(day) ?? 'STAND';
    const ctx = buildContext(candles, i, instrumentId);
    const series = candles.slice(0, i + 1);
    const closes = series.map((c) => c.close);

    if (open) {
      const dna = ARM_DNA[activeArm ?? 'DONCH_TRAIL'];
      const runSettings = mergeSettings(base, {
        targetRMultiple: dna.targetR,
        profitProtectEnabled: dna.profitProtect,
        dayStopPts: 60,
        emaLength: activeArm === 'SWING_2R' ? 50 : base.emaLength,
      });
      const exit = indexRuleExitLogic(candle, open, closes, runSettings, dna.spec, series);
      if (exit) {
        const pts =
          open.direction === 'BUY' ? exit.exitPrice - open.entry : open.entry - exit.exitPrice;
        const inr = pts * RS[instrumentId]! * 1;
        trades.push({
          date: day,
          instrument: name,
          direction: open.direction,
          entryTime: open.entryTime,
          exitTime: candle.date,
          pts: Number(pts.toFixed(2)),
          inr: Number(inr.toFixed(2)),
          exitReason: exit.reason,
          arm: activeArm ?? arm,
        });
        recordRuleTradeClosed(state, pts, 60);
        open = null;
        activeArm = null;
      }
      continue;
    }

    if (arm === 'STAND') continue;

    const dna = ARM_DNA[arm];
    const maxTrades = arm === 'DONCH_TRAIL' ? 0 : 1;
    const runSettings = mergeSettings(base, {
      targetRMultiple: dna.targetR,
      profitProtectEnabled: dna.profitProtect,
      profitProtectArmR: 1,
      profitProtectLockR: 0,
      dayStopPts: 60,
      maxTradesPerDay: maxTrades,
      emaLength: arm === 'SWING_2R' ? 50 : base.emaLength,
    });
    const signal = runIndexRuleStrategy(ctx, state, runSettings, dna.spec);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      open = {
        direction: signal.action,
        entry: signal.entryPrice,
        stop: signal.stopLoss,
        target: signal.target,
        entryTime: candle.date,
        trail: null,
      };
      activeArm = arm;
    }
  }

  // Force EOD close leftover
  if (open) {
    const last = candles[candles.length - 1]!;
    const day = extractTradeDate(open.entryTime);
    const pts =
      open.direction === 'BUY' ? last.close - open.entry : open.entry - last.close;
    trades.push({
      date: day,
      instrument: name,
      direction: open.direction,
      entryTime: open.entryTime,
      exitTime: last.date,
      pts: Number(pts.toFixed(2)),
      inr: Number((pts * RS[instrumentId]!).toFixed(2)),
      exitReason: 'audit force close',
      arm: activeArm ?? '?',
    });
  }

  return trades;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts/verify-ruler-march.py')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const research = JSON.parse(
    readFileSync(path.join(OUT, 'march-report.json'), 'utf8'),
  ) as {
    official_march: number;
    days: Array<{
      date: string;
      arm: string;
      raw: number;
      clipped: number;
      mtd_before: number;
      choppy: boolean | null;
      wide: boolean | null;
      strong: boolean | null;
      ema_buy: boolean | null;
      ema_sell: boolean | null;
      drive: number | null;
    }>;
  };
  const researchByDate = new Map(research.days.map((d) => [d.date, d]));

  const nifty = loadCandles(path.join(CACHE, 'nifty-5m-2020-2026.json'));
  const bank = loadCandles(path.join(CACHE, 'banknifty-5m-2020-2026.json'));
  const days = tradingDays(nifty, FROM, TO);
  console.log(`\n=== RULER DAY-BY-DAY AUDIT · ${FROM} → ${TO} · ${days.length} sessions ===\n`);

  // Lock shared arms like desk: Nifty first (research also prefers nifty feats).
  const dayArm = new Map<string, RulerArm>();
  const dayFeat = new Map<string, RulerMorningFeatures | null>();
  let mtdForPick = 0; // research uses clipped MTD for witch — Angular testing uses trade INR as recorded
  // For arm pick during desk run, MTD comes from monthState as trades close.
  // First pass: lock arms using research clipped MTD path? Desk uses Angular trade INR MTD.
  // We'll lock using Angular features + research mtd_before for fair arm compare,
  // then also show arms if using progressive Angular raw clip MTD.

  const rows: Array<Record<string, unknown>> = [];

  // Pass 1: features + arm vs research (using research mtd_before so arm pick matches desk witch input intent)
  for (const day of days) {
    const seriesN = seriesThrough(nifty, day, '09:45');
    const fn = computeRulerMorningFeatures(seriesN, day, false, '09:45');
    const seriesB = seriesThrough(bank, day, '09:45');
    const fb = computeRulerMorningFeatures(seriesB, day, true, '09:45');
    // Shared arm: research/boost uses nifty feat if present else bank — desk locks on first index with features.
    const feat = fn ?? fb;
    dayFeat.set(day, feat);
    const r = researchByDate.get(day);
    const mtdBefore = r?.mtd_before ?? mtdForPick;
    const arm = pickRulerArm(feat, mtdBefore);
    dayArm.set(day, arm);
    if (r) mtdForPick = r.mtd_before + r.clipped;
  }

  // Simulate Angular trades with locked arms
  const niftyTrades = replayArm(nifty, NIFTY_ID, FROM, TO, dayArm);
  const bankTrades = replayArm(bank, BANK_ID, FROM, TO, dayArm);
  const allTrades = [...niftyTrades, ...bankTrades];

  const rawByDate = new Map<string, number>();
  const tradeCountByDate = new Map<string, number>();
  for (const t of allTrades) {
    rawByDate.set(t.date, (rawByDate.get(t.date) ?? 0) + t.inr);
    tradeCountByDate.set(t.date, (tradeCountByDate.get(t.date) ?? 0) + 1);
  }

  let angMtd = 0;
  let angRawTotal = 0;
  let angClipTotal = 0;
  let resRawTotal = 0;
  let resClipTotal = 0;

  console.log(
    'DATE       | ANG ARM      | RES ARM      | MATCH | ANG RAW ₹   | RES RAW ₹   | ANG CLIP ₹  | RES CLIP ₹  | #T | FEATURES (Angular Nifty→Bank)',
  );
  console.log('-'.repeat(160));

  for (const day of days) {
    const feat = dayFeat.get(day) ?? null;
    const arm = dayArm.get(day)!;
    const r = researchByDate.get(day);
    const angRaw = Number((rawByDate.get(day) ?? 0).toFixed(2));
    const angClip = Number(clipRulerDayInr(angRaw, angMtd).toFixed(2));
    const resRaw = r?.raw ?? 0;
    const resClip = r?.clipped ?? 0;
    const match = r ? (arm === r.arm ? 'YES' : 'NO') : '—';
    const nTrades = tradeCountByDate.get(day) ?? 0;

    angRawTotal += angRaw;
    angClipTotal += angClip;
    resRawTotal += resRaw;
    resClipTotal += resClip;

    const line = [
      day,
      arm.padEnd(12),
      (r?.arm ?? '—').padEnd(12),
      match.padEnd(5),
      String(angRaw).padStart(11),
      String(resRaw).padStart(11),
      String(angClip).padStart(11),
      String(resClip).padStart(11),
      String(nTrades).padStart(2),
      featLine(feat),
    ].join(' | ');
    console.log(line);

    rows.push({
      date: day,
      angularArm: arm,
      researchArm: r?.arm ?? null,
      armMatch: match === 'YES',
      angularRaw: angRaw,
      researchRaw: resRaw,
      angularClipped: angClip,
      researchClipped: resClip,
      trades: nTrades,
      features: feat,
      researchFeatures: r
        ? {
            choppy: r.choppy,
            wide: r.wide,
            strong: r.strong,
            ema_buy: r.ema_buy,
            ema_sell: r.ema_sell,
            drive: r.drive,
          }
        : null,
    });

    angMtd += angClip;
  }

  console.log('-'.repeat(160));
  console.log(
    `TOTALS     |              |              |       | ${angRawTotal.toFixed(2).padStart(11)} | ${resRawTotal.toFixed(2).padStart(11)} | ${angClipTotal.toFixed(2).padStart(11)} | ${resClipTotal.toFixed(2).padStart(11)} | ${allTrades.length.toString().padStart(2)} |`,
  );
  console.log(`\nUI screenshot context:`);
  console.log(`  Desk P&L ₹ (raw OHLC)     ≈ should track ANG RAW TOTAL  (user saw -23446)`);
  console.log(`  Research score ₹ (day-cap) ≈ should track ANG CLIP TOTAL (user saw +1493)`);
  console.log(`  Research official March     = ${research.official_march}`);
  console.log(`  This audit Angular raw      = ${angRawTotal.toFixed(2)}`);
  console.log(`  This audit Angular clipped  = ${angClipTotal.toFixed(2)}`);
  console.log(`  Arm matches                 = ${rows.filter((r) => r.armMatch).length}/${rows.length}`);

  // Per-trade dump for mismatch days / large gaps
  console.log(`\n=== TRADES (${allTrades.length}) ===`);
  for (const t of allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime))) {
    console.log(
      `${t.date} ${t.instrument.padEnd(5)} ${t.arm.padEnd(12)} ${t.direction} pts=${t.pts.toFixed(1).padStart(7)} ₹=${t.inr.toFixed(0).padStart(7)}  ${t.entryTime.slice(11, 16)}→${t.exitTime.slice(11, 16)}  ${t.exitReason}`,
    );
  }

  const summary = {
    from: FROM,
    to: TO,
    days: days.length,
    angularRawTotal: Number(angRawTotal.toFixed(2)),
    angularClippedTotal: Number(angClipTotal.toFixed(2)),
    researchRawTotal: Number(resRawTotal.toFixed(2)),
    researchClippedTotal: Number(resClipTotal.toFixed(2)),
    researchOfficial: research.official_march,
    trades: allTrades.length,
    armMatches: rows.filter((r) => r.armMatch).length,
    rows,
    allTrades,
  };
  writeFileSync(path.join(OUT, 'day-by-day-audit.json'), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.join(OUT, 'day-by-day-audit.json')}`);
}

main();
