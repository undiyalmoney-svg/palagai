/**
 * One Sniper tick: Bank Nifty 15-min ORB, first 5m close below the range, ATM PE.
 * Always quotes the chosen Bank PE so the UI can show live market every minute.
 * No Angular. Live Kite overlay is after this.
 */
import { Instrument } from '../models/instrument.model';
import { kiteBar } from '../paper-desk/kite-bar.util';
import { parseKiteInstrumentsCsv } from '../utils/csv.util';
import { pickCheapOtm } from '../utils/pick-cheap-otm.util';
import {
  SniperBar,
  SniperBookCfg,
  SNIPER_BOOKS,
  SniperPick,
  SniperQuote,
  SniperSession,
  SniperUnder,
} from './sniper.models';
import { sniperIstDay, sniperIstMinutes } from './sniper-clock';
import { emptySniperSession, sniperWantType, summarizeSniper, tickSniperDesk } from './sniper-engine';

export type SniperTickQuote = {
  last_price?: number;
  timestamp?: string;
  last_trade_time?: string;
  depth?: {
    buy?: { price?: number; quantity?: number }[];
    sell?: { price?: number; quantity?: number }[];
  };
};

export type SniperTickIo = {
  now?: Date;
  session: SniperSession;
  fetchCsv: () => Promise<string>;
  fetchQuotes: (keys: string[]) => Promise<Record<string, SniperTickQuote>>;
  fetchHistorical: (token: string, interval: string, from: string, to: string) => Promise<unknown[][]>;
};

type Named = { tradingSymbol: string; token: number; exchange: string };

function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function findNamed(csv: string, names: string[]): Named | null {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    const itype = cols[9].trim().toUpperCase();
    if (itype === 'CE' || itype === 'PE') continue;
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}

function findQuote(quotes: Record<string, SniperTickQuote>, key: string): SniperTickQuote | null {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}

export function sniperBestBidAsk(q: SniperTickQuote | null): { bid: number | null; ask: number | null } {
  const bid = Number(q?.depth?.buy?.[0]?.price);
  const ask = Number(q?.depth?.sell?.[0]?.price);
  return {
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null,
  };
}

function lastOf(quotes: Record<string, SniperTickQuote>, key: string): number | null {
  const n = Number(findQuote(quotes, key)?.last_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function underKey(cfg: SniperBookCfg): string {
  return `${cfg.underExchange}:${cfg.underNames[0]}`;
}

function optionKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

function optionPremiumPx(px: number | null | undefined, underLast?: number | null): number | null {
  const p = Number(px);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (p >= 5_000) return null;
  const spot = Number(underLast);
  if (Number.isFinite(spot) && spot > 1_000 && p >= spot * 0.2) return null;
  return p;
}

function asBar(row: unknown[]): SniperBar {
  const b = kiteBar(row);
  return { day: b.day, min: b.min, open: b.open, high: b.high, low: b.low, close: b.close };
}

async function loadBars(
  fetchHistorical: SniperTickIo['fetchHistorical'],
  token: string,
  day: string,
  interval: '5minute' | 'minute',
): Promise<SniperBar[]> {
  if (!token) return [];
  const candles = await fetchHistorical(token, interval, day, day).catch(() => [] as unknown[][]);
  return (candles || []).map(asBar).filter((b) => b.day);
}

function atmPick(
  chain: Instrument[],
  cfg: SniperBookCfg,
  optionType: 'CE' | 'PE',
  spot: number,
  asOf: Date,
): SniperPick | null {
  const picked = pickCheapOtm({
    instruments: chain,
    book: cfg.id,
    direction: optionType === 'CE' ? 'BUY' : 'SELL',
    spot,
    asOf,
    premiumBudgetRs: 10_000_000,
    otmPts: 0,
  });
  const listed = picked.source === 'chain' && picked.instrument.instrumentToken > 0;
  return {
    optionType: picked.side,
    strike: picked.strike,
    expiry: picked.expiry,
    optionSymbol: picked.instrument.tradingSymbol,
    optionToken: picked.instrument.instrumentToken,
    lotSize: picked.lotSize,
    listed,
  };
}

const FALLBACK: Record<SniperUnder, Named> = {
  bank: { tradingSymbol: 'NIFTY BANK', token: 260105, exchange: 'NSE' },
};

export async function runSniperTick(io: SniperTickIo): Promise<SniperSession> {
  const now = io.now || new Date();
  const day = io.session.replayDay || sniperIstDay(now);
  const nowMin = sniperIstMinutes(now);
  const raw =
    io.session.day === day
      ? io.session
      : emptySniperSession(day, now.toISOString(), io.session);
  const csv = String((await io.fetchCsv()) || '');
  const chain = parseKiteInstrumentsCsv(csv);
  const named: Partial<Record<SniperUnder, Named | null>> = {};
  for (const cfg of SNIPER_BOOKS) {
    named[cfg.id] = findNamed(csv, cfg.underNames) || FALLBACK[cfg.id];
  }
  const underKeys = SNIPER_BOOKS.map((cfg) => underKey(cfg)).filter(Boolean);
  const openKeys = raw.books
    .filter((b) => b.side !== 'flat' && b.optionSymbol)
    .map((b) => optionKey(SNIPER_BOOKS.find((c) => c.id === b.id)?.exchange || 'NFO', b.optionSymbol));
  let quotes = await io.fetchQuotes([...new Set([...underKeys, ...openKeys])]);

  const barsBy: Partial<Record<SniperUnder, SniperBar[]>> = {};
  const minutesBy: Partial<Record<SniperUnder, SniperBar[]>> = {};
  await Promise.all(
    SNIPER_BOOKS.map(async (cfg) => {
      const inst = named[cfg.id];
      if (!inst?.token) {
        barsBy[cfg.id] = [];
        minutesBy[cfg.id] = [];
        return;
      }
      const token = String(inst.token);
      const [five, one] = await Promise.all([
        loadBars(io.fetchHistorical, token, day, '5minute'),
        loadBars(io.fetchHistorical, token, day, 'minute'),
      ]);
      barsBy[cfg.id] = five;
      minutesBy[cfg.id] = one;
    }),
  );

  const nowIso = now.toISOString();
  const spots: Partial<Record<SniperUnder, number | null>> = {};
  for (const cfg of SNIPER_BOOKS) {
    spots[cfg.id] = lastOf(quotes, underKey(cfg));
  }
  const probe =
    raw.selected || raw.books.some((b) => b.side === 'long' || b.fills.length > 0)
      ? raw
      : tickSniperDesk(raw, barsBy, spots, {}, day, nowMin, nowIso, minutesBy);
  const selected = probe.selected;
  const cutDir = probe.books.find((b) => b.id === selected)?.cut || probe.books.find((b) => b.id === selected)?.breakDir || '';
  const want = selected ? sniperWantType(cutDir) : 'PE';

  const extra: string[] = [];
  const picks = new Map<SniperUnder, SniperPick | null>();
  for (const cfg of SNIPER_BOOKS) {
    const book = probe.books.find((b) => b.id === cfg.id);
    const spot = spots[cfg.id];
    const openType = book?.side === 'long' && (book.optionType === 'CE' || book.optionType === 'PE') ? book.optionType : null;
    // Always quote ATM PE so the chosen instrument is on the tape before the cut.
    const fadeType: 'CE' | 'PE' = openType || want || 'PE';
    if (spot && fadeType) {
      const pick = atmPick(chain, cfg, fadeType, spot, now);
      picks.set(cfg.id, pick);
      if (pick?.listed) extra.push(optionKey(cfg.exchange, pick.optionSymbol));
    } else {
      picks.set(cfg.id, null);
    }
  }
  const need = extra.filter((k) => !underKeys.includes(k) && !openKeys.includes(k));
  if (need.length) quotes = { ...quotes, ...((await io.fetchQuotes(need)) || {}) };

  const feed: Partial<Record<SniperUnder, { opt: SniperQuote; pick: SniperPick | null }>> = {};
  for (const cfg of SNIPER_BOOKS) {
    const prev = probe.books.find((b) => b.id === cfg.id)!;
    const pick = picks.get(cfg.id) || null;
    const okey = prev.optionSymbol
      ? optionKey(cfg.exchange, prev.optionSymbol)
      : pick?.listed
        ? optionKey(cfg.exchange, pick.optionSymbol)
        : '';
    const q = okey ? findQuote(quotes, okey) : null;
    const { bid, ask } = sniperBestBidAsk(q);
    const last = optionPremiumPx(q?.last_price, spots[cfg.id]) ?? optionPremiumPx(prev.last, spots[cfg.id]);
    feed[cfg.id] = {
      pick,
      opt: {
        bid: optionPremiumPx(bid, spots[cfg.id]),
        ask: optionPremiumPx(ask, spots[cfg.id]),
        last,
      },
    };
  }

  const next = tickSniperDesk(probe, barsBy, spots, feed, day, nowMin, nowIso, minutesBy);
  return summarizeSniper(raw, {
    ...next,
    running: true,
    asOf: nowIso,
    source: 'kite',
    kiteError: null,
    startedAt: raw.startedAt || nowIso,
  });
}
