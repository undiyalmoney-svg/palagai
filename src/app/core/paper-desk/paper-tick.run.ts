/**
 * One paper tick: bars, cheap ATM CE/PE, bind, mark. No Angular, no Kite order.
 * Live Kite overlay is applied by the caller (tab or droplet) after this returns.
 */
import { Instrument } from '../models/instrument.model';
import { parseKiteInstrumentsCsv } from '../utils/csv.util';
import { CheapOtmPick, pickCheapOtm } from '../utils/pick-cheap-otm.util';
import { LiveAssumeBar, LiveAssumeBookCfg } from './live-assume.engine';
import { liveBuyPrice, lotCostRs, neededLotQuote, replayBudgetSkips } from './live-fill.util';
import {
  LIVE_PAPER_BOOKS,
  LivePaperBookState,
  LivePaperSession,
  bindOptionFill,
  completedBars,
  emptySession,
  indexDeskBlockReason,
  istDay,
  istMinutes,
  optionBoundStops,
  nightLog,
  optionRangePts,
  paperTickOrder,
  summarizePaper,
  tickBook,
  underOf,
} from './live-paper.engine';
import { optionRoundTripCharges, venueForBook } from './option-charges.util';
import { MIX_SPREAD_PCT } from './paper-mix.util';
import {
  PaperEvolveState,
  emptyEvolve,
  evolvePaperDesk,
  paperEvolveFlags,
} from './paper-evolve.util';
import { PaperLiveBooks, paperLiveArmed } from './paper-live-order.util';
import { SkippedSignal } from './paper-analytics.models';
import { buildSignalCard } from './signal-card.util';

const UNDERS = ['crude', 'nifty', 'bank', 'sensex'] as const;
const NO_BUDGET_CAP = 10_000_000;

export type PaperTickQuote = {
  last_price?: number;
  timestamp?: string;
  last_trade_time?: string;
  depth?: {
    buy?: { price?: number; quantity?: number }[];
    sell?: { price?: number; quantity?: number }[];
  };
};

export type PaperTickIo = {
  now?: Date;
  live: boolean;
  liveBooks: PaperLiveBooks;
  session: LivePaperSession;
  fetchMargins: () => Promise<unknown | null>;
  fetchCsv: () => Promise<string>;
  fetchQuotes: (keys: string[]) => Promise<Record<string, PaperTickQuote>>;
  fetchHistorical: (token: string, interval: string, from: string, to: string) => Promise<unknown[][]>;
  evolve?: PaperEvolveState;
};

export async function runPaperTick(io: PaperTickIo): Promise<LivePaperSession> {
  const now = io.now || new Date();
  const day = istDay(now);
  const nowMin = istMinutes(now);
  const raw = io.session.day === day ? io.session : emptySession(day, now.toISOString());
  const cur = { ...raw, books: raw.books.map(replayBudgetSkips) };
  const evolved = evolvePaperDesk(nightLog(cur), io.evolve || cur.evolve || emptyEvolve());
  const flags = paperEvolveFlags(evolved.state);
  const [margins, csv] = await Promise.all([io.fetchMargins(), io.fetchCsv()]);
  const funds = margins ? parseFunds(margins) : cur.kiteFunds;
  const dump = String(csv || '');
  const chain = parseKiteInstrumentsCsv(dump);
  const crude = findCrudeMini(dump, day);
  const nifty = findNamed(dump, ['NIFTY 50']) || { tradingSymbol: 'NIFTY 50', token: 256265, exchange: 'NSE' };
  const bank = findNamed(dump, ['NIFTY BANK']) || { tradingSymbol: 'NIFTY BANK', token: 260105, exchange: 'NSE' };
  const sensex = findNamed(dump, ['SENSEX']) || { tradingSymbol: 'SENSEX', token: 265, exchange: 'BSE' };
  const underKeys = [
    crude ? `MCX:${crude.tradingSymbol}` : '',
    'NSE:NIFTY 50',
    'NSE:NIFTY BANK',
    'BSE:SENSEX',
  ].filter(Boolean);
  const openOptKeys = cur.books.filter((b) => b.side !== 'flat' && b.optionSymbol).map((b) => optionKey(b));
  const keys = [...new Set([...underKeys, ...openOptKeys])];
  let quotes = keys.length ? (await io.fetchQuotes(keys)) || {} : {};
  const cheapByUnder = new Map<string, { ce: CheapOtmPick; pe: CheapOtmPick }>();
  const cheapKeys: string[] = [];
  const asOfCfg = LIVE_PAPER_BOOKS[0];
  for (const under of UNDERS) {
    const inst = instOf(under, crude, nifty, bank, sensex);
    const spot = lastPrice(quotes, under, inst?.tradingSymbol || '') ?? 0;
    const pair = cheapPair(chain, under, spot, pickAsOf(asOfCfg, now), asOfCfg.atm ? 0 : undefined);
    cheapByUnder.set(under, pair);
    for (const pick of [pair.ce, pair.pe]) {
      if (pick.instrument.instrumentToken > 0) {
        cheapKeys.push(`${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`);
      }
    }
  }
  const extraKeys = [...new Set(cheapKeys.filter((k) => !keys.includes(k)))];
  if (extraKeys.length) {
    quotes = { ...quotes, ...((await io.fetchQuotes(extraKeys)) || {}) };
  }
  const from = shiftDay(day, -8);
  const barCache = new Map<string, LiveAssumeBar[]>();
  for (const under of UNDERS) {
    const inst = instOf(under, crude, nifty, bank, sensex);
    let bars: LiveAssumeBar[] = [];
    if (inst?.token) {
      const candles = await io.fetchHistorical(String(inst.token), 'minute', from, day);
      bars = (candles || []).map(kiteBar).filter((b) => b.day);
    }
    barCache.set(under, bars);
  }
  const nextById = new Map<string, LivePaperBookState>();
  for (const cfg of paperTickOrder(LIVE_PAPER_BOOKS)) {
    const under = underOf(cfg.id);
    const inst = instOf(under, crude, nifty, bank, sensex);
    const prev = cur.books.find((b) => b.id === cfg.id) || emptySession(day).books.find((b) => b.id === cfg.id)!;
    const bars = barCache.get(under) || [];
    const underLast = lastPrice(quotes, under, inst?.tradingSymbol || '');
    const optQuote = prev.optionSymbol ? findQuote(quotes, optionKey(prev)) : null;
    const optLast = optQuote ? lastByKey(quotes, optionKey(prev)) : null;
    const { bid: optBid, ask: optAsk } = bestBidAsk(optQuote);
    const lastForTick = optionMarkLast({
      buyOption: !!cfg.buyOption,
      side: prev.side,
      optionSymbol: prev.optionSymbol,
      optLast,
      prevLast: prev.last,
      underLast,
    });
    let optionBars: LiveAssumeBar[] = [];
    if (prev.side !== 'flat' && prev.optionToken) {
      const candles = await io
        .fetchHistorical(String(prev.optionToken), cfg.barMinutes === 1 ? 'minute' : '5minute', day, day)
        .catch(() => [] as unknown[][]);
      optionBars = (candles || []).map(kiteBar).filter((b) => b.day);
    }
    const peers = LIVE_PAPER_BOOKS.map(
      (c) =>
        nextById.get(c.id) ||
        cur.books.find((b) => b.id === c.id) ||
        emptySession(day).books.find((b) => b.id === c.id)!,
    );
    let next = tickBook(
      prev,
      cfg,
      bars,
      lastForTick,
      day,
      nowMin,
      prev.optionSymbol || inst?.tradingSymbol || cfg.label,
      optionBars,
      { bid: optBid, ask: optAsk, blockOpen: indexDeskBlockReason(cfg.id, peers, day), evolve: flags },
    );
    if (cfg.buyOption && needsOption(next)) {
      const spot = underLast ?? (next.optionSymbol ? next.last : null) ?? 0;
      const pair = cheapByUnder.get(under);
      next = await bindCheap(next, cfg, chain, spot, quotes, nowMin, io, pair, now);
    }
    if (cfg.buyOption && next.side !== 'flat' && !next.optionSymbol) {
      next = {
        ...next,
        side: 'flat',
        entry: null,
        sl: null,
        tp: null,
        scratch: null,
        livePts: 0,
        liveRs: 0,
        status: 'watching',
        reason: 'skipped: no option fill',
      };
    } else if (next.side !== 'flat' && next.optionSymbol && optLast != null) {
      const mark = optBid != null && optLast < optBid ? optBid : optLast;
      next = { ...next, last: mark };
    }
    if (next.fills.length > prev.fills.length && prev.optionSymbol) {
      const q = findQuote(quotes, optionKey(prev));
      const { bid, ask } = bestBidAsk(q);
      const stamp = now.toISOString();
      const fills = next.fills.map((f, idx) =>
        idx >= prev.fills.length ? { ...f, exitBid: bid, exitAsk: ask, exitAt: stamp } : f,
      );
      next = { ...next, fills };
    }
    const underQuote = findQuote(quotes, underKeyFor(under, inst?.tradingSymbol, inst?.exchange));
    nextById.set(cfg.id, {
      ...next,
      ...neededFields(cheapByUnder.get(under), quotes),
      quoteAt: quoteStamp(underQuote) || next.quoteAt || '',
    });
  }
  const books = LIVE_PAPER_BOOKS.map((c) => nextById.get(c.id) || cur.books.find((b) => b.id === c.id)!);
  const snap = summarizePaper(books, {
    running: true,
    day,
    startedAt: cur.startedAt || now.toISOString(),
    asOf: now.toISOString(),
    source: 'kite',
    kiteFunds: funds,
    kiteError: null,
    liveOrders: paperLiveArmed(io.live, io.liveBooks),
    evolve: evolved.state,
  });
  const after = evolvePaperDesk(nightLog(snap), evolved.state);
  return { ...snap, evolve: after.state };
}

async function bindCheap(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  chain: Instrument[],
  spot: number,
  quotes: Record<string, PaperTickQuote>,
  nowMin: number,
  io: PaperTickIo,
  pair: { ce: CheapOtmPick; pe: CheapOtmPick } | undefined,
  now: Date,
): Promise<LivePaperBookState> {
  const id = underOf(cfg.id);
  const pick =
    (book.side === 'long' ? pair?.ce : pair?.pe) ||
    pickCheapOtm({
      instruments: chain,
      book: id,
      direction: book.side === 'long' ? 'BUY' : 'SELL',
      spot,
      asOf: pickAsOf(cfg, now),
      premiumBudgetRs: NO_BUDGET_CAP,
      otmPts: cfg.atm ? 0 : undefined,
    });
  const listed = pick.instrument.instrumentToken > 0;
  const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
  const q = listed ? findQuote(quotes, key) : null;
  const { bid, ask } = bestBidAsk(q);
  const liveLast = listed ? lastByKey(quotes, key) : null;
  const fill = liveBuyPrice(ask, liveLast);
  const flat = (reason: string, skip: SkippedSignal): LivePaperBookState => ({
    ...book,
    side: 'flat',
    entry: null,
    sl: null,
    tp: null,
    scratch: null,
    status: 'watching',
    reason,
    livePts: 0,
    liveRs: 0,
    skips: [...(book.skips || []), skip].slice(-100),
  });
  if (bid != null && ask != null && ask > 0) {
    const mid = (bid + ask) / 2;
    if (mid > 0 && (ask - bid) / mid > MIX_SPREAD_PCT) {
      return flat('skipped: spread over 3%', {
        at: now.toISOString(),
        day: istDay(now),
        book: cfg.id,
        side: pick.side,
        mode: book.mode,
        structure: book.structure,
        contract: pick.instrument.tradingSymbol,
        premium: fill.price,
        lot: pick.lotSize,
        costRs: null,
        budgetRs: 0,
        reason: 'spread-over-3pct',
      });
    }
  }
  if (!listed || fill.price == null) {
    const skip: SkippedSignal = {
      at: now.toISOString(),
      day: istDay(now),
      book: cfg.id,
      side: pick.side,
      mode: book.mode,
      structure: book.structure,
      contract: listed ? `${pick.instrument.tradingSymbol}` : `${pick.side} ${pick.strike} (not listed)`,
      premium: null,
      lot: pick.lotSize,
      costRs: null,
      budgetRs: 0,
      reason: listed ? 'no-live-quote' : 'no-listed-contract',
    };
    return flat(listed ? 'skipped: no live quote' : 'skipped: no listed contract', skip);
  }
  const prem = fill.price;
  const cost = lotCostRs(prem, pick.lotSize);
  const range = await optionRange(pick.instrument.instrumentToken, istDay(now), nowMin, io);
  const stop = optionBoundStops(cfg, prem, pick.lotSize, range);
  const stopPts = Math.min(stop.sl, prem - 0.05);
  const riskRs =
    Math.round(
      (stopPts * pick.lotSize + optionRoundTripCharges(prem, prem - stopPts, pick.lotSize, venueForBook(cfg.under || cfg.id))) *
        10,
    ) / 10;
  if (cfg.dayStops !== false && book.closedRs < 0 && -book.closedRs > riskRs) {
    return flat(`day stop: today −₹${Math.abs(book.closedRs)} > one stop ₹${riskRs}`, {
      at: now.toISOString(),
      day: istDay(now),
      book: cfg.id,
      side: pick.side,
      mode: book.mode,
      structure: book.structure,
      contract: pick.instrument.tradingSymbol,
      premium: prem,
      lot: pick.lotSize,
      costRs: riskRs,
      budgetRs: 0,
      reason: 'day-stop',
    });
  }
  pick.lastPrice = prem;
  pick.openCostRs = cost;
  pick.fitsBudget = true;
  const bound = bindOptionFill(book, cfg, prem, pick, range, nowMin);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const spreadPct = mid != null && mid > 0 ? (ask! - bid!) / mid : null;
  const signal =
    bound.entry != null && bound.sl != null && bound.tp != null
      ? buildSignalCard({
          book: cfg.id,
          venue: venueForBook(cfg.under || cfg.id),
          mode: bound.mode,
          structure: bound.structure,
          primaryRule: cfg.primary[bound.structure === 'wait' ? 'stand' : bound.structure] === bound.mode,
          entry: bound.entry,
          sl: bound.sl,
          tp: bound.tp,
          qty: pick.lotSize,
          premiumCostRs: cost,
          liveAsk: fill.atAsk,
          spreadPct,
          entryMinute: nowMin,
          entryStartMin: cfg.entryS,
          flatMin: cfg.flat,
          dayClosedRs: book.closedRs,
          dayLossCapRs: (cfg.dayStops === false ? cfg.maxTradesPerDay || 3 : 2) * riskRs,
        })
      : null;
  return { ...bound, entryBid: bid, entryAsk: ask, entryAt: now.toISOString(), signal };
}

async function optionRange(token: number, day: string, nowMin: number, io: PaperTickIo): Promise<number | null> {
  if (!(token > 0)) return null;
  const candles = await io.fetchHistorical(String(token), '5minute', shiftDay(day, -3), day).catch(() => [] as unknown[][]);
  const bars = (candles || []).map(kiteBar).filter((b) => b.day);
  return optionRangePts(completedBars(bars, day, nowMin));
}

export function nextExpiryAsOf(asOf: Date): Date {
  return new Date(asOf.getTime() + 24 * 60 * 60 * 1000);
}

function pickAsOf(cfg: LiveAssumeBookCfg, asOf: Date): Date {
  return cfg.expiryAfterTomorrow === false ? asOf : nextExpiryAsOf(asOf);
}

function cheapPair(
  chain: Instrument[],
  book: 'crude' | 'nifty' | 'bank' | 'sensex',
  spot: number,
  asOf: Date,
  otmPts?: number,
): { ce: CheapOtmPick; pe: CheapOtmPick } {
  return {
    ce: pickCheapOtm({
      instruments: chain,
      book,
      direction: 'BUY',
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
      otmPts,
    }),
    pe: pickCheapOtm({
      instruments: chain,
      book,
      direction: 'SELL',
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
      otmPts,
    }),
  };
}

function neededFields(
  pair: { ce: CheapOtmPick; pe: CheapOtmPick } | undefined,
  quotes: Record<string, PaperTickQuote>,
): Pick<
  LivePaperBookState,
  'neededCeRs' | 'neededCe' | 'neededPeRs' | 'neededPe' | 'neededLot' | 'neededAtAsk'
> {
  if (!pair) {
    return { neededCeRs: null, neededCe: '', neededPeRs: null, neededPe: '', neededLot: 0, neededAtAsk: false };
  }
  const quoteOf = (pick: CheapOtmPick) => {
    if (pick.instrument.instrumentToken <= 0) return null;
    const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
    const { ask } = bestBidAsk(findQuote(quotes, key));
    return neededLotQuote(pick.instrument.tradingSymbol, pick.lotSize, ask, lastByKey(quotes, key));
  };
  const ce = quoteOf(pair.ce);
  const pe = quoteOf(pair.pe);
  return {
    neededCe: ce?.contract || pair.ce.instrument.tradingSymbol || '',
    neededCeRs: ce?.costRs ?? null,
    neededPe: pe?.contract || pair.pe.instrument.tradingSymbol || '',
    neededPeRs: pe?.costRs ?? null,
    neededLot: ce?.lot || pe?.lot || pair.ce.lotSize || pair.pe.lotSize || 0,
    neededAtAsk: !!(ce?.atAsk || pe?.atAsk),
  };
}

export function parseFunds(payload: unknown): LivePaperSession['kiteFunds'] {
  const already = payload as LivePaperSession['kiteFunds'] & { equityCash?: number };
  if (already && typeof already === 'object' && Number.isFinite(Number(already.equityCash))) {
    return {
      equityCash: Math.round(Number(already.equityCash) || 0),
      equityNet: Math.round(Number(already.equityNet) || 0),
      commodityCash: Math.round(Number(already.commodityCash) || 0),
      commodityNet: Math.round(Number(already.commodityNet) || 0),
    };
  }
  const root = (payload as { data?: { equity?: Seg; commodity?: Seg } })?.data || {};
  const pocket = (seg?: Seg) => {
    const a = seg?.available || {};
    const live = Number(a.live_balance);
    if (Number.isFinite(live) && live > 0) return Math.round(live);
    const cash = Number(a.cash);
    if (Number.isFinite(cash) && cash > 0) return Math.round(cash);
    return Math.round(Number(seg?.net) || 0);
  };
  return {
    equityCash: pocket(root.equity),
    equityNet: Math.round(Number(root.equity?.net) || 0),
    commodityCash: pocket(root.commodity),
    commodityNet: Math.round(Number(root.commodity?.net) || 0),
  };
}

interface Seg {
  net?: number;
  available?: { live_balance?: number; cash?: number };
}

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

function findCrudeMini(csv: string, today: string): { tradingSymbol: string; token: number; exchange: string } | null {
  const rows: { tradingSymbol: string; token: number; exchange: string; expiry: string }[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== 'MCX' || cols[9].trim().toUpperCase() !== 'FUT') continue;
    if (!cols[2].toUpperCase().startsWith('CRUDEOILM')) continue;
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: 'MCX',
      expiry: (cols[5] || '').slice(0, 10),
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return rows.find((r) => !r.expiry || r.expiry > today) || null;
}

function findNamed(csv: string, names: string[]): { tradingSymbol: string; token: number; exchange: string } | null {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}

function kiteBar(row: unknown[]): LiveAssumeBar {
  const raw = String(row[0] || '');
  const d = new Date(raw);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const day = raw.slice(0, 10);
  const hh = Number.isNaN(d.getTime()) ? Number(raw.slice(11, 13)) : ist.getUTCHours();
  const mm = Number.isNaN(d.getTime()) ? Number(raw.slice(14, 16)) : ist.getUTCMinutes();
  return {
    day,
    min: hh * 60 + mm,
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0,
  };
}

export function needsOption(next: LivePaperBookState): boolean {
  return next.side !== 'flat' && !next.optionSymbol;
}

export function optionMarkLast(args: {
  buyOption: boolean;
  side: LivePaperBookState['side'];
  optionSymbol?: string;
  optLast: number | null;
  prevLast: number | null;
  underLast: number | null;
}): number | null {
  if (!args.buyOption) return args.underLast;
  if (args.side !== 'flat' && args.optionSymbol) return args.optLast ?? args.prevLast;
  if (args.side !== 'flat') return args.prevLast;
  return args.underLast;
}

function instOf(
  under: string,
  crude: { tradingSymbol: string; token: number; exchange: string } | null,
  nifty: { tradingSymbol: string; token: number; exchange: string },
  bank: { tradingSymbol: string; token: number; exchange: string },
  sensex: { tradingSymbol: string; token: number; exchange: string },
) {
  return under === 'crude' ? crude : under === 'nifty' ? nifty : under === 'bank' ? bank : sensex;
}

function optionKey(book: Pick<LivePaperBookState, 'optionSymbol' | 'id'>): string {
  const under = underOf(book.id);
  const ex = under === 'crude' ? 'MCX' : under === 'sensex' ? 'BFO' : 'NFO';
  return `${ex}:${book.optionSymbol}`;
}

function underKeyFor(id: string, symbol: string | undefined, exchange: string | undefined): string {
  if (id === 'nifty') return 'NSE:NIFTY 50';
  if (id === 'bank') return 'NSE:NIFTY BANK';
  if (id === 'sensex') return 'BSE:SENSEX';
  return `${exchange || 'MCX'}:${symbol || ''}`;
}

function findQuote(quotes: Record<string, PaperTickQuote>, key: string): PaperTickQuote | null {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}

export function bestBidAsk(q: PaperTickQuote | null): { bid: number | null; ask: number | null } {
  const bid = Number(q?.depth?.buy?.[0]?.price);
  const ask = Number(q?.depth?.sell?.[0]?.price);
  return {
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null,
  };
}

function quoteStamp(q: PaperTickQuote | null): string {
  return String(q?.timestamp || q?.last_trade_time || '');
}

function lastByKey(quotes: Record<string, PaperTickQuote>, key: string): number | null {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want || k.toUpperCase().endsWith(want.split(':')[1] || '')) {
      const n = Number(v.last_price);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function lastPrice(quotes: Record<string, PaperTickQuote>, id: string, symbol: string): number | null {
  for (const [k, v] of Object.entries(quotes)) {
    const key = k.toUpperCase();
    if (id === 'crude' && key.includes('CRUDEOILM') && !key.includes('CE') && !key.includes('PE')) {
      return Number(v.last_price) || null;
    }
    if (id === 'nifty' && key.includes('NIFTY 50')) return Number(v.last_price) || null;
    if (id === 'bank' && key.includes('BANK')) return Number(v.last_price) || null;
    if (id === 'sensex' && key.includes('SENSEX')) return Number(v.last_price) || null;
    if (symbol && key.includes(symbol.toUpperCase())) return Number(v.last_price) || null;
  }
  return null;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + delta);
  return istDay(d);
}
