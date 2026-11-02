/** Live paper: isolated ₹14k books, Kite watch, no Kite order. */

import {
  LIVE_ASSUME_BOOKS,
  LIVE_ASSUME_CAPITAL,
  LIVE_ASSUME_CHARGE,
  LIVE_ASSUME_CRUDE_MIN,
  LIVE_ASSUME_DAY_LOSS,
  LIVE_ASSUME_PREMIUM_BUDGET,
  LiveAssumeBar,
  LiveAssumeBookCfg,
  bookSignal,
  morningStructure,
} from './live-assume.engine';

export const LIVE_PAPER_BOOKS = LIVE_ASSUME_BOOKS;
export const LIVE_PAPER_CAPITAL = LIVE_ASSUME_CAPITAL;
export const LIVE_PAPER_CHARGE = LIVE_ASSUME_CHARGE;

export interface LivePaperFill {
  day: string;
  book: string;
  label: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  pts: number;
  rs: number;
  reason: string;
  mode: string;
}

export interface LivePaperBookState {
  id: string;
  label: string;
  product: string;
  instrument: string;
  last: number | null;
  structure: string;
  mode: string;
  side: 'flat' | 'long' | 'short';
  entry: number | null;
  sl: number | null;
  tp: number | null;
  scratch: number | null;
  livePts: number;
  liveRs: number;
  closedRs: number;
  fund: number;
  status: 'watching' | 'pending' | 'open' | 'closed';
  pendingDir: number;
  pendingSig: number;
  pendingMode: string;
  lastBarMin: number;
  reason: string;
  fills: LivePaperFill[];
}

export interface LivePaperSession {
  assumed: true;
  liveOrders: false;
  guaranteed: false;
  armedOnCrudeBest: false;
  running: boolean;
  day: string;
  startedAt: string | null;
  asOf: string;
  source: string;
  kiteFunds: {
    equityCash: number;
    equityNet: number;
    commodityCash: number;
    commodityNet: number;
  } | null;
  kiteError: string | null;
  books: LivePaperBookState[];
  liveRs: number;
  closedRs: number;
  honest: string;
}

export function emptyBook(cfg: LiveAssumeBookCfg): LivePaperBookState {
  return {
    id: cfg.id,
    label: cfg.label,
    product: cfg.product,
    instrument: cfg.label,
    last: null,
    structure: 'wait',
    mode: 'stand',
    side: 'flat',
    entry: null,
    sl: null,
    tp: null,
    scratch: null,
    livePts: 0,
    liveRs: 0,
    closedRs: 0,
    fund: LIVE_PAPER_CAPITAL,
    status: 'watching',
    pendingDir: 0,
    pendingSig: 0,
    pendingMode: '',
    lastBarMin: -1,
    reason: '',
    fills: [],
  };
}

export function emptySession(day: string, asOf = new Date().toISOString()): LivePaperSession {
  const books = LIVE_PAPER_BOOKS.map((cfg) => emptyBook(cfg));
  return summarizePaper(books, {
    running: false,
    day,
    startedAt: null,
    asOf,
    source: 'idle',
    kiteFunds: null,
    kiteError: null,
  });
}

export function istDay(d = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function istMinutes(d = new Date()): number {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function completedBars(bars: LiveAssumeBar[], day: string, nowMin: number): LiveAssumeBar[] {
  return bars.filter((b) => b.day < day || (b.day === day && b.min + 5 <= nowMin));
}

function markLive(book: LivePaperBookState, last: number | null, cfg: LiveAssumeBookCfg): void {
  book.last = last;
  if (book.side === 'flat' || book.entry == null) {
    book.livePts = 0;
    book.liveRs = 0;
    return;
  }
  const dir = book.side === 'long' ? 1 : -1;
  const px = last ?? book.entry;
  book.livePts = Math.round(dir * (px - book.entry) * 10) / 10;
  book.liveRs = Math.round((book.livePts * cfg.rsPt - LIVE_PAPER_CHARGE) * 10) / 10;
}

function closeAt(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  exitPx: number,
  reason: string,
  day: string,
): void {
  if (book.side === 'flat' || book.entry == null) return;
  const dir = book.side === 'long' ? 1 : -1;
  const pts = dir * (exitPx - book.entry);
  const rs = Math.round((pts * cfg.rsPt - LIVE_PAPER_CHARGE) * 10) / 10;
  book.fills.push({
    day,
    book: book.id,
    label: book.label,
    side: book.side,
    entry: book.entry,
    exit: exitPx,
    sl: book.sl || 0,
    tp: book.tp || 0,
    pts: Math.round(pts * 10) / 10,
    rs,
    reason,
    mode: book.mode,
  });
  book.closedRs = Math.round((book.closedRs + rs) * 10) / 10;
  book.fund = Math.round((LIVE_PAPER_CAPITAL + book.closedRs) * 10) / 10;
  book.side = 'flat';
  book.entry = null;
  book.sl = null;
  book.tp = null;
  book.scratch = null;
  book.livePts = 0;
  book.liveRs = 0;
  book.status = 'closed';
  book.reason = reason;
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = '';
}

function hitExit(
  book: LivePaperBookState,
  high: number,
  low: number,
  close: number,
  cfg: LiveAssumeBookCfg,
  day: string,
): boolean {
  if (book.side === 'flat' || book.entry == null || book.sl == null || book.tp == null || book.scratch == null) {
    return false;
  }
  const long = book.side === 'long';
  if (long && low <= book.scratch) {
    closeAt(book, cfg, book.scratch, 'scratch', day);
    return true;
  }
  if (!long && high >= book.scratch) {
    closeAt(book, cfg, book.scratch, 'scratch', day);
    return true;
  }
  if (long && low <= book.sl) {
    closeAt(book, cfg, book.sl, 'sl', day);
    return true;
  }
  if (!long && high >= book.sl) {
    closeAt(book, cfg, book.sl, 'sl', day);
    return true;
  }
  if (long && high >= book.tp) {
    closeAt(book, cfg, book.tp, 'tp', day);
    return true;
  }
  if (!long && low <= book.tp) {
    closeAt(book, cfg, book.tp, 'tp', day);
    return true;
  }
  return false;
}

function canOpen(book: LivePaperBookState, cfg: LiveAssumeBookCfg): string | null {
  if (cfg.premiumRs > LIVE_ASSUME_PREMIUM_BUDGET) return 'premium over budget';
  if (cfg.id === 'crude' && LIVE_PAPER_CAPITAL < LIVE_ASSUME_CRUDE_MIN) return 'need ₹8,000 free for Crude';
  if (book.closedRs <= -LIVE_ASSUME_DAY_LOSS) return 'day-loss cap';
  if (book.fund <= 0) return 'fund empty';
  return null;
}

function openAt(book: LivePaperBookState, cfg: LiveAssumeBookCfg, dir: number, entry: number, mode: string): void {
  const block = canOpen(book, cfg);
  if (block) {
    book.reason = block;
    book.status = 'watching';
    book.pendingDir = 0;
    return;
  }
  const d = dir === 1 ? 1 : -1;
  book.side = d === 1 ? 'long' : 'short';
  book.entry = entry;
  book.sl = entry - d * cfg.sl;
  book.tp = entry + d * cfg.tp;
  book.scratch = entry - d * cfg.scratch;
  book.mode = mode;
  book.status = 'open';
  book.reason = 'open';
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = '';
}

function pickSignal(bars: LiveAssumeBar[], i: number, cfg: LiveAssumeBookCfg, structure: string): { dir: number; mode: string } {
  const primary = cfg.primary[structure];
  if (primary) {
    const dir = bookSignal(primary, bars, i, cfg);
    if (dir) return { dir, mode: primary };
  }
  for (const alt of cfg.backup[structure] || []) {
    const dir = bookSignal(alt, bars, i, cfg);
    if (dir) return { dir, mode: alt };
  }
  return { dir: 0, mode: primary || 'stand' };
}

export function tickBook(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  bars: LiveAssumeBar[],
  last: number | null,
  day: string,
  nowMin: number,
  instrument: string,
): LivePaperBookState {
  const next: LivePaperBookState = {
    ...book,
    fills: [...book.fills],
    instrument: instrument || book.instrument,
  };
  const done = completedBars(bars, day, nowMin);
  if (nowMin >= cfg.orE) {
    next.structure = morningStructure(done, day, cfg.orS, cfg.orE, cfg.quietW);
  }

  if (next.side === 'long' || next.side === 'short') {
    for (const bar of done) {
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      if (hitExit(next, bar.high, bar.low, bar.close, cfg, day)) {
        next.lastBarMin = bar.min;
        break;
      }
      next.lastBarMin = bar.min;
    }
    if ((next.side === 'long' || next.side === 'short') && nowMin >= cfg.flat && last != null) {
      closeAt(next, cfg, last, 'eod', day);
    }
    if ((next.side === 'long' || next.side === 'short') && last != null) {
      hitExit(next, last, last, last, cfg, day);
    }
  }

  if (next.side === 'flat') {
    for (let i = 0; i < done.length; i++) {
      const bar = done[i];
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      next.lastBarMin = bar.min;
      if (next.pendingDir) {
        const ok =
          next.pendingDir === 1
            ? bar.close > bar.open && bar.close > next.pendingSig
            : bar.close < bar.open && bar.close < next.pendingSig;
        if (ok) {
          openAt(next, cfg, next.pendingDir, bar.open, next.pendingMode || next.mode);
        } else {
          next.pendingDir = 0;
          next.pendingSig = 0;
          next.status = 'watching';
          next.reason = 'confirm failed';
        }
        if (next.side !== 'flat') break;
        continue;
      }
      if (bar.min < cfg.entryS || bar.min > cfg.flat - 30) continue;
      const st = next.structure === 'wait' ? 'stand' : next.structure;
      const hit = pickSignal(done, i, cfg, st);
      if (!hit.dir) continue;
      next.pendingDir = hit.dir;
      next.pendingSig = bar.close;
      next.pendingMode = hit.mode;
      next.mode = hit.mode;
      next.status = 'pending';
      next.reason = `confirm ${hit.mode}`;
    }
  }

  markLive(next, last, cfg);
  return next;
}

export function summarizePaper(
  books: LivePaperBookState[],
  extra: Pick<
    LivePaperSession,
    'running' | 'day' | 'startedAt' | 'asOf' | 'source' | 'kiteFunds' | 'kiteError'
  >,
): LivePaperSession {
  const liveRs = Math.round(books.reduce((s, b) => s + (b.side === 'flat' ? 0 : b.liveRs), 0) * 10) / 10;
  const closedRs = Math.round(books.reduce((s, b) => s + b.closedRs, 0) * 10) / 10;
  const fundsLine = extra.kiteFunds
    ? `Kite equity ₹${extra.kiteFunds.equityCash.toLocaleString('en-IN')} · commodity ₹${extra.kiteFunds.commodityCash.toLocaleString('en-IN')}. `
    : '';
  return {
    assumed: true,
    liveOrders: false,
    guaranteed: false,
    armedOnCrudeBest: false,
    running: extra.running,
    day: extra.day,
    startedAt: extra.startedAt,
    asOf: extra.asOf,
    source: extra.source,
    kiteFunds: extra.kiteFunds,
    kiteError: extra.kiteError,
    books,
    liveRs,
    closedRs,
    honest:
      `Paper only — no Kite order is placed. ₹${LIVE_PAPER_CAPITAL.toLocaleString('en-IN')} isolated on each book. ` +
      `SL, target, and live P/L come from Kite 5m candles and last price. ${fundsLine}` +
      'Index books are cheap OTM 0.2-delta proxies — ATM/FUT does not fit ₹14k. Not a guaranteed profit. Crude Best stays the real-money desk.',
  };
}

export function allClosedFills(books: LivePaperBookState[]): LivePaperFill[] {
  return books.flatMap((b) => b.fills);
}

export function booksFundEnd(books: LivePaperBookState[]): number {
  return Math.round(books.reduce((s, b) => s + b.fund, 0) * 10) / 10;
}
