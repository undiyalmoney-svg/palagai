/**
 * Shadow hunt: named methods × 4 names as paper tickets.
 * Never places a Kite order. Ranks EOD by closed ₹, max price, max loss.
 */
import { LiveAssumeBar, LiveAssumeBookCfg } from './live-assume.engine';
import { CheapOtmPick } from '../utils/pick-cheap-otm.util';
import { liveBuyPrice, lotCostRs, optionPremiumPx } from './live-fill.util';
import {
  LIVE_PAPER_BOOKS,
  LivePaperBookState,
  PaperHuntMethodStat,
  PaperHuntState,
  bindOptionFill,
  emptyBook,
  optionPickLabel,
  tickBook,
  underOf,
} from './live-paper.engine';
import { PaperEvolveFlags } from './paper-evolve.util';
import { PAPER_HUNT_METHODS, PAPER_HUNT_MAX_TRADES, PaperHuntMethodDef } from './paper-hunt.methods';

export { PAPER_HUNT_METHODS, PAPER_HUNT_MAX_TRADES, PAPER_HUNT_CAP, PAPER_HUNT_HONEST } from './paper-hunt.methods';

const UNDERS = ['nifty', 'bank', 'sensex', 'crude'] as const;

export type HuntSideQuote = { bid: number | null; ask: number | null; last: number | null };

export function huntMethodCfg(under: string, def: PaperHuntMethodDef): LiveAssumeBookCfg {
  const base = LIVE_PAPER_BOOKS.find((b) => underOf(b.id) === under) || LIVE_PAPER_BOOKS[0];
  const open5 = def.id.startsWith('open5-zone');
  return {
    ...base,
    ...def.patch,
    id: `${under}-${def.id}`,
    under,
    desk: 'hunt',
    label: `${base.label} · ${def.label}`,
    buyOption: true,
    atm: true,
    barMinutes: 1,
    maxTradesPerDay: def.patch.maxTradesPerDay ?? PAPER_HUNT_MAX_TRADES,
    dayStops: def.patch.dayStops ?? false,
    minGapMin: def.patch.minGapMin ?? 1,
    backup: def.patch.backup ?? {},
    ...(open5 ? { entryS: (base.orS ?? 9 * 60 + 15) + 5 } : {}),
  };
}

export function huntBookId(under: string, methodId: string): string {
  return `${under}-${methodId}`;
}

export function emptyHunt(day: string): PaperHuntState {
  const books = UNDERS.flatMap((under) =>
    PAPER_HUNT_METHODS.map((def) => emptyBook(huntMethodCfg(under, def))),
  );
  return { day, trades: 0, stats: books.map((b) => statOf(b)), books, feed: '' };
}

const HUNT_MAX_ABS_RS = 50_000;

function scrubHuntBook(book: LivePaperBookState): LivePaperBookState {
  const fills = (book.fills || []).filter((f) => {
    if (optionPremiumPx(f.entry) == null || optionPremiumPx(f.exit) == null) return false;
    return Math.abs(Number(f.rs) || 0) <= HUNT_MAX_ABS_RS;
  });
  const closedRs = Math.round(fills.reduce((s, f) => s + (f.rs || 0), 0) * 10) / 10;
  const entryOk = optionPremiumPx(book.entry) != null;
  if (book.side !== 'flat' && !entryOk) {
    return {
      ...book,
      fills,
      closedRs,
      side: 'flat',
      entry: null,
      sl: null,
      tp: null,
      scratch: null,
      last: optionPremiumPx(book.last),
      livePts: 0,
      liveRs: 0,
      status: 'watching',
      reason: 'dropped index-priced ticket',
      optionSymbol: '',
      optionType: '',
      strike: null,
      peakPx: null,
      troughPx: null,
    };
  }
  return { ...book, fills, closedRs, last: optionPremiumPx(book.last) ?? book.last };
}

export function huntCfgOf(id: string): LiveAssumeBookCfg {
  const under = underOf(id);
  const method = id.slice(under.length + 1);
  const def = PAPER_HUNT_METHODS.find((m) => m.id === method) || PAPER_HUNT_METHODS[0];
  return huntMethodCfg(under, def);
}

function rupee(n: number): number {
  return Math.round(n * 10) / 10;
}

function statOf(book: LivePaperBookState): PaperHuntMethodStat {
  const under = book.under || underOf(book.id);
  const method = book.id.slice(under.length + 1);
  const def = PAPER_HUNT_METHODS.find((m) => m.id === method);
  const fills = book.fills;
  const closedRs = Math.round((book.closedRs || 0) * 10) / 10;
  const wins = fills.filter((f) => f.rs > 0).length;
  const losses = fills.filter((f) => f.rs < 0).length;
  const maxPx = fills.reduce<number | null>((m, f) => {
    const px = f.maxPx ?? f.exit;
    return m == null ? px : Math.max(m, px);
  }, book.peakPx ?? null);
  const minPx = fills.reduce<number | null>((m, f) => {
    const px = f.minPx ?? f.exit;
    return m == null ? px : Math.min(m, px);
  }, book.troughPx ?? null);
  const mfeRs = fills.reduce((m, f) => Math.max(m, f.mfeRs ?? f.rs), 0);
  const maeRs = fills.reduce((m, f) => Math.min(m, f.maeRs ?? f.rs), 0);
  return {
    id: book.id,
    method,
    label: def?.label || method,
    family: def?.family || 'momentum',
    under,
    trades: fills.length,
    wins,
    losses,
    closedRs,
    maxPx,
    minPx,
    mfeRs: Math.round(mfeRs * 10) / 10,
    maeRs: Math.round(maeRs * 10) / 10,
    avgRs: fills.length ? Math.round((closedRs / fills.length) * 10) / 10 : 0,
  };
}

export function rankHunt(stats: PaperHuntMethodStat[]): PaperHuntMethodStat[] {
  return [...stats].sort((a, b) => b.closedRs - a.closedRs || b.wins - a.wins || a.maeRs - b.maeRs);
}

export function profitableHunt(stats: PaperHuntMethodStat[]): PaperHuntMethodStat[] {
  return rankHunt(stats).filter((s) => s.closedRs > 0 && s.trades > 0);
}

export function bestHuntByUnder(stats: PaperHuntMethodStat[]): PaperHuntMethodStat[] {
  return UNDERS.map((under) => rankHunt(stats.filter((s) => s.under === under))[0]).filter(
    (s): s is PaperHuntMethodStat => !!s,
  );
}

export interface HuntTicketRow {
  key: string;
  method: string;
  methodLabel: string;
  under: string;
  entry: string;
  exit: string;
  entryAt: string;
  exitAt: string;
  sl: number;
  entryPx: number;
  exitPx: number;
  rs: number;
  /** After-entry peak closed ₹ (MFE). That ticket only — not a guaranteed next move. */
  mfeRs: number;
  /** After-entry trough closed ₹ (MAE). That ticket only — not a guaranteed next move. */
  maeRs: number;
}

/** Closed hunt tickets for one name, high profit to high loss. */
export function huntTickets(state: PaperHuntState | null | undefined, under: string): HuntTicketRow[] {
  if (!state) return [];
  const rows: HuntTicketRow[] = [];
  for (const book of state.books) {
    if ((book.under || underOf(book.id)) !== under) continue;
    const method = book.id.slice(under.length + 1);
    const def = PAPER_HUNT_METHODS.find((m) => m.id === method);
    for (let i = 0; i < book.fills.length; i++) {
      const f = book.fills[i];
      rows.push({
        key: `${book.id}-${i}-${f.entryAt || ''}-${f.exitAt || ''}`,
        method,
        methodLabel: def?.label || method,
        under,
        entry:
          optionPickLabel({
            id: f.book || book.id,
            optionType: f.optionType,
            strike: f.strike,
            expiry: f.expiry,
            optionSymbol: f.optionSymbol,
          }) ||
          f.optionType ||
          (f.side === 'long' ? 'CE' : 'PE'),
        exit: f.reason,
        entryAt: f.entryAt || '',
        exitAt: f.exitAt || '',
        sl: f.sl,
        entryPx: f.entry,
        exitPx: f.exit,
        rs: f.rs,
        mfeRs: Math.round((f.mfeRs ?? f.rs) * 10) / 10,
        maeRs: Math.round((f.maeRs ?? f.rs) * 10) / 10,
      });
    }
  }
  return rows.sort((a, b) => b.rs - a.rs || a.entryAt.localeCompare(b.entryAt));
}

export function huntTabNet(state: PaperHuntState | null | undefined, under: string): number {
  if (!state) return 0;
  return rupee(huntMethodRows(state, under).reduce((n, s) => n + s.closedRs, 0));
}

export interface HuntMethodRow {
  key: string;
  method: string;
  methodLabel: string;
  family: string;
  under: string;
  underLabel: string;
  trades: number;
  wins: number;
  losses: number;
  winPct: number;
  slHits: number;
  open: boolean;
  closedRs: number;
  profitRs: number;
  lossRs: number;
  mfeRs: number;
  maeRs: number;
  /** Smallest max-profit reached on a closed ticket. That sample only — not a guaranteed next move. */
  floorMfeRs: number;
  capitalRs: number;
  lastEntryAt: string;
  note: string;
}

export type HuntMethodView = 'all' | 'traded' | 'green';

export interface HuntInstrumentSummary {
  under: (typeof UNDERS)[number];
  label: string;
  trades: number;
  wins: number;
  losses: number;
  profitRs: number;
  lossRs: number;
  closedRs: number;
  bestLabel: string;
  bestRs: number;
  worstLabel: string;
  worstRs: number;
  slLabel: string;
    slHits: number;
    maxCapitalRs: number;
    open: number;
  }

const UNDER_LABEL: Record<(typeof UNDERS)[number], string> = {
  nifty: 'Nifty 50',
  bank: 'Bank Nifty',
  sensex: 'Sensex',
  crude: 'Crude Mini',
};

function emptyMethodRow(under: string, def: PaperHuntMethodDef): HuntMethodRow {
  const u = (UNDERS as readonly string[]).includes(under) ? (under as (typeof UNDERS)[number]) : 'nifty';
  return {
    key: `${under}-${def.id}`,
    method: def.id,
    methodLabel: def.label,
    family: def.family,
    under,
    underLabel: UNDER_LABEL[u],
    trades: 0,
    wins: 0,
    losses: 0,
    winPct: 0,
    slHits: 0,
    open: false,
    closedRs: 0,
    profitRs: 0,
    lossRs: 0,
    mfeRs: 0,
    maeRs: 0,
    floorMfeRs: 0,
    capitalRs: 0,
    lastEntryAt: '',
    note: '',
  };
}

export function huntMethodRow(book: LivePaperBookState): HuntMethodRow {
  const under = book.under || underOf(book.id);
  const method = book.id.slice(under.length + 1);
  const def = PAPER_HUNT_METHODS.find((m) => m.id === method);
  const fills = book.fills;
  const wins = fills.filter((f) => f.rs > 0);
  const losses = fills.filter((f) => f.rs < 0);
  const peaks = fills.map((f) => f.mfeRs ?? f.rs);
  let capitalRs = 0;
  for (const f of fills) capitalRs = Math.max(capitalRs, lotCostRs(f.entry || 0, f.lot || 0));
  if (book.side !== 'flat' && book.entry != null && book.lot) {
    capitalRs = Math.max(capitalRs, lotCostRs(book.entry, book.lot));
  }
  const lastFillAt = fills.reduce((latest, f) => {
    const at = f.entryAt || '';
    return !latest || at > latest ? at : latest;
  }, '');
  const u = (UNDERS as readonly string[]).includes(under) ? (under as (typeof UNDERS)[number]) : 'nifty';
  return {
    key: book.id,
    method,
    methodLabel: def?.label || method,
    family: def?.family || 'momentum',
    under,
    underLabel: UNDER_LABEL[u],
    trades: fills.length,
    wins: wins.length,
    losses: losses.length,
    winPct: fills.length ? rupee((100 * wins.length) / fills.length) : 0,
    slHits: fills.filter((f) => f.reason === 'sl').length,
    open: book.side !== 'flat',
    closedRs: rupee(fills.reduce((s, f) => s + (f.rs || 0), 0) || book.closedRs || 0),
    profitRs: rupee(wins.reduce((s, f) => s + f.rs, 0)),
    lossRs: rupee(losses.reduce((s, f) => s + f.rs, 0)),
    mfeRs: rupee(fills.reduce((m, f) => Math.max(m, f.mfeRs ?? f.rs), 0)),
    maeRs: rupee(fills.reduce((m, f) => Math.min(m, f.maeRs ?? f.rs), 0)),
    floorMfeRs: peaks.length ? rupee(Math.min(...peaks)) : 0,
    capitalRs,
    lastEntryAt: lastFillAt || book.entryAt || '',
    note: book.reason || '',
  };
}

/** All methods for one name, high closed ₹ first. Zero-trade methods stay listed. */
export function huntMethodRows(state: PaperHuntState | null | undefined, under: string): HuntMethodRow[] {
  const byMethod = new Map<string, HuntMethodRow>();
  for (const def of PAPER_HUNT_METHODS) byMethod.set(def.id, emptyMethodRow(under, def));
  if (state) {
    for (const book of state.books) {
      if ((book.under || underOf(book.id)) !== under) continue;
      const row = huntMethodRow(book);
      byMethod.set(row.method, row);
    }
  }
  return [...byMethod.values()].sort(
    (a, b) => b.closedRs - a.closedRs || b.wins - a.wins || a.maeRs - b.maeRs || a.methodLabel.localeCompare(b.methodLabel),
  );
}

export function filterHuntMethodRows(rows: HuntMethodRow[], view: HuntMethodView): HuntMethodRow[] {
  if (view === 'green') return rows.filter((r) => r.closedRs > 0);
  if (view === 'traded') {
    const traded = rows.filter((r) => r.trades > 0 || r.open);
    return traded.length ? traded : rows;
  }
  return rows;
}

/** Top closed-₹ methods across all four names. Empty until a ticket prints. */
export function huntLeaders(state: PaperHuntState | null | undefined, limit = 8): HuntMethodRow[] {
  const rows = UNDERS.flatMap((under) => huntMethodRows(state, under)).filter((r) => r.trades > 0 || r.open);
  return rows
    .sort((a, b) => b.closedRs - a.closedRs || b.floorMfeRs - a.floorMfeRs || b.wins - a.wins)
    .slice(0, limit);
}

export function huntInstrumentSummary(
  state: PaperHuntState | null | undefined,
  under: (typeof UNDERS)[number],
): HuntInstrumentSummary {
  const rows = huntMethodRows(state, under);
  const traded = rows.filter((r) => r.trades > 0 || r.open);
  const best = [...traded].sort((a, b) => b.closedRs - a.closedRs)[0];
  const worst = [...traded].sort((a, b) => a.closedRs - b.closedRs)[0];
  const slWorst = [...traded].sort((a, b) => b.slHits - a.slHits || a.closedRs - b.closedRs)[0];
  return {
    under,
    label: UNDER_LABEL[under],
    trades: rows.reduce((n, r) => n + r.trades, 0),
    wins: rows.reduce((n, r) => n + r.wins, 0),
    losses: rows.reduce((n, r) => n + r.losses, 0),
    profitRs: rupee(rows.reduce((n, r) => n + r.profitRs, 0)),
    lossRs: rupee(rows.reduce((n, r) => n + r.lossRs, 0)),
    closedRs: rupee(rows.reduce((n, r) => n + r.closedRs, 0)),
    bestLabel: best?.methodLabel || '—',
    bestRs: best?.closedRs || 0,
    worstLabel: worst?.methodLabel || '—',
    worstRs: worst?.closedRs || 0,
    slLabel: slWorst && slWorst.slHits ? slWorst.methodLabel : '—',
    slHits: slWorst?.slHits || 0,
    maxCapitalRs: rows.reduce((n, r) => Math.max(n, r.capitalRs), 0),
    open: rows.filter((r) => r.open).length,
  };
}

export function huntSummaries(state: PaperHuntState | null | undefined): HuntInstrumentSummary[] {
  return UNDERS.map((under) => huntInstrumentSummary(state, under));
}

export function compactHunt(state: PaperHuntState): PaperHuntState {
  return {
    ...state,
    books: state.books.map((b) => ({
      ...b,
      skips: (b.skips || []).slice(-1),
      signal: null,
      kiteNote: '',
      kiteBuyOrderId: '',
      kiteSlOrderId: '',
      neededCe: '',
      neededPe: '',
      fills: b.fills.map((f) => ({ ...f, signal: null })),
    })),
  };
}

export function huntBindOption(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  pair: { ce: CheapOtmPick; pe: CheapOtmPick } | undefined,
  side: HuntSideQuote,
  nowMin: number,
  nowIso: string,
  day = '',
): LivePaperBookState {
  const pick = book.side === 'long' ? pair?.ce : pair?.pe;
  if (!pick || !(pick.instrument.instrumentToken > 0)) {
    return {
      ...book,
      side: 'flat',
      entry: null,
      sl: null,
      tp: null,
      scratch: null,
      status: 'watching',
      livePts: 0,
      liveRs: 0,
      reason: 'skipped: no listed contract',
      skips: [
        ...(book.skips || []),
        {
          at: nowIso,
          day,
          book: cfg.id,
          side: pick?.side || (book.side === 'long' ? 'CE' : 'PE'),
          mode: book.mode,
          structure: book.structure,
          contract: pick ? `${pick.side} ${pick.strike}` : cfg.label,
          premium: null,
          lot: pick?.lotSize || book.lot,
          costRs: null,
          budgetRs: 0,
          reason: 'no-listed-contract' as const,
        },
      ].slice(-20),
    };
  }
  const fill = liveBuyPrice(side.ask, side.last);
  const chainPrem = pick.source === 'chain' ? optionPremiumPx(pick.instrument.lastPrice) : null;
  const prem = fill.price != null && optionPremiumPx(fill.price) != null ? fill.price : chainPrem;
  if (prem == null) {
    return {
      ...book,
      side: 'flat',
      entry: null,
      sl: null,
      tp: null,
      scratch: null,
      status: 'watching',
      livePts: 0,
      liveRs: 0,
      reason: 'skipped: no live quote',
      skips: [
        ...(book.skips || []),
        {
          at: nowIso,
          day,
          book: cfg.id,
          side: pick.side,
          mode: book.mode,
          structure: book.structure,
          contract: pick.instrument.tradingSymbol,
          premium: null,
          lot: pick.lotSize,
          costRs: null,
          budgetRs: 0,
          reason: 'no-live-quote' as const,
        },
      ].slice(-20),
    };
  }
  const bound = bindOptionFill(book, cfg, prem, pick, null, nowMin);
  return { ...bound, entryBid: side.bid, entryAsk: side.ask, entryAt: nowIso };
}

export function tickPaperHunt(args: {
  prev: PaperHuntState | null | undefined;
  day: string;
  nowMin: number;
  nowIso: string;
  barsByUnder: Map<string, LiveAssumeBar[]>;
  quotesByUnder: Map<string, { ce: HuntSideQuote; pe: HuntSideQuote; underLast: number | null }>;
  picksByUnder: Map<string, { ce: CheapOtmPick; pe: CheapOtmPick }>;
  evolve?: PaperEvolveFlags;
}): PaperHuntState {
  const prev = args.prev?.day === args.day && args.prev.books.length === UNDERS.length * PAPER_HUNT_METHODS.length
    ? args.prev
    : emptyHunt(args.day);
  const byId = new Map(prev.books.map((b) => [b.id, scrubHuntBook(b)]));
  const nextBooks: LivePaperBookState[] = [];
  for (const under of UNDERS) {
    const bars = args.barsByUnder.get(under) || [];
    const q = args.quotesByUnder.get(under);
    const pair = args.picksByUnder.get(under);
    for (const def of PAPER_HUNT_METHODS) {
      const cfg = huntMethodCfg(under, def);
      const prevBook = byId.get(cfg.id) || emptyBook(cfg);
      const side = prevBook.optionType === 'PE' || prevBook.side === 'short' ? q?.pe : q?.ce;
      const mark =
        optionPremiumPx(side?.last, q?.underLast) ??
        optionPremiumPx(side?.bid, q?.underLast) ??
        optionPremiumPx(prevBook.last, q?.underLast);
      const bid = optionPremiumPx(side?.bid, q?.underLast);
      const ask = optionPremiumPx(side?.ask, q?.underLast);
      let next = tickBook(prevBook, cfg, bars, mark, args.day, args.nowMin, prevBook.optionSymbol || cfg.label, [], {
        bid,
        ask,
        blockOpen: null,
        evolve: args.evolve,
      });
      if (next.side !== 'flat' && !next.optionSymbol) {
        next = huntBindOption(
          next,
          cfg,
          pair,
          next.side === 'long' ? q?.ce || { bid: null, ask: null, last: null } : q?.pe || { bid: null, ask: null, last: null },
          args.nowMin,
          args.nowIso,
          args.day,
        );
      }
      if (next.side !== 'flat' && optionPremiumPx(next.entry) == null) {
        next = {
          ...next,
          side: 'flat',
          entry: null,
          sl: null,
          tp: null,
          scratch: null,
          last: optionPremiumPx(next.last),
          livePts: 0,
          liveRs: 0,
          status: 'watching',
          reason: 'dropped index-priced ticket',
          optionSymbol: '',
          optionType: '',
          strike: null,
          peakPx: null,
          troughPx: null,
        };
      }
      nextBooks.push(next);
    }
  }
  const stats = nextBooks.map(statOf);
  const skipNote = nextBooks.find((b) => /skipped:/.test(b.reason))?.reason || '';
  return compactHunt({
    day: args.day,
    trades: stats.reduce((s, r) => s + r.trades, 0),
    stats,
    books: nextBooks,
    feed: skipNote,
  });
}
