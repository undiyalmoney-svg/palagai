/**
 * Replays one IST day of the Paper test desk on real Kite minute data, minute by minute, through the same engine.
 * Paper research only: no order endpoint is called. The Kite token is read from the environment, never stored.
 *   KITE_AUTH="token <api_key>:<access_token>" DAY=2026-11-04 \
 *     npx esbuild tools/paper-replay.ts --bundle --platform=node --outfile=/tmp/paper-replay.js && node /tmp/paper-replay.js
 * Options: UNTIL_MIN (IST minute to stop), BOOKS=crude,nifty, RULES=old (pre-4-Nov engine build), VOL=0, MAXRISK=<rs>,
 * ONE_INDEX=1, JSON=1. Fills use the 1-minute close (live buys at the ask, so live is slightly worse).
 * Past days can only use contracts still listed today; thin old contracts can skip prints and gap past stops.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as E from '../src/app/core/paper-desk/live-paper.engine';
import { pickCheapOtm } from '../src/app/core/utils/pick-cheap-otm.util';
import { parseKiteInstrumentsCsv } from '../src/app/core/utils/csv.util';
import { optionRoundTripCharges, venueForBook } from '../src/app/core/paper-desk/option-charges.util';

const AUTH = process.env.KITE_AUTH || '';
if (!AUTH) throw new Error('Set KITE_AUTH="token <api_key>:<access_token>"');
const CACHE = process.env.REPLAY_CACHE || path.join(os.tmpdir(), 'paper-replay');
fs.mkdirSync(CACHE, { recursive: true });
const TODAY = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const DAY = process.env.DAY || new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const UNTIL = Number(process.env.UNTIL_MIN || 24 * 60);
const NEW = process.env.RULES !== 'old';
const OVR = process.env.OVR ? JSON.parse(process.env.OVR) : {};
const BOOKS = (process.env.BOOKS || 'crude,nifty,bank,sensex').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function candles(token: number, interval: string, from: string, to: string): Promise<unknown[][]> {
  const f = path.join(CACHE, `${token}-${interval}-${from}-${to}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) {
    await sleep(380);
    const r = await fetch(
      `https://api.kite.trade/instruments/historical/${token}/${interval}?from=${from}+00:00:00&to=${to}+23:59:59`,
      { headers: { 'X-Kite-Version': '3', Authorization: AUTH } },
    );
    const j: any = await r.json();
    if (j.status === 'success') {
      const c = j.data.candles || [];
      if (to < TODAY) fs.writeFileSync(f, JSON.stringify(c));
      return c;
    }
    if (!String(j.message || '').includes('Too many')) throw new Error(`${token} ${j.message}`);
  }
  return [];
}

function bar(row: unknown[]) {
  const raw = String(row[0]);
  return {
    day: raw.slice(0, 10),
    min: Number(raw.slice(11, 13)) * 60 + Number(raw.slice(14, 16)),
    open: +row[1]!, high: +row[2]!, low: +row[3]!, close: +row[4]!,
  };
}

function shift(day: string, d: number) {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

async function instrumentsCsv(): Promise<string> {
  const f = path.join(CACHE, `instruments-${TODAY}.csv`);
  if (!fs.existsSync(f)) {
    const r = await fetch('https://api.kite.trade/instruments', { headers: { 'X-Kite-Version': '3', Authorization: AUTH } });
    fs.writeFileSync(f, await r.text());
  }
  return fs.readFileSync(f, 'utf8');
}
let csv = '';
let chain: any[] = [];
let UNDER: Record<string, number> = {};
function crudeFut(): number {
  const rows = csv.split('\n').map((l) => l.split(',')).filter((c) => c[11]?.trim() === 'MCX' && c[9] === 'FUT' && c[2].startsWith('CRUDEOILM'));
  rows.sort((a, b) => a[5].localeCompare(b[5]));
  return Number(rows.find((r) => r[5] > DAY)![0]);
}

async function run() {
  csv = await instrumentsCsv();
  chain = parseKiteInstrumentsCsv(csv);
  UNDER = { crude: crudeFut(), nifty: 256265, bank: 260105, sensex: 265 };
  const out: any[] = [];
  const skips: any[] = [];
  const S: Record<string, any> = {};
  for (const id of BOOKS) {
    const cfg = { ...E.LIVE_PAPER_BOOKS.find((c: any) => c.id === id)!, ...(OVR[id] || OVR.all || {}) };
    const b5 = (await candles(UNDER[id], '5minute', shift(DAY, -8), DAY)).map(bar);
    const b1 = (await candles(UNDER[id], 'minute', DAY, DAY)).map(bar);
    S[id] = { cfg, b5, last1: new Map(b1.map((b) => [b.min, b.close])), book: E.emptyBook(cfg),
      start: id === 'crude' ? 9 * 60 + 1 : 9 * 60 + 16, end: Math.min(UNTIL, id === 'crude' ? 23 * 60 + 30 : 15 * 60 + 30) };
  }
  const opt5: Record<number, any[]> = {};
  const opt1: Record<number, Map<number, number>> = {};
  const ONE_INDEX = process.env.ONE_INDEX === '1';
  for (let now = 9 * 60 + 1; now <= 23 * 60 + 30; now++) {
    for (const id of BOOKS) {
      const st = S[id];
      if (now < st.start || now > st.end) continue;
      const { cfg, b5, last1 } = st;
      let book = st.book;
      const underLast = last1.get(now - 1) ?? null;
      if (underLast == null && book.side === 'flat') continue;
      let optBars: any[] = [];
      let lastTick = underLast;
      if (book.side !== 'flat' && book.optionToken) {
        optBars = opt5[book.optionToken].filter((b: any) => b.day === DAY);
        lastTick = opt1[book.optionToken].get(now - 1) ?? book.last;
      }
      const prevFills = book.fills.length;
      let next = E.tickBook(book, cfg, b5.filter((b: any) => b.day < DAY || b.min + 5 <= now), lastTick, DAY, now, book.optionSymbol || id, optBars);
      const needs = NEW ? next.side !== 'flat' && !next.optionSymbol : book.side === 'flat' && next.side !== 'flat' && !next.optionSymbol;
      if (needs) {
        const asOf = new Date(Date.parse(`${DAY}T00:00:00+05:30`) + now * 60_000 + (NEW ? 86_400_000 : 0));
        const pick = pickCheapOtm({ instruments: chain, book: id, direction: next.side === 'long' ? 'BUY' : 'SELL', spot: underLast ?? next.entry!, asOf, premiumBudgetRs: 1e7 });
        const tok = pick.instrument.instrumentToken;
        if (!opt5[tok]) {
          opt5[tok] = (await candles(tok, '5minute', shift(DAY, -3), DAY)).map(bar);
          opt1[tok] = new Map((await candles(tok, 'minute', DAY, DAY)).map(bar).map((b) => [b.min, b.close]));
        }
        const prem = opt1[tok].get(now - 1);
        const flat = (why: string) => {
          skips.push({ id, now, why, sym: pick.instrument.tradingSymbol });
          return { ...next, side: 'flat', entry: null, sl: null, tp: null, scratch: null, status: 'watching' };
        };
        const clash = ONE_INDEX && id !== 'crude' && BOOKS.some((o) => o !== id && o !== 'crude' && S[o].book.side !== 'flat' && S[o].book.optionType === pick.side);
        if (!prem) next = flat('no option print');
        else if (clash) next = flat('index-clash');
        else {
          const done = E.completedBars(opt5[tok], DAY, now);
          const range = NEW && process.env.VOL !== '0' ? E.optionRangePts(done) : null;
          let blocked = false;
          if (NEW) {
            const stop = E.optionStopPts(cfg, range);
            const sl = Math.min(stop.sl, prem - 0.05);
            const risk = sl * pick.lotSize + optionRoundTripCharges(prem, prem - sl, pick.lotSize, venueForBook(id));
            if (next.closedRs < 0 && -next.closedRs > risk) blocked = true;
            if (process.env.MAXRISK && risk > Number(process.env.MAXRISK)) blocked = true;
          }
          if (blocked) next = flat('day-stop');
          else {
            next = NEW ? E.bindOptionFill(next, cfg, prem, pick, range) : E.bindOptionFill(next, cfg, prem, pick);
            next = { ...next, lastBarMin: now - (now % 5), entryAt: `${Math.floor(now / 60)}:${String(now % 60).padStart(2, '0')}` } as any;
          }
        }
      }
      for (const f of next.fills.slice(prevFills)) (f as any).exitAt = `${Math.floor(now / 60)}:${String(now % 60).padStart(2, '0')}`;
      st.book = next;
    }
  }
  for (const id of BOOKS) {
    let book = S[id].book;
    if (book.side !== 'flat' && book.last != null) book = E.tickBook(book, S[id].cfg, [], book.last, DAY, 24 * 60, book.instrument, []);
    for (const f of book.fills) out.push(f);
  }
  const tot = out.reduce((s, f) => s + f.rs, 0);
  if (process.env.JSON) {
    console.log(JSON.stringify({ day: DAY, n: out.length, total: Math.round(tot), wins: out.filter((f) => f.rs > 0).length, fills: out, skips }));
    return;
  }
  for (const f of out) {
    console.log(
      [f.book.padEnd(6), f.entryAt, '→', f.exitAt, (f.optionSymbol || '').padEnd(22), f.mode.padEnd(6), (f.structure || '').padEnd(6),
        `${f.entry}→${f.exit}`.padEnd(16), `sl ${f.sl} tp ${f.tp}`.padEnd(22), f.reason.padEnd(7), `₹${f.rs}`].join(' '),
    );
  }
  for (const s of skips) console.log('skip', s.id, Math.floor(s.now / 60) + ':' + String(s.now % 60).padStart(2, '0'), s.why, s.sym);
  console.log(`${DAY} ${NEW ? 'NEW' : 'OLD'} trades ${out.length} total ₹${Math.round(tot)}`);
}
run().catch((e) => { console.error(e); process.exit(1); });
