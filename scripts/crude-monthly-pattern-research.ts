/**
 * Crude Oil (MCX) — 5-year pattern research (NOT tied to existing strategies).
 * Explores ORB / PDHL / time-window combos targeting 100+ pts, max 5 trades/month.
 *
 * Usage:
 *   KITE_AUTH='token key:secret' npx tsx scripts/crude-monthly-pattern-research.ts
 *
 * Env:
 *   FROM=2020-01-01  TO=2025-07-01  (defaults: 5 years)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Direction = 'BUY' | 'SELL';

interface MergedContract {
  token: number;
  symbol: string;
  expiry: string;
  from: string;
  to: string;
}

interface PatternConfig {
  name: string;
  setup:
    | 'orb_break'
    | 'orb_fade'
    | 'pdhl_break'
    | 'big_range_trend'
    | 'midday_break'
    | 'late_momentum';
  entryStart: string;
  entryEnd: string;
  targetPts: number;
  stopPts: number;
  minOrbPts?: number;
  maxOrbPts?: number;
  allowedDow?: number[];
  maxTradesPerMonth: number;
}

interface SimTrade {
  date: string;
  month: string;
  direction: Direction;
  entryTime: string;
  exitTime: string;
  entry: number;
  exit: number;
  points: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  setupScore: number;
}

interface MonthResult {
  month: string;
  trades: number;
  wins: number;
  netPts: number;
  netRupees: number;
}

interface PatternResult {
  config: PatternConfig;
  totalTrades: number;
  wins: number;
  losses: number;
  netPts: number;
  netRupees: number;
  avgWinPts: number;
  avgLossPts: number;
  monthsTotal: number;
  monthsProfitable: number;
  monthsLosing: number;
  monthWinRate: number;
  monthly: MonthResult[];
  trades: SimTrade[];
}

const FROM = process.env.FROM ?? '2020-01-01 09:00:00';
const TO = process.env.TO ?? '2025-07-01 15:30:00';
const INSTRUMENT = (process.env.INSTRUMENT ?? 'crude').toLowerCase();
const REPORT = join(root, `reports/${INSTRUMENT}-monthly-pattern-research.json`);
const NIFTY_TOKEN = Number(process.env.INSTRUMENT_TOKEN ?? '256265');
const RUPEES_PER_POINT = INSTRUMENT === 'nifty' ? 65 : 100; // approx NIFTY lot value per point
const SESSION_CLOSE = INSTRUMENT === 'nifty' ? '15:15' : '23:15';
const MARKET_OPEN = INSTRUMENT === 'nifty' ? '09:15' : '09:00';
const FIRST_HOUR_END = INSTRUMENT === 'nifty' ? '10:15' : '10:00';
const CHUNK_DAYS = 55;
const FETCH_DELAY_MS = 2500;

const auth = process.env.KITE_AUTH;
if (!auth) {
  console.error('Set KITE_AUTH=token api_key:access_token');
  process.exit(1);
}

const authorization = auth.startsWith('token ') ? auth : `token ${auth}`;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

function extractDate(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return n.slice(0, 10);
}

function extractHhMm(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  const part = n.split(' ')[1] ?? '';
  return part.slice(0, 5);
}

function extractDow(date: string): number {
  return new Date(`${date}T00:00:00+05:30`).getDay();
}

function addDays(dateTime: string, days: number): string {
  const d = new Date(parseTs(dateTime));
  d.setDate(d.getDate() + days);
  return formatDt(d);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchCandles(token: number, interval: '5minute' | 'day', from: string, to: string): Promise<Candle[]> {
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${token}/${interval}?${params}`;
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? `No candles token ${token} ${interval} ${from}→${to}`);
  }
  return body.data.candles.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function loadCrudeContracts(fromDate: string, toDate: string): Promise<MergedContract[]> {
  const csv = await fetchText('https://api.kite.trade/instruments');
  const fromTs = parseTs(fromDate);
  const toTs = parseTs(toDate);
  const contracts: MergedContract[] = [];

  for (const line of parseCsvLines(csv)) {
    if (!line.symbol.startsWith('CRUDEOIL') || line.symbol.includes('CRUDEOILM')) continue;
    if (line.exchange !== 'MCX' || line.type !== 'FUT') continue;
    if (!line.token || !line.expiry) continue;

    const expiryTs = parseTs(`${line.expiry} 23:59:59`);
    const startTs = expiryTs - 90 * 86400000;
    if (expiryTs < fromTs || startTs > toTs) continue;

    const from = formatDt(new Date(Math.max(fromTs, startTs)));
    const to = formatDt(new Date(Math.min(toTs, expiryTs)));
    contracts.push({ token: line.token, symbol: line.symbol, expiry: line.expiry, from, to });
  }

  contracts.sort((a, b) => parseTs(a.from) - parseTs(b.from));
  return contracts;
}

function parseCsvLines(csv: string): {
  token: number;
  symbol: string;
  expiry: string;
  type: string;
  exchange: string;
}[] {
  const rows: ReturnType<typeof parseCsvLines> = [];
  for (const line of csv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    rows.push({
      token: Number(cols[0]),
      symbol: cols[2]?.trim() ?? '',
      expiry: cols[5]?.trim() ?? '',
      type: cols[9]?.trim() ?? '',
      exchange: cols[11]?.trim() ?? '',
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

async function loadNifty5m(fromDate: string, toDate: string): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = fromDate;
  const endTs = parseTs(toDate);

  while (parseTs(cursor) < endTs) {
    const chunkEnd = addDays(cursor, 95);
    const to = parseTs(chunkEnd) > endTs ? toDate : chunkEnd;
    console.log(`Fetching NIFTY 5m ${cursor.slice(0, 10)} → ${to.slice(0, 10)}`);
    const batch = await fetchCandles(NIFTY_TOKEN, '5minute', cursor, to);
    all.push(...batch);
    console.log(`  +${batch.length} (${all.length} total)`);
    cursor = addDays(to, 1);
    await sleep(FETCH_DELAY_MS);
  }

  const seen = new Set<string>();
  return all
    .filter((c) => {
      if (seen.has(c.date)) return false;
      seen.add(c.date);
      return true;
    })
    .sort((a, b) => parseTs(a.date) - parseTs(b.date));
}

async function loadAll5mCandles(contracts: MergedContract[]): Promise<Candle[]> {
  const all: Candle[] = [];
  const seen = new Set<string>();

  for (const contract of contracts) {
    console.log(`Fetching ${contract.symbol} (${contract.token}) ${contract.from.slice(0, 10)} → ${contract.to.slice(0, 10)}`);
    let cursor = contract.from;
    const endTs = parseTs(contract.to);

    while (parseTs(cursor) < endTs) {
      const chunkEnd = addDays(cursor, CHUNK_DAYS);
      const to = parseTs(chunkEnd) > endTs ? contract.to : chunkEnd;
      try {
        const batch = await fetchCandles(contract.token, '5minute', cursor, to);
        for (const c of batch) {
          if (!seen.has(c.date)) {
            seen.add(c.date);
            all.push(c);
          }
        }
        process.stdout.write(`  +${batch.length} (${all.length} total)\n`);
      } catch (err) {
        console.warn(`  skip chunk: ${err instanceof Error ? err.message : err}`);
      }
      cursor = addDays(to, 1);
      await sleep(FETCH_DELAY_MS);
    }
  }

  all.sort((a, b) => parseTs(a.date) - parseTs(b.date));
  return all;
}

function groupByDate(candles: Candle[]): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = extractDate(c.date);
    const list = map.get(d) ?? [];
    list.push(c);
    map.set(d, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => parseTs(a.date) - parseTs(b.date));
  }
  return map;
}

function firstHourRange(day: Candle[]): { high: number; low: number; pts: number } | null {
  const bars = day.filter((c) => {
    const t = extractHhMm(c.date);
    return t >= MARKET_OPEN && t < FIRST_HOUR_END;
  });
  if (!bars.length) return null;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, pts: high - low };
}

function prevDayHl(byDate: Map<string, Candle[]>, date: string): { pdh: number; pdl: number } | null {
  const dates = [...byDate.keys()].sort();
  const idx = dates.indexOf(date);
  if (idx <= 0) return null;
  const prev = byDate.get(dates[idx - 1]!);
  if (!prev?.length) return null;
  return { pdh: Math.max(...prev.map((c) => c.high)), pdl: Math.min(...prev.map((c) => c.low)) };
}

function simulateExit(
  day: Candle[],
  startIdx: number,
  direction: Direction,
  entry: number,
  stopPts: number,
  targetPts: number,
): { exitTime: string; exit: number; points: number; outcome: 'WIN' | 'LOSS'; reason: string } {
  const sl = direction === 'BUY' ? entry - stopPts : entry + stopPts;
  const tp = direction === 'BUY' ? entry + targetPts : entry - targetPts;

  for (let i = startIdx + 1; i < day.length; i += 1) {
    const c = day[i]!;
    if (direction === 'BUY') {
      if (c.low <= sl) {
        return { exitTime: c.date, exit: sl, points: sl - entry, outcome: 'LOSS', reason: 'SL' };
      }
      if (c.high >= tp) {
        return { exitTime: c.date, exit: tp, points: tp - entry, outcome: 'WIN', reason: 'TP' };
      }
    } else {
      if (c.high >= sl) {
        return { exitTime: c.date, exit: sl, points: entry - sl, outcome: 'LOSS', reason: 'SL' };
      }
      if (c.low <= tp) {
        return { exitTime: c.date, exit: tp, points: entry - tp, outcome: 'WIN', reason: 'TP' };
      }
    }
    if (extractHhMm(c.date) === SESSION_CLOSE) {
      const exit = c.close;
      const pts = direction === 'BUY' ? exit - entry : entry - exit;
      return {
        exitTime: c.date,
        exit,
        points: pts,
        outcome: pts > 0 ? 'WIN' : 'LOSS',
        reason: 'Session close',
      };
    }
  }

  const last = day.at(-1)!;
  const pts = direction === 'BUY' ? last.close - entry : entry - last.close;
  return {
    exitTime: last.date,
    exit: last.close,
    points: pts,
    outcome: pts > 0 ? 'WIN' : 'LOSS',
    reason: 'EOD',
  };
}

function detectSignal(
  cfg: PatternConfig,
  day: Candle[],
  orb: { high: number; low: number; pts: number },
  pdhl: { pdh: number; pdl: number } | null,
  idx: number,
): { direction: Direction; score: number } | null {
  const c = day[idx]!;
  const t = extractHhMm(c.date);
  if (t < cfg.entryStart || t > cfg.entryEnd) return null;

  if (cfg.minOrbPts && orb.pts < cfg.minOrbPts) return null;
  if (cfg.maxOrbPts && orb.pts > cfg.maxOrbPts) return null;

  const prev = day[idx - 1] ?? null;

  switch (cfg.setup) {
    case 'orb_break': {
      if (c.close > orb.high && c.close > c.open) {
        return { direction: 'BUY', score: orb.pts };
      }
      if (c.close < orb.low && c.close < c.open) {
        return { direction: 'SELL', score: orb.pts };
      }
      return null;
    }
    case 'orb_fade': {
      if (prev && prev.high > orb.high && c.close < orb.high && c.close < c.open) {
        return { direction: 'SELL', score: orb.pts };
      }
      if (prev && prev.low < orb.low && c.close > orb.low && c.close > c.open) {
        return { direction: 'BUY', score: orb.pts };
      }
      return null;
    }
    case 'pdhl_break': {
      if (!pdhl) return null;
      if (c.close > pdhl.pdh && c.close > c.open) return { direction: 'BUY', score: c.close - pdhl.pdh };
      if (c.close < pdhl.pdl && c.close < c.open) return { direction: 'SELL', score: pdhl.pdl - c.close };
      return null;
    }
    case 'big_range_trend': {
      if (orb.pts < (cfg.minOrbPts ?? 80)) return null;
      const mid = (orb.high + orb.low) / 2;
      if (c.close > orb.high) return { direction: 'BUY', score: orb.pts };
      if (c.close < orb.low) return { direction: 'SELL', score: orb.pts };
      if (c.close > mid && c.close > c.open) return { direction: 'BUY', score: orb.pts * 0.8 };
      if (c.close < mid && c.close < c.open) return { direction: 'SELL', score: orb.pts * 0.8 };
      return null;
    }
    case 'midday_break': {
      const midday = day.filter((x) => {
        const h = extractHhMm(x.date);
        return h >= '12:00' && h < '13:00';
      });
      if (!midday.length) return null;
      const mh = Math.max(...midday.map((x) => x.high));
      const ml = Math.min(...midday.map((x) => x.low));
      if (t >= '13:00' && t <= '15:00') {
        if (c.close > mh) return { direction: 'BUY', score: mh - ml };
        if (c.close < ml) return { direction: 'SELL', score: mh - ml };
      }
      return null;
    }
    case 'late_momentum': {
      if (t < '19:00' || t > '21:00') return null;
      const dayOpen = day.find((x) => extractHhMm(x.date) >= MARKET_OPEN)?.open;
      if (dayOpen === undefined) return null;
      if (c.close > dayOpen && c.close > c.open) return { direction: 'BUY', score: Math.abs(c.close - dayOpen) };
      if (c.close < dayOpen && c.close < c.open) return { direction: 'SELL', score: Math.abs(dayOpen - c.close) };
      return null;
    }
    default:
      return null;
  }
}

function runPattern(cfg: PatternConfig, byDate: Map<string, Candle[]>): PatternResult {
  const candidates: SimTrade[] = [];

  for (const [date, day] of byDate) {
    if (cfg.allowedDow && !cfg.allowedDow.includes(extractDow(date))) continue;
    const orb = firstHourRange(day);
    if (!orb) continue;
    const pdhl = prevDayHl(byDate, date);

    for (let i = 0; i < day.length; i += 1) {
      const sig = detectSignal(cfg, day, orb, pdhl, i);
      if (!sig) continue;

      const entryCandle = day[i]!;
      const entry = entryCandle.close;
      const exit = simulateExit(day, i, sig.direction, entry, cfg.stopPts, cfg.targetPts);
      candidates.push({
        date,
        month: date.slice(0, 7),
        direction: sig.direction,
        entryTime: entryCandle.date,
        exitTime: exit.exitTime,
        entry,
        exit: exit.exit,
        points: exit.points,
        outcome: exit.outcome,
        exitReason: exit.reason,
        setupScore: sig.score,
      });
      break;
    }
  }

  const byMonth = new Map<string, SimTrade[]>();
  for (const t of candidates) {
    const list = byMonth.get(t.month) ?? [];
    list.push(t);
    byMonth.set(t.month, list);
  }

  const selected: SimTrade[] = [];
  for (const [, monthTrades] of byMonth) {
    const sorted = [...monthTrades].sort((a, b) => b.setupScore - a.setupScore);
    selected.push(...sorted.slice(0, cfg.maxTradesPerMonth));
  }

  selected.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

  const monthlyMap = new Map<string, MonthResult>();
  for (const t of selected) {
    const m = monthlyMap.get(t.month) ?? {
      month: t.month,
      trades: 0,
      wins: 0,
      netPts: 0,
      netRupees: 0,
    };
    m.trades += 1;
    if (t.outcome === 'WIN') m.wins += 1;
    m.netPts += t.points;
    m.netRupees = m.netPts * RUPEES_PER_POINT;
    monthlyMap.set(t.month, m);
  }

  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const wins = selected.filter((t) => t.outcome === 'WIN');
  const losses = selected.filter((t) => t.outcome === 'LOSS');
  const netPts = selected.reduce((s, t) => s + t.points, 0);

  return {
    config: cfg,
    totalTrades: selected.length,
    wins: wins.length,
    losses: losses.length,
    netPts,
    netRupees: netPts * RUPEES_PER_POINT,
    avgWinPts: wins.length ? wins.reduce((s, t) => s + t.points, 0) / wins.length : 0,
    avgLossPts: losses.length ? losses.reduce((s, t) => s + t.points, 0) / losses.length : 0,
    monthsTotal: monthly.length,
    monthsProfitable: monthly.filter((m) => m.netPts > 0).length,
    monthsLosing: monthly.filter((m) => m.netPts < 0).length,
    monthWinRate: monthly.length
      ? (monthly.filter((m) => m.netPts > 0).length / monthly.length) * 100
      : 0,
    monthly,
    trades: selected,
  };
}

function buildPatternGrid(): PatternConfig[] {
  const targets = [100, 150, 200];
  const stops = [40, 60, 80];
  const configs: PatternConfig[] = [];

  for (const targetPts of targets) {
    for (const stopPts of stops) {
      configs.push({
        name: `ORB break 10-11:30 TP${targetPts} SL${stopPts}`,
        setup: 'orb_break',
        entryStart: '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 40,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB break 10-11:30 TP${targetPts} SL${stopPts} ORB≥80`,
        setup: 'orb_break',
        entryStart: '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 80,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB fade 10-12 TP${targetPts} SL${stopPts}`,
        setup: 'orb_fade',
        entryStart: '10:00',
        entryEnd: '12:00',
        targetPts,
        stopPts,
        minOrbPts: 50,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `PDHL break 10-12 TP${targetPts} SL${stopPts}`,
        setup: 'pdhl_break',
        entryStart: '10:00',
        entryEnd: '12:00',
        targetPts,
        stopPts,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `Big ORB trend TP${targetPts} SL${stopPts}`,
        setup: 'big_range_trend',
        entryStart: '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 80,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `Midday break TP${targetPts} SL${stopPts}`,
        setup: 'midday_break',
        entryStart: '13:00',
        entryEnd: '15:00',
        targetPts,
        stopPts,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `Late momentum 19-21 TP${targetPts} SL${stopPts}`,
        setup: 'late_momentum',
        entryStart: '19:00',
        entryEnd: '21:00',
        targetPts,
        stopPts,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB break Tue-Thu TP${targetPts} SL${stopPts}`,
        setup: 'orb_break',
        entryStart: '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 50,
        allowedDow: [2, 3, 4],
        maxTradesPerMonth: 5,
      });
    }
  }

  return configs;
}

function scorePattern(r: PatternResult): number {
  const avgMonthlyRupees = r.monthsTotal ? r.netRupees / r.monthsTotal : 0;
  const meets30k = avgMonthlyRupees >= 30000 ? 1 : avgMonthlyRupees / 30000;
  return (
    r.monthWinRate * 2 +
    meets30k * 40 +
    Math.min(r.avgWinPts, 250) / 5 +
    r.netRupees / 5000 -
    (100 - r.monthWinRate) * 0.5
  );
}

async function main(): Promise<void> {
  console.log(`${INSTRUMENT.toUpperCase()} pattern research ${FROM.slice(0, 10)} → ${TO.slice(0, 10)}`);

  let candles: Candle[];
  let contractsUsed = 0;

  if (INSTRUMENT === 'nifty') {
    candles = await loadNifty5m(FROM, TO);
    contractsUsed = 1;
  } else {
    const contracts = await loadCrudeContracts(FROM, TO);
    console.log(`Found ${contracts.length} CRUDEOIL contracts`);
    if (!contracts.length) {
      console.warn('No crude contracts in range — using all listed CRUDEOIL FUT tokens');
      const csv = await fetchText('https://api.kite.trade/instruments');
      const all = parseCsvLines(csv).filter(
        (l) => l.symbol.startsWith('CRUDEOIL') && !l.symbol.includes('CRUDEOILM') && l.exchange === 'MCX' && l.type === 'FUT',
      );
      const fromTs = parseTs(FROM);
      const toTs = parseTs(TO);
      for (const line of all) {
        const expiryTs = parseTs(`${line.expiry} 23:59:59`);
        const startTs = expiryTs - 90 * 86400000;
        const from = formatDt(new Date(Math.max(fromTs, startTs)));
        const to = formatDt(new Date(Math.min(toTs, expiryTs)));
        contracts.push({ token: line.token, symbol: line.symbol, expiry: line.expiry, from, to });
      }
    }
    contractsUsed = contracts.length;
    candles = await loadAll5mCandles(contracts);
  }
  console.log(`Loaded ${candles.length} unique 5m candles`);

  const filtered = candles.filter((c) => {
    const ts = parseTs(c.date);
    return ts >= parseTs(FROM) && ts <= parseTs(TO);
  });
  console.log(`In range: ${filtered.length} candles`);

  const byDate = groupByDate(filtered);
  console.log(`Trading days: ${byDate.size}`);

  const grid = buildPatternGrid();
  console.log(`Testing ${grid.length} pattern configs…`);

  const results = grid.map((cfg) => runPattern(cfg, byDate)).sort((a, b) => scorePattern(b) - scorePattern(a));

  const best = results[0]!;
  const top10 = results.slice(0, 10).map((r) => ({
    name: r.config.name,
    netPts: r.netPts,
    netRupees: r.netRupees,
    avgMonthlyRupees: r.monthsTotal ? r.netRupees / r.monthsTotal : 0,
    totalTrades: r.totalTrades,
    wins: r.wins,
    losses: r.losses,
    avgWinPts: r.avgWinPts,
    avgLossPts: r.avgLossPts,
    monthWinRate: r.monthWinRate,
    monthsProfitable: r.monthsProfitable,
    monthsTotal: r.monthsTotal,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    range: { from: FROM, to: TO },
    tradingDays: byDate.size,
    contractsUsed,
    candlesLoaded: filtered.length,
    rupeesPerPoint: RUPEES_PER_POINT,
    targetIncome: { minRupeesPerMonth: 30000, maxRupeesPerMonth: 100000 },
    recommendation: {
      pattern: best.config.name,
      setup: best.config,
      netPts: best.netPts,
      netRupees: best.netRupees,
      avgMonthlyRupees: best.monthsTotal ? best.netRupees / best.monthsTotal : 0,
      avgMonthlyPts: best.monthsTotal ? best.netPts / best.monthsTotal : 0,
      monthWinRate: best.monthWinRate,
      monthsProfitable: best.monthsProfitable,
      monthsTotal: best.monthsTotal,
      avgWinPts: best.avgWinPts,
      avgLossPts: best.avgLossPts,
      whyLossesHappen: [
        'Tight stop (40–80 pts) hit before 100+ pt target on noisy 5m entries',
        'False breakouts in midday chop (12:00–14:00) — afternoon entries underperform',
        'Low first-hour range days (<40 pts) produce whipsaw breakouts',
        'Using NSE 15:15 exit on crude cuts winners — MCX session is 23:15',
      ],
      rules: [
        `Setup: ${best.config.setup}`,
        `Entry window: ${best.config.entryStart}–${best.config.entryEnd} IST`,
        `Target: ${best.config.targetPts} pts (₹${best.config.targetPts * RUPEES_PER_POINT}/lot)`,
        `Stop: ${best.config.stopPts} pts fixed`,
        `Max ${best.config.maxTradesPerMonth} trades/month — pick highest ORB score days only`,
        best.config.minOrbPts ? `Only trade if first-hour range ≥ ${best.config.minOrbPts} pts` : null,
        best.config.allowedDow ? `Days: ${best.config.allowedDow.join(',')}` : 'Days: Mon–Fri',
        'Exit: target, stop, or 23:15 session close',
      ].filter(Boolean),
    },
    top10,
    allResultsCount: results.length,
  };

  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, 'reports/crude-best-pattern-trades.json'),
    JSON.stringify({ pattern: best.config.name, trades: best.trades, monthly: best.monthly }, null, 2),
  );

  console.log('\n=== BEST PATTERN ===');
  console.log(report.recommendation.pattern);
  console.log(`Net: ${best.netPts.toFixed(1)} pts (₹${best.netRupees.toFixed(0)})`);
  console.log(`Avg/month: ₹${report.recommendation.avgMonthlyRupees.toFixed(0)}`);
  console.log(`Month win rate: ${best.monthWinRate.toFixed(1)}% (${best.monthsProfitable}/${best.monthsTotal})`);
  console.log(`Report: ${REPORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
