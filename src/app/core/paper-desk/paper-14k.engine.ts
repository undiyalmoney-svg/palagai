import { PAPER_14K_BLOTTER } from './paper-14k-blotter.fixture';

export const PAPER_14K_CURSOR_KEY = 'palagai_paper_14k_cursor';

/** Hunted books on the dummy tape. Index stays paper-only. Crude live stays on Crude Best. */
export const PAPER_14K_BOOKS = [
  {
    id: 'crude',
    label: 'Crude Mini FUT',
    product: '1 lot · daily-min-sc10',
    clock: '10:00–23:00 IST',
    sl: 20,
    tp: 25,
    scratch: 10,
    note: 'Trend → PDH/PDL. Real money stays on Crude Best.',
  },
  {
    id: 'nifty',
    label: 'Nifty 50',
    product: 'cheap OTM CE/PE ₹50 × 65',
    clock: '10:15–15:15 IST',
    sl: 25,
    tp: 50,
    scratch: 12,
    note: 'Paper only. Live ATM/FUT blocked at ₹14k.',
  },
  {
    id: 'bank',
    label: 'Bank Nifty',
    product: 'cheap OTM CE/PE ₹100 × 30',
    clock: '09:45–15:15 IST',
    sl: 50,
    tp: 110,
    scratch: 25,
    note: 'Paper only. Live ATM/FUT blocked at ₹14k.',
  },
  {
    id: 'sensex',
    label: 'Sensex',
    product: 'cheap OTM CE/PE ₹150 × 20',
    clock: '09:45–15:15 IST',
    sl: 80,
    tp: 160,
    scratch: 40,
    note: 'Paper only. Live ATM/FUT blocked at ₹14k.',
  },
] as const;

export type PaperFill = (typeof PAPER_14K_BLOTTER.fills)[number];
export type PaperSession = (typeof PAPER_14K_BLOTTER.sessions)[number];

export interface PaperBookScore {
  id: (typeof PAPER_14K_BOOKS)[number]['id'];
  label: string;
  fills: number;
  netRs: number;
  tpHits: number;
  scratches: number;
  slHits: number;
}

export interface Paper14kSnapshot {
  startRs: number;
  fundRs: number;
  peakRs: number;
  netRs: number;
  played: number;
  total: number;
  done: boolean;
  lastDay: string | null;
  lastNetRs: number;
  lastTone: 'green' | 'red' | 'flat' | null;
  lastStructure: string | null;
  slHits: number;
  tpHits: number;
  scratches: number;
  skipped: number;
  greenDays: number;
  redDays: number;
  fills: PaperFill[];
  sessions: PaperSession[];
  lastFills: PaperFill[];
  bookScores: PaperBookScore[];
  liveOrders: false;
  guaranteed: false;
}

export function clampPlayed(n: number): number {
  const max = PAPER_14K_BLOTTER.sessions.length;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.floor(n));
}

export function paperSnapshot(played: number): Paper14kSnapshot {
  const n = clampPlayed(played);
  const sessions = PAPER_14K_BLOTTER.sessions.slice(0, n) as PaperSession[];
  const days = new Set(sessions.map((s) => s.day));
  const fills = PAPER_14K_BLOTTER.fills.filter((f) => days.has(f.day)) as PaperFill[];
  const last = sessions.at(-1) ?? null;
  const fundRs = last ? last.fundEnd : PAPER_14K_BLOTTER.startRs;
  const peakRs = sessions.reduce<number>((p, s) => Math.max(p, s.fundEnd), PAPER_14K_BLOTTER.startRs);
  return {
    startRs: PAPER_14K_BLOTTER.startRs,
    fundRs,
    peakRs,
    netRs: fundRs - PAPER_14K_BLOTTER.startRs,
    played: n,
    total: PAPER_14K_BLOTTER.sessions.length,
    done: n >= PAPER_14K_BLOTTER.sessions.length,
    lastDay: last?.day ?? null,
    lastNetRs: last?.netRs ?? 0,
    lastTone: last?.tone ?? null,
    lastStructure: last && 'structure' in last ? String(last.structure) : null,
    slHits: sessions.reduce<number>((a, s) => a + s.slHits, 0),
    tpHits: sessions.reduce<number>((a, s) => a + s.tpHits, 0),
    scratches: sessions.reduce<number>((a, s) => a + s.scratches, 0),
    skipped: sessions.reduce<number>((a, s) => a + s.skipped, 0),
    greenDays: sessions.filter((s) => s.tone === 'green').length,
    redDays: sessions.filter((s) => (s.tone as string) === 'red').length,
    fills,
    sessions,
    lastFills: fills.slice(-12),
    bookScores: PAPER_14K_BOOKS.map((book) => {
      const mine = fills.filter((f) => f.book === book.id);
      return {
        id: book.id,
        label: book.label,
        fills: mine.length,
        netRs: mine.reduce<number>((a, f) => a + f.rs, 0),
        tpHits: mine.filter((f) => f.reason === 'tp').length,
        scratches: mine.filter((f) => {
          const reason = f.reason as string;
          return reason === 'scratch' || reason === 'smell';
        }).length,
        slHits: mine.filter((f) => (f.reason as string) === 'sl').length,
      };
    }),
    liveOrders: false,
    guaranteed: false,
  };
}

export function readPaperCursor(): number {
  if (typeof localStorage === 'undefined') return 0;
  return clampPlayed(Number(localStorage.getItem(PAPER_14K_CURSOR_KEY) || 0));
}

export function writePaperCursor(played: number): number {
  const n = clampPlayed(played);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PAPER_14K_CURSOR_KEY, String(n));
  }
  return n;
}

export function resetPaperCursor(): number {
  return writePaperCursor(0);
}
