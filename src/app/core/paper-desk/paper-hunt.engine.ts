/**
 * Shadow hunt: 50 methods × 4 names as paper tickets.
 * Never places a Kite order. Ranks EOD by closed ₹, max price, max loss.
 */
import { LiveAssumeBar, LiveAssumeBookCfg } from './live-assume.engine';
import { CheapOtmPick } from '../utils/pick-cheap-otm.util';
import { liveBuyPrice } from './live-fill.util';
import {
  LIVE_PAPER_BOOKS,
  LivePaperBookState,
  PaperHuntMethodStat,
  PaperHuntState,
  bindOptionFill,
  emptyBook,
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
  };
}

export function huntBookId(under: string, methodId: string): string {
  return `${under}-${methodId}`;
}

export function emptyHunt(day: string): PaperHuntState {
  const books = UNDERS.flatMap((under) =>
    PAPER_HUNT_METHODS.map((def) => emptyBook(huntMethodCfg(under, def))),
  );
  return { day, trades: 0, stats: books.map((b) => statOf(b)), books };
}

export function huntCfgOf(id: string): LiveAssumeBookCfg {
  const under = underOf(id);
  const method = id.slice(under.length + 1);
  const def = PAPER_HUNT_METHODS.find((m) => m.id === method) || PAPER_HUNT_METHODS[0];
  return huntMethodCfg(under, def);
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

export function compactHunt(state: PaperHuntState): PaperHuntState {
  return {
    ...state,
    books: state.books.map((b) => ({
      ...b,
      skips: [],
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
    };
  }
  const fill = liveBuyPrice(side.ask, side.last);
  if (fill.price == null) {
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
    };
  }
  const bound = bindOptionFill(book, cfg, fill.price, pick, null, nowMin);
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
  const byId = new Map(prev.books.map((b) => [b.id, b]));
  const nextBooks: LivePaperBookState[] = [];
  for (const under of UNDERS) {
    const bars = args.barsByUnder.get(under) || [];
    const q = args.quotesByUnder.get(under);
    const pair = args.picksByUnder.get(under);
    for (const def of PAPER_HUNT_METHODS) {
      const cfg = huntMethodCfg(under, def);
      const prevBook = byId.get(cfg.id) || emptyBook(cfg);
      const side = prevBook.optionType === 'PE' || prevBook.side === 'short' ? q?.pe : q?.ce;
      const mark = side?.last ?? side?.bid ?? q?.underLast ?? prevBook.last;
      const bid = side?.bid ?? null;
      const ask = side?.ask ?? null;
      let next = tickBook(prevBook, cfg, bars, mark, args.day, args.nowMin, prevBook.optionSymbol || cfg.label, [], {
        bid,
        ask,
        blockOpen: null,
        evolve: args.evolve,
      });
      if (next.side !== 'flat' && !next.optionSymbol) {
        next = huntBindOption(next, cfg, pair, next.side === 'long' ? q?.ce || { bid: null, ask: null, last: null } : q?.pe || { bid: null, ask: null, last: null }, args.nowMin, args.nowIso);
      }
      nextBooks.push(next);
    }
  }
  const stats = nextBooks.map(statOf);
  return compactHunt({
    day: args.day,
    trades: stats.reduce((s, r) => s + r.trades, 0),
    stats,
    books: nextBooks,
  });
}
