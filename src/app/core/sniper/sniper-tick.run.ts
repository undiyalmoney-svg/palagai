/**
 * One Sniper tick: completed 5-minute underlying candles, fade ATM CE/PE, bind, mark.
 * Green 5m → ATM PE. Red 5m → ATM CE. No Angular. Live Kite overlay is after this.
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
import { barAt, completedSniperBars, sniperIstDay, sniperIstMinutes, sniperPrevCandleMin } from './sniper-clock';
import { candleDir, emptySniperSession, sniperFadeType, summarizeSniper, tickSniperBook } from './sniper-engine';

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

function findCrudeMini(csv: string, today: string): Named | null {
  const rows: { tradingSymbol: string; token: number; exchange: string; expiry: string }[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== 'MCX' || cols[9].trim().toUpperCase() !== 'FUT') continue;
    if (!cols[2].toUpperCase().startsWith('CRUDEOILM')) continue;
    const exp = /^(\d{4}-\d{2}-\d{2})/.exec((cols[5] || '').trim());
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: 'MCX',
      expiry: exp ? exp[1] : '',
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return (
    rows.find((r) => !r.expiry || r.expiry > today) ||
    rows.find((r) => r.expiry >= today) ||
    rows[0] ||
    null
  );
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

function underKey(cfg: SniperBookCfg, inst: Named | null): string {
  if (cfg.id === 'nifty') return 'NSE:NIFTY 50';
  if (cfg.id === 'bank') return 'NSE:NIFTY BANK';
  if (cfg.id === 'sensex') return 'BSE:SENSEX';
  return inst ? `MCX:${inst.tradingSymbol}` : '';
}

function optionKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

/** CE/PE last/ask. Index last prices must never be treated as a premium. */
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

async function load5m(
  fetchHistorical: SniperTickIo['fetchHistorical'],
  token: string,
  day: string,
): Promise<SniperBar[]> {
  if (!token) return [];
  const candles = await fetchHistorical(token, '5minute', day, day).catch(() => [] as unknown[][]);
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
  nifty: { tradingSymbol: 'NIFTY 50', token: 256265, exchange: 'NSE' },
  bank: { tradingSymbol: 'NIFTY BANK', token: 260105, exchange: 'NSE' },
  sensex: { tradingSymbol: 'SENSEX', token: 265, exchange: 'BSE' },
  crude: { tradingSymbol: 'CRUDEOILM', token: 0, exchange: 'MCX' },
};

export async function runSniperTick(io: SniperTickIo): Promise<SniperSession> {
  const now = io.now || new Date();
  const day = io.session.replayDay || sniperIstDay(now);
  const nowMin = sniperIstMinutes(now);
  const raw = io.session.day === day ? io.session : emptySniperSession(day, now.toISOString());
  const csv = String((await io.fetchCsv()) || '');
  const chain = parseKiteInstrumentsCsv(csv);
  const named: Record<SniperUnder, Named | null> = {
    nifty: findNamed(csv, ['NIFTY 50']) || FALLBACK.nifty,
    bank: findNamed(csv, ['NIFTY BANK']) || FALLBACK.bank,
    sensex: findNamed(csv, ['SENSEX']) || FALLBACK.sensex,
    crude: findCrudeMini(csv, day),
  };
  const underKeys = SNIPER_BOOKS.map((cfg) => underKey(cfg, named[cfg.id])).filter(Boolean);
  const openKeys = raw.books
    .filter((b) => b.side !== 'flat' && b.optionSymbol)
    .map((b) => optionKey(SNIPER_BOOKS.find((c) => c.id === b.id)?.exchange || 'NFO', b.optionSymbol));
  let quotes = await io.fetchQuotes([...new Set([...underKeys, ...openKeys])]);

  const barsBy = new Map<SniperUnder, SniperBar[]>();
  await Promise.all(
    SNIPER_BOOKS.map(async (cfg) => {
      const inst = named[cfg.id];
      const bars = inst?.token ? await load5m(io.fetchHistorical, String(inst.token), day) : [];
      barsBy.set(cfg.id, bars);
    }),
  );

  const extra: string[] = [];
  const picks = new Map<SniperUnder, SniperPick | null>();
  for (const cfg of SNIPER_BOOKS) {
    const inst = named[cfg.id];
    const key = underKey(cfg, inst);
    const spot = lastOf(quotes, key);
    const book = raw.books.find((b) => b.id === cfg.id);
    const bars = completedSniperBars(barsBy.get(cfg.id) || [], day, nowMin);
    const signal = barAt(bars, day, sniperPrevCandleMin(cfg, nowMin));
    const fadeType =
      book?.side === 'long' && (book.optionType === 'CE' || book.optionType === 'PE')
        ? book.optionType
        : signal
          ? sniperFadeType(candleDir(signal))
          : null;
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

  const books = SNIPER_BOOKS.map((cfg) => {
    const prev = raw.books.find((b) => b.id === cfg.id) || emptySniperSession(day).books.find((b) => b.id === cfg.id)!;
    const inst = named[cfg.id];
    const ukey = underKey(cfg, inst);
    const spot = lastOf(quotes, ukey);
    const pick = picks.get(cfg.id) || null;
    const okey = prev.optionSymbol
      ? optionKey(cfg.exchange, prev.optionSymbol)
      : pick?.listed
        ? optionKey(cfg.exchange, pick.optionSymbol)
        : '';
    const q = okey ? findQuote(quotes, okey) : null;
    const { bid, ask } = sniperBestBidAsk(q);
    const last = optionPremiumPx(q?.last_price, spot) ?? optionPremiumPx(prev.last, spot);
    const opt: SniperQuote = {
      bid: optionPremiumPx(bid, spot),
      ask: optionPremiumPx(ask, spot),
      last,
    };
    return tickSniperBook(prev, cfg, barsBy.get(cfg.id) || [], day, nowMin, now.toISOString(), spot, opt, pick);
  });

  return summarizeSniper(raw, {
    day,
    running: true,
    asOf: now.toISOString(),
    source: 'kite',
    kiteError: null,
    books,
    startedAt: raw.startedAt || now.toISOString(),
  });
}
