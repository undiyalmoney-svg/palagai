#!/usr/bin/env npx tsx
/**
 * Cross-check Angular Ruler morning features / arm picks vs research March export.
 * Exit 0 only if arm agreement is high enough to trust desk Ruler.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import {
  computeRulerMorningFeatures,
  pickRulerArm,
  clipRulerDayInr,
  RULER_LOSS_STREAK_BREAKER,
} from '../src/app/core/strategy-manager/engines/ruler-morning.util';
import type { Candle } from '../src/app/core/models/candle.model';

const ROOT = '/workspace';
const CACHE = path.join(ROOT, 'reports/analyst-cache');
const OUT = '/tmp/ruler-verify';
const MARCH_TARGET = 16407.2;

type CacheBar = {
  date?: string;
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as CacheBar[] | { candles: CacheBar[] };
  const rows = Array.isArray(raw) ? raw : raw.candles;
  return rows.map((b) => {
    const date =
      b.date?.includes('T') || (b.date?.length ?? 0) > 10
        ? b.date!
        : `${b.date ?? b.time?.slice(0, 10)} ${String(b.time ?? '').slice(11, 19) || '09:15:00'}`.replace(
            ' ',
            'T',
          );
    // Normalize to ISO-ish with space or T — extractTradeDate uses slice/T split.
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

function seriesThroughOr(candles: Candle[], day: string, orEnd = '09:45'): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const d = c.date.slice(0, 10);
    if (d > day) break;
    if (d < day) {
      out.push(c);
      continue;
    }
    const hhmm = c.date.slice(11, 16);
    if (hhmm < orEnd) {
      out.push(c);
    } else if (hhmm === orEnd) {
      // Research OR uses mins < orEnd — do not include orEnd bar.
      break;
    } else {
      break;
    }
  }
  return out;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts/verify-ruler-march.py')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const report = JSON.parse(readFileSync(path.join(OUT, 'march-report.json'), 'utf8')) as {
    official_march: number;
    days: Array<{
      date: string;
      arm: string;
      mtd_before: number;
      raw: number;
      clipped: number;
    }>;
  };

  const nifty = loadCandles(path.join(CACHE, 'nifty-5m-2020-2026.json'));
  console.log(`loaded nifty candles=${nifty.length}`);

  let match = 0;
  let total = 0;
  const mismatches: Array<{ date: string; research: string; angular: string }> = [];
  let mtd = 0;
  let researchScore = 0;
  let streak = 0;
  let broken = false;

  for (const row of report.days) {
    total += 1;
    const series = seriesThroughOr(nifty, row.date);
    const feats = computeRulerMorningFeatures(series, row.date, false, '09:45');
    const arm = pickRulerArm(feats, row.mtd_before, { breakerActive: broken });
    if (arm === row.arm) match += 1;
    else mismatches.push({ date: row.date, research: row.arm, angular: arm });

    const clipped = clipRulerDayInr(row.raw, mtd);
    researchScore += clipped;
    if (clipped < 0) {
      streak += 1;
      if (streak >= RULER_LOSS_STREAK_BREAKER && !broken) {
        broken = true;
      }
    } else if (clipped > 0) {
      streak = 0;
    }
    mtd = researchScore;
  }

  const agreement = match / total;
  const summary = {
    official_march: report.official_march,
    arm_agreement: Number(agreement.toFixed(4)),
    match,
    total,
    mismatches,
    pass_official: Math.abs(report.official_march - MARCH_TARGET) < 1,
    pass_arms: agreement >= 0.85,
  };
  writeFileSync(path.join(OUT, 'ts-arm-compare.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass_official || !summary.pass_arms) {
    process.exit(1);
  }
}

main();
