/** Append-only forward-paper ledger helpers. Trades are never edited or removed once recorded. */
import { LivePaperFill, paperFillGrade } from './live-paper.engine';
import { PaperTrade } from './paper-analytics.models';

export const LEDGER_VERSION = 1;

export interface LedgerState {
  version: number;
  trades: PaperTrade[];
  /** Trading days on which the desk was running, including days with no trade. */
  observedDays: string[];
}

export function emptyLedger(): LedgerState {
  return { version: LEDGER_VERSION, trades: [], observedDays: [] };
}

export function tradeId(f: Pick<LivePaperFill, 'day' | 'book' | 'entry' | 'exit' | 'reason' | 'entryAt'>): string {
  return [f.day, f.book, f.entryAt || '', f.entry, f.exit, f.reason].join('|');
}

export function fillToTrade(f: LivePaperFill): PaperTrade {
  return {
    id: tradeId(f),
    day: f.day,
    book: f.book,
    label: f.label,
    optionSymbol: f.optionSymbol || '',
    optionType: f.optionType || '',
    strike: f.strike ?? null,
    expiry: f.expiry || '',
    qty: f.lot || 0,
    structure: f.structure || '',
    mode: f.mode,
    reason: f.reason,
    entry: f.entry,
    exit: f.exit,
    sl: f.sl,
    tp: f.tp,
    paperNetRs: f.rs,
    grade: f.grade || paperFillGrade(f),
    entryBid: f.entryBid ?? null,
    entryAsk: f.entryAsk ?? null,
    exitBid: f.exitBid ?? null,
    exitAsk: f.exitAsk ?? null,
    entryAt: f.entryAt || '',
    exitAt: f.exitAt || '',
    signal: f.signal ?? null,
  };
}

/** Adds fills not yet in the ledger. Existing trades are returned untouched and in order. */
export function mergeFills(state: LedgerState, fills: readonly LivePaperFill[]): LedgerState {
  const seen = new Set(state.trades.map((t) => t.id));
  const fresh: PaperTrade[] = [];
  for (const f of fills) {
    const t = fillToTrade(f);
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    fresh.push(t);
  }
  if (!fresh.length) return state;
  fresh.sort((a, b) => (a.exitAt < b.exitAt ? -1 : a.exitAt > b.exitAt ? 1 : 0));
  return { ...state, trades: [...state.trades, ...fresh] };
}

export function observeDay(state: LedgerState, day: string): LedgerState {
  if (state.observedDays.includes(day)) return state;
  return { ...state, observedDays: [...state.observedDays, day].sort() };
}
