#!/usr/bin/env npx tsx
/**
 * Ruler 2025–2026 paper DNA test: Angular replay vs research books.
 * Prints monthly + totals for raw ₹ and day-capped research score.
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
  RULER_LOSS_STREAK_BREAKER,
  type RulerArm,
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
import type { ManagedOpenPosition } from '../src/app/core/strategy-manager/models/strategy-module.interface';
import { extractTradeDate } from '../src/app/core/utils/trade-date.util';
import { extractHhMm } from '../src/app/core/strategy-engine/utils/market-session.util';

const ROOT = '/workspace';
const CACHE = path.join(ROOT, 'reports/analyst-cache');
const OUT = '/tmp/ruler-verify';
const FROM = process.env.RULER_FROM ?? '2025-01-01';
const TO = process.env.RULER_TO ?? '2026-07-21';

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
  pts: number;
  inr: number;
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

function seriesThroughOr(candles: Candle[], day: string, orEnd = '09:45'): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const d = extractTradeDate(c.date);
    if (d > day) break;
    if (d < day) {
      out.push(c);
      continue;
    }
    if (extractHhMm(c.date) < orEnd) out.push(c);
    else break;
  }
  return out;
}

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
  const name = instrumentId === BANK_ID ? 'Bank' : 'Nifty';

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
        trades.push({
          date: day,
          instrument: name,
          pts: Number(pts.toFixed(2)),
          inr: Number((pts * RS[instrumentId]!).toFixed(2)),
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
      profitProtectEnabled: false,
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
  return trades;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  console.log(`\n=== RULER PAPER TEST · ${FROM} → ${TO} ===\n`);
  console.log('Building research books + running boosted ruler…');
  const py = `
import importlib.util, json, sys
from pathlib import Path
ROOT = Path('/workspace')
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
uni = load('uni', ROOT/'scripts'/'strategy-universe-search.py')
boost = load('boost', Path('/tmp/ruler-profit-boost.py'))
sep = load('sep', ROOT/'scripts'/'ruler-sep-boost.py')
nifty = uni.load_inst(uni.CACHE/'nifty-5m-2020-2026.json', 'nifty', 30, 65)
bank = uni.load_inst(uni.CACHE/'banknifty-5m-2020-2026.json', 'bank', 45, 30)
books = boost.build(nifty, bank)
FROM, TO = '${FROM}', '${TO}'
days = sorted(d for d in (set(nifty.day_starts)|set(bank.day_starts)) if FROM <= d <= TO)
feats = {}
for d in days:
    fn = boost.morning_feat(nifty, d) if d in nifty.day_starts else None
    feats[d] = fn or (boost.morning_feat(bank, d) if d in bank.day_starts else None)
official = sep.run_sep_boost(
    books, feats, days,
    comb=boost.comb, clip=boost.clip, beast=boost.beast, edge=boost.edge,
)
rows = official['picks']
Path('${OUT}/range-research.json').write_text(json.dumps({
  'from': FROM, 'to': TO, 'days': len(days),
  'official_total': official['net'],
  'monthly': official['monthly'],
  'arms': official.get('arms'),
  'recipe': official.get('recipe'),
  'rows': rows,
}, indent=2))
print(json.dumps({'days': len(days), 'official_total': official['net'], 'monthly': official['monthly'], 'recipe': official.get('recipe')}))
`;
  const researchOut = execFileSync('python3', ['-c', py], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  // last json line
  const researchSummary = JSON.parse(
    researchOut
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .at(-1)!,
  ) as {
    days: number;
    official_total: number;
    monthly: Record<string, number>;
  };
  const research = JSON.parse(
    readFileSync(path.join(OUT, 'range-research.json'), 'utf8'),
  ) as {
    rows: Array<{ date: string; arm: string; raw: number; clipped: number; mtd_before: number }>;
    official_total: number;
    monthly: Record<string, number>;
  };

  console.log('Loading candles + Angular DNA replay…');
  const nifty = loadCandles(path.join(CACHE, 'nifty-5m-2020-2026.json'));
  const bank = loadCandles(path.join(CACHE, 'banknifty-5m-2020-2026.json'));
  const days = tradingDays(nifty, FROM, TO);

  const dayArm = new Map<string, RulerArm>();
  const researchByDate = new Map(research.rows.map((r) => [r.date, r]));
  // Replay breaker the same way as RulerDayPlanService.isBreakerActive.
  let walkMtd = 0;
  let walkStreak = 0;
  let walkBroken = false;
  let walkMonth: string | null = null;
  for (const day of days) {
    const ym = day.slice(0, 7);
    if (ym !== walkMonth) {
      walkMonth = ym;
      walkMtd = 0;
      walkStreak = 0;
      walkBroken = false;
    }
    const seriesN = seriesThroughOr(nifty, day);
    const fn = computeRulerMorningFeatures(seriesN, day, false, '09:45');
    const seriesB = seriesThroughOr(bank, day);
    const fb = computeRulerMorningFeatures(seriesB, day, true, '09:45');
    const feat = fn ?? fb;
    const r = researchByDate.get(day);
    const mtdBefore = r?.mtd_before ?? walkMtd;
    dayArm.set(day, pickRulerArm(feat, mtdBefore, { breakerActive: walkBroken }));
    const clipped = r?.clipped ?? 0;
    if (clipped < 0) {
      walkStreak += 1;
      if (walkStreak >= RULER_LOSS_STREAK_BREAKER && !walkBroken) {
        walkBroken = true;
      }
    } else if (clipped > 0) {
      walkStreak = 0;
    }
    walkMtd += clipped;
  }

  const allTrades = [
    ...replayArm(nifty, NIFTY_ID, FROM, TO, dayArm),
    ...replayArm(bank, BANK_ID, FROM, TO, dayArm),
  ];
  const rawByDate = new Map<string, number>();
  for (const t of allTrades) {
    rawByDate.set(t.date, (rawByDate.get(t.date) ?? 0) + t.inr);
  }

  let angMtd = 0;
  let angRaw = 0;
  let angClip = 0;
  let resRaw = 0;
  let resClip = 0;
  let armMatch = 0;
  let armTotal = 0;
  const monthlyAngRaw: Record<string, number> = {};
  const monthlyAngClip: Record<string, number> = {};
  const monthlyResRaw: Record<string, number> = {};
  const monthlyResClip: Record<string, number> = {};
  const monthlyArms: Record<string, number> = {};

  console.log(
    '\nMONTH    | ANG RAW ₹    | RES RAW ₹    | ANG SCORE ₹  | RES SCORE ₹  | ARM% | Δ score',
  );
  console.log('-'.repeat(95));

  for (const day of days) {
    const ym = day.slice(0, 7);
    const r = researchByDate.get(day);
    const aRaw = rawByDate.get(day) ?? 0;
    const aClip = clipRulerDayInr(aRaw, angMtd);
    const rRaw = r?.raw ?? 0;
    const rClipped = r?.clipped ?? 0;
    const arm = dayArm.get(day)!;
    if (r) {
      armTotal += 1;
      if (arm === r.arm) armMatch += 1;
    }
    angRaw += aRaw;
    angClip += aClip;
    resRaw += rRaw;
    resClip += rClipped;
    monthlyAngRaw[ym] = (monthlyAngRaw[ym] ?? 0) + aRaw;
    monthlyAngClip[ym] = (monthlyAngClip[ym] ?? 0) + aClip;
    monthlyResRaw[ym] = (monthlyResRaw[ym] ?? 0) + rRaw;
    monthlyResClip[ym] = (monthlyResClip[ym] ?? 0) + rClipped;
    monthlyArms[ym] = (monthlyArms[ym] ?? 0) + (r && arm === r.arm ? 1 : 0);
    angMtd += aClip;
    // reset MTD each month for dyn display path — research boost.run also resets monthly
    // Actually research clip walk in official uses continuous MTD within run; boost.run monthly is separate.
    // Our clipRulerDayInr walk should reset per calendar month like applyRulerDayClipByDate.
  }

  // Recompute Angular clip with month reset (desk research score path)
  angRaw = 0;
  angClip = 0;
  resRaw = 0;
  resClip = 0;
  angMtd = 0;
  let curMonth: string | null = null;
  Object.keys(monthlyAngRaw).forEach((k) => {
    monthlyAngRaw[k] = 0;
    monthlyAngClip[k] = 0;
    monthlyResRaw[k] = 0;
    monthlyResClip[k] = 0;
  });
  const monthDays: Record<string, { match: number; total: number }> = {};

  for (const day of days) {
    const ym = day.slice(0, 7);
    if (ym !== curMonth) {
      curMonth = ym;
      angMtd = 0;
    }
    const r = researchByDate.get(day);
    const aRaw = rawByDate.get(day) ?? 0;
    const aClip = clipRulerDayInr(aRaw, angMtd);
    const rRaw = r?.raw ?? 0;
    const rClipped = r?.clipped ?? 0;
    const arm = dayArm.get(day)!;
    monthDays[ym] ??= { match: 0, total: 0 };
    if (r) {
      monthDays[ym]!.total += 1;
      if (arm === r.arm) monthDays[ym]!.match += 1;
    }
    angRaw += aRaw;
    angClip += aClip;
    resRaw += rRaw;
    resClip += rClipped;
    monthlyAngRaw[ym] = (monthlyAngRaw[ym] ?? 0) + aRaw;
    monthlyAngClip[ym] = (monthlyAngClip[ym] ?? 0) + aClip;
    monthlyResRaw[ym] = (monthlyResRaw[ym] ?? 0) + rRaw;
    monthlyResClip[ym] = (monthlyResClip[ym] ?? 0) + rClipped;
    angMtd += aClip;
  }

  for (const ym of Object.keys(monthlyAngClip).sort()) {
    const md = monthDays[ym] ?? { match: 0, total: 0 };
    const pct = md.total ? ((100 * md.match) / md.total).toFixed(0) : '—';
    const dScore = monthlyAngClip[ym]! - monthlyResClip[ym]!;
    console.log(
      `${ym} | ${monthlyAngRaw[ym]!.toFixed(0).padStart(11)} | ${monthlyResRaw[ym]!.toFixed(0).padStart(11)} | ${monthlyAngClip[ym]!.toFixed(0).padStart(11)} | ${monthlyResClip[ym]!.toFixed(0).padStart(11)} | ${String(pct).padStart(3)}% | ${dScore >= 0 ? '+' : ''}${dScore.toFixed(0)}`,
    );
  }

  console.log('-'.repeat(95));
  const armPct = armTotal ? ((100 * armMatch) / armTotal).toFixed(1) : '—';
  // recount arm match
  armMatch = Object.values(monthDays).reduce((a, b) => a + b.match, 0);
  armTotal = Object.values(monthDays).reduce((a, b) => a + b.total, 0);
  console.log(
    `TOTAL    | ${angRaw.toFixed(0).padStart(11)} | ${resRaw.toFixed(0).padStart(11)} | ${angClip.toFixed(0).padStart(11)} | ${resClip.toFixed(0).padStart(11)} | ${((100 * armMatch) / Math.max(1, armTotal)).toFixed(0).padStart(3)}% |`,
  );

  const wins = allTrades.filter((t) => t.pts > 0).length;
  const losses = allTrades.filter((t) => t.pts < 0).length;
  console.log(`\nAngular trades: ${allTrades.length} · W/L ${wins}/${losses}`);
  console.log(`Arm agreement:  ${armMatch}/${armTotal} (${((100 * armMatch) / Math.max(1, armTotal)).toFixed(1)}%)`);
  console.log(`Research official total (boost.run): ₹${Number(research.official_total).toFixed(0)}`);
  console.log(`Angular research-score total:        ₹${angClip.toFixed(0)}`);
  console.log(`Delta (Ang − Res score):             ₹${(angClip - resClip).toFixed(0)}`);

  // Always print per-month profits after Angular integration check.
  console.log('\n=== MONTHLY PROFITS (research score ₹) ===');
  console.log(`${'MONTH'.padEnd(10)} ${'RESEARCH ₹'.padStart(12)} ${'ANGULAR ₹'.padStart(12)}`);
  console.log('-'.repeat(38));
  for (const ym of Object.keys(monthlyResClip).sort()) {
    console.log(
      `${ym.padEnd(10)} ${monthlyResClip[ym]!.toFixed(1).padStart(12)} ${monthlyAngClip[ym]!.toFixed(1).padStart(12)}`,
    );
  }
  console.log('-'.repeat(38));
  console.log(
    `${'TOTAL'.padEnd(10)} ${resClip.toFixed(1).padStart(12)} ${angClip.toFixed(1).padStart(12)}`,
  );
  const redMonths = Object.entries(monthlyResClip)
    .filter(([, v]) => v < 0)
    .map(([m]) => m);
  console.log(
    `Red months (research): ${redMonths.length === 0 ? 'none' : redMonths.join(', ')}`,
  );

  const summary = {
    from: FROM,
    to: TO,
    days: days.length,
    angularRaw: Number(angRaw.toFixed(2)),
    angularScore: Number(angClip.toFixed(2)),
    researchRaw: Number(resRaw.toFixed(2)),
    researchScore: Number(resClip.toFixed(2)),
    researchOfficial: research.official_total,
    armMatch,
    armTotal,
    trades: allTrades.length,
    wins,
    losses,
    monthly: Object.keys(monthlyAngClip)
      .sort()
      .map((ym) => ({
        month: ym,
        angularRaw: Number(monthlyAngRaw[ym]!.toFixed(2)),
        angularScore: Number(monthlyAngClip[ym]!.toFixed(2)),
        researchRaw: Number(monthlyResRaw[ym]!.toFixed(2)),
        researchScore: Number(monthlyResClip[ym]!.toFixed(2)),
        armPct: monthDays[ym]
          ? Number(((100 * monthDays[ym]!.match) / monthDays[ym]!.total).toFixed(1))
          : null,
      })),
  };
  writeFileSync(path.join(OUT, 'range-2025-2026.json'), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.join(OUT, 'range-2025-2026.json')}`);
}

main();
