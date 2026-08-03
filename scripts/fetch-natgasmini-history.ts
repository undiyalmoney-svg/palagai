/**
 * Fetch NATGASMINI 5m history (merge monthly FUT contracts) → cache JSON.
 *
 * Auth (first found):
 *   KITE_AUTH env  |  .kite-auth file  |  environment.local.ts apiKey+accessToken
 *
 * Usage:
 *   FROM=2026-01-01 TO=2026-08-03 npx tsx scripts/fetch-natgasmini-history.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const OUT = join(root, 'reports/analyst-cache/natgasmini-5m-merged.json');
const META = join(root, 'reports/analyst-cache/natgasmini-5m-merged.meta.json');

const PREFIXES = (process.env.PREFIXES || 'NATGASMINI').split(',').map((s) => s.trim()).filter(Boolean);
const FROM = process.env.FROM ?? '2025-01-01 09:00:00';
const TO =
  process.env.TO ??
  `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} 23:15:00`;
const CHUNK_DAYS = 90;
const DELAY_MS = 1100;

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };

function normalizeAuth(raw: string): string {
  const a = raw.trim();
  return a.startsWith('token ') ? a : `token ${a}`;
}

/** Candidates in preference order — assertAuth picks the first that works. */
function authCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    if (!raw?.trim()) return;
    const a = normalizeAuth(raw);
    if (seen.has(a)) return;
    seen.add(a);
    out.push(a);
  };
  push(process.env.KITE_AUTH);
  const kiteAuthPath = join(root, '.kite-auth');
  if (existsSync(kiteAuthPath)) push(readFileSync(kiteAuthPath, 'utf8'));
  const localEnv = join(root, 'src/environments/environment.local.ts');
  if (existsSync(localEnv)) {
    const src = readFileSync(localEnv, 'utf8');
    const apiKey = src.match(/apiKey:\s*'([^']+)'/)?.[1];
    const accessToken = src.match(/accessToken:\s*'([^']+)'/)?.[1];
    if (apiKey && accessToken) push(`${apiKey}:${accessToken}`);
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function formatDt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}
function addDays(dateTime: string, days: number): string {
  const d = new Date(parseTs(dateTime));
  d.setDate(d.getDate() + days);
  return formatDt(d);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

async function fetchCandles(
  authorization: string,
  token: number,
  from: string,
  to: string,
): Promise<Candle[]> {
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${token}/5minute?${params}`;
  const res = await fetch(url, {
    headers: { 'X-Kite-Version': '3', Authorization: authorization },
  });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success') {
    throw new Error(body.message ?? `Kite historical failed ${res.status} token=${token}`);
  }
  return (body.data?.candles ?? []).map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

interface Contract {
  token: number;
  symbol: string;
  expiry: string;
  from: string;
  to: string;
}

async function loadContracts(authorization: string, fromDate: string, toDate: string): Promise<Contract[]> {
  const res = await fetch('https://api.kite.trade/instruments', {
    headers: { 'X-Kite-Version': '3', Authorization: authorization },
  });
  if (!res.ok) throw new Error(`instruments HTTP ${res.status}`);
  const csv = await res.text();
  const fromTs = parseTs(fromDate);
  const toTs = parseTs(toDate);
  const contracts: Contract[] = [];

  for (const line of csv.split('\n').slice(1)) {
    if (!line.includes('FUT') || !line.includes('MCX')) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const token = Number(cols[0]);
    const symbol = (cols[2] ?? '').trim();
    const expiry = (cols[5] ?? '').trim();
    const instrumentType = (cols[9] ?? '').trim();
    const exchange = (cols[11] ?? '').trim();
    if (!PREFIXES.some((p) => symbol.startsWith(p))) continue;
    if (exchange !== 'MCX' || instrumentType !== 'FUT') continue;
    if (!token || !expiry) continue;

    const expiryTs = parseTs(`${expiry} 23:59:59`);
    const startTs = expiryTs - 150 * 86400000;
    if (expiryTs < fromTs || startTs > toTs) continue;

    contracts.push({
      token,
      symbol,
      expiry,
      from: formatDt(new Date(Math.max(fromTs, startTs))),
      to: formatDt(new Date(Math.min(toTs, expiryTs))),
    });
  }

  contracts.sort((a, b) => parseTs(a.expiry) - parseTs(b.expiry));
  const byExpiry = new Map<string, Contract>();
  for (const c of contracts) {
    if (!byExpiry.has(c.expiry)) byExpiry.set(c.expiry, c);
  }
  return [...byExpiry.values()].sort((a, b) => parseTs(a.from) - parseTs(b.from));
}

async function fetchRange(
  authorization: string,
  token: number,
  from: string,
  to: string,
): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = from;
  const endTs = parseTs(to);
  while (parseTs(cursor) <= endTs) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1);
    const chunkTo = parseTs(chunkEnd) > endTs ? to : chunkEnd;
    const batch = await fetchCandles(authorization, token, cursor, chunkTo);
    all.push(...batch);
    cursor = addDays(chunkTo, 1);
    if (parseTs(cursor) <= endTs) await sleep(DELAY_MS);
  }
  return all;
}

async function probeAuth(authorization: string): Promise<string | null> {
  const res = await fetch('https://api.kite.trade/user/profile', {
    headers: { 'X-Kite-Version': '3', Authorization: authorization },
  });
  const body = (await res.json()) as { status?: string; message?: string };
  return body.status === 'success' ? null : (body.message ?? `HTTP ${res.status}`);
}

async function resolveWorkingAuth(): Promise<string> {
  const candidates = authCandidates();
  if (!candidates.length) {
    throw new Error('No Kite auth — set KITE_AUTH or .kite-auth / environment.local.ts');
  }
  const errors: string[] = [];
  for (const authorization of candidates) {
    const err = await probeAuth(authorization);
    if (!err) return authorization;
    errors.push(err);
  }
  throw new Error(
    `Kite auth failed (${errors[0]}). Refresh .kite-auth (apiKey + accessToken), then re-run.`,
  );
}

async function main(): Promise<void> {
  const authorization = await resolveWorkingAuth();
  console.log(`Auth OK. Fetch ${PREFIXES.join('|')} 5m ${FROM.slice(0, 10)} → ${TO.slice(0, 10)}`);

  const contracts = await loadContracts(authorization, FROM, TO);
  console.log(`Contracts in dump overlapping range: ${contracts.length}`);
  if (!contracts.length) throw new Error(`No ${PREFIXES.join('/')} FUT contracts in range`);

  const merged: Candle[] = [];
  const seen = new Set<string>();
  const used: Array<{ symbol: string; expiry: string; bars: number }> = [];
  let hardFail: string | null = null;

  for (let i = 0; i < contracts.length; i += 1) {
    const c = contracts[i]!;
    console.log(
      `[${i + 1}/${contracts.length}] ${c.symbol} exp ${c.expiry}  ${c.from.slice(0, 10)}→${c.to.slice(0, 10)}`,
    );
    try {
      const bars = await fetchRange(authorization, c.token, c.from, c.to);
      let added = 0;
      for (const b of bars) {
        if (seen.has(b.date)) continue;
        seen.add(b.date);
        merged.push(b);
        added += 1;
      }
      used.push({ symbol: c.symbol, expiry: c.expiry, bars: added });
      console.log(`  +${added} unique (merged ${merged.length})`);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`  SKIP ${c.symbol}: ${msg}`);
      if (/api_key|access_token|Incorrect|TokenException/i.test(msg)) hardFail = msg;
    }
    await sleep(DELAY_MS);
  }

  if (hardFail) throw new Error(`Aborting write — auth/API failure: ${hardFail}`);
  if (!merged.length) throw new Error('No bars fetched — leaving existing cache untouched');

  merged.sort((a, b) => a.date.localeCompare(b.date));
  mkdirSync(dirname(OUT), { recursive: true });
  if (existsSync(OUT)) {
    copyFileSync(OUT, `${OUT}.bak-${Date.now()}`);
  }
  writeFileSync(OUT, JSON.stringify(merged));
  writeFileSync(
    META,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        prefixes: PREFIXES,
        from: FROM,
        to: TO,
        bars: merged.length,
        first: merged[0]?.date ?? null,
        last: merged.at(-1)?.date ?? null,
        contractsUsed: used,
        rupeesPerPointHint: 50,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${OUT}`);
  console.log(`Bars ${merged.length} · ${merged[0]?.date} → ${merged.at(-1)?.date}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
