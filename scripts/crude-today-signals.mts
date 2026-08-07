/**
 * Did Crude have any signal today, and what does the desk DNA say right now?
 * Read-only: fetches today's CRUDEOILM futures bars and replays Crude Selective.
 *
 *   npx tsx scripts/crude-today-signals.mts
 */
import { readFileSync } from 'node:fs';
import { replayPaperOnCrude } from '../src/app/core/paper-desk/crude-paper-engine';
import { resolveCrudeStrategyProfile } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import { dropFormingBars } from '../src/app/core/paper-desk/forming-bar.util';
import type { Candle } from '../src/app/core/models/candle.model';

const AUTH = readFileSync('/tmp/kite-auth', 'utf8').trim().split(/\s+/)[1]!;

async function kite<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.kite.trade${path}`, {
    headers: { 'X-Kite-Version': '3', Authorization: `token ${AUTH}` },
  });
  const body = (await res.json()) as { status?: string; data?: T; message?: string };
  if (body.status !== 'success' || body.data === undefined) {
    throw new Error(`Kite ${path}: ${body.message ?? res.status}`);
  }
  return body.data;
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const nowIst = new Date().toLocaleTimeString('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
});

// CRUDEOILM front-month future
const csv = await (
  await fetch('https://api.kite.trade/instruments/MCX', {
    headers: { 'X-Kite-Version': '3', Authorization: `token ${AUTH}` },
  })
).text();
// Kite's instrument CSV quotes some fields, so match the row rather than split it.
const futs = csv
  .split('\n')
  .filter((l) => /CRUDEOILM\d+[A-Z]{3}FUT/.test(l))
  .map((l) => {
    const cols = l.split(',');
    return {
      token: cols[0]!,
      symbol: /CRUDEOILM\d+[A-Z]{3}FUT/.exec(l)![0],
      expiry: /(\d{4}-\d{2}-\d{2})/.exec(l)?.[1] ?? '',
    };
  })
  .sort((a, b) => a.expiry.localeCompare(b.expiry));
const fut = futs[0]!;
console.log(`IST ${nowIst} ${today} · future ${fut.symbol} (expiry ${fut.expiry})`);

const hist = await kite<{ candles: [string, number, number, number, number, number][] }>(
  `/instruments/historical/${fut.token}/5minute?from=${today}+09:00:00&to=${today}+23:30:00`,
);
const raw: Candle[] = hist.candles.map((c) => ({
  date: c[0],
  open: c[1],
  high: c[2],
  low: c[3],
  close: c[4],
  volume: c[5],
}));
const live = dropFormingBars(raw);
console.log(`bars: ${live.length} closed (dropped ${raw.length - live.length} forming) · last ${live.at(-1)?.date ?? '—'}`);

const params = resolveCrudeStrategyProfile('selective');
console.log(
  `profile: ${params.label} · entryMode ${params.entryMode} · window ${params.eveningEntryStart}-${params.eveningEntryEnd} · SL${params.stopPts}/TP${params.eveningTargetPts} · confirm ${params.requireConfirm}`,
);

function replay(series: Candle[], label: string) {
  const out = replayPaperOnCrude({
    instrumentId: 'crude-oil-mini',
    instrumentName: 'Crude Oil Mini',
    candles: series,
    fromDate: today,
    toDate: today,
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    forceCloseOpen: false,
    lotsMultiplier: 1,
    enableMorning: params.defaultEnableMorning,
    enableEvening: params.defaultEnableEvening,
    tradeParams: params,
    dayLossStopPts: params.dayLossStopPts,
  });
  console.log(`\n--- ${label} (${series.length} bars) ---`);
  console.log(`closed trades today: ${out.trades.length}`);
  for (const t of out.trades) {
    console.log(
      `  ${t.entryTime.slice(11, 16)}→${t.exitTime.slice(11, 16)} ${t.direction} fut ${t.indexPoints.toFixed(1)} · ${t.exitReason}`,
    );
  }
  if (out.open) {
    const o = out.open as unknown as Record<string, unknown>;
    console.log(
      `open leg now: YES ${out.open.direction} · entryTime ${String(o['entryTime'])} · entry ${String(o['entry'])} · stop ${String(o['stop'])} · target ${String(o['target'])}`,
    );
  } else {
    console.log('open leg now: no');
  }
  console.log(`last signal: ${out.lastSignal}`);
}

replay(live, 'closed bars only (v1.3.79+)');
replay(raw, 'including the forming bar (pre-v1.3.79)');

const day = live.filter((c) => c.date.slice(11, 16) >= '10:00');
if (day.length) {
  const hi = Math.max(...day.map((c) => c.high));
  const lo = Math.min(...day.map((c) => c.low));
  console.log(
    `\nsince 10:00 — high ${hi.toFixed(0)} low ${lo.toFixed(0)} range ${(hi - lo).toFixed(0)} pts (SL is ${params.stopPts})`,
  );
}
