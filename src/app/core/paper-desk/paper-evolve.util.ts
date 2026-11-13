/**
 * Self-developing paper desk. Scout/critic read the night log. The judge
 * names one exact changeId from a whitelist. That id is applied and kept
 * (palagai_paper_evolve_v1 — not the v11 blotter). Not a chat rewrite of 0.8×.
 * Not a guaranteed profit.
 */
import {
  PAPER_REVIEW_BID_THROUGH,
  PaperReview,
  PaperReviewLog,
  reviewPaperDesk,
} from './paper-review.util';

export const PAPER_EVOLVE_KEY = 'palagai_paper_evolve_v1';
export const PAPER_PATCH_BID_THROUGH = PAPER_REVIEW_BID_THROUGH;
export const PAPER_PATCH_NO_STALE_CATCHUP = 'no-stale-option-catchup-bid';

export interface PaperEvolveApplied {
  id: string;
  at: string;
  day?: string;
}

export interface PaperEvolveState {
  applied: PaperEvolveApplied[];
}

export interface PaperEvolveFlags {
  /** Shipped: 8s hitExit when live bid is through SL/TP/scratch. */
  bidThroughTick: boolean;
  /** Judge: lagged option bars use their own OHLC, not the current crashed bid. */
  barCatchupIgnoresLiveBid: boolean;
}

export interface PaperJudgePatch {
  id: string;
  change: string;
  evidence: (log: PaperReviewLog) => boolean;
}

const THROUGH_SL = (log: PaperReviewLog): boolean =>
  (log.fills || []).some((f) => {
    if (f.reason !== 'sl' && f.reason !== 'scratch') return false;
    const sl = Number(f.sl);
    const exit = Number(f.exit);
    return sl > 0 && Number.isFinite(exit) && exit < sl - 0.05;
  });

/** Only these ids can ever be applied. No free-form engine rewrite. */
export const PAPER_JUDGE_PATCHES: PaperJudgePatch[] = [
  {
    id: PAPER_PATCH_BID_THROUGH,
    change:
      'In tickBook, do not let barsHandleExit skip the 8s hitExit when the live bid is already through SL, scratch, or TP. Keep tooSoon and the fill-minute skip.',
    evidence: THROUGH_SL,
  },
  {
    id: PAPER_PATCH_NO_STALE_CATCHUP,
    change:
      'When catching up lagged 1-min option bars, do not pass the current live bid into hitExit. Use that bar’s own high/low/open. The live bid is only for the current tick. A 10-minute sleep must not sell every missed minute at the crashed bid.',
    evidence: THROUGH_SL,
  },
];

export function emptyEvolve(): PaperEvolveState {
  return {
    applied: [{ id: PAPER_PATCH_BID_THROUGH, at: 'shipped', day: '2026-11-13' }],
  };
}

export function paperEvolveFlags(state: PaperEvolveState | null | undefined): PaperEvolveFlags {
  const ids = new Set((state?.applied || []).map((a) => a.id));
  return {
    bidThroughTick: true,
    barCatchupIgnoresLiveBid: ids.has(PAPER_PATCH_NO_STALE_CATCHUP),
  };
}

export function hasPatch(state: PaperEvolveState | null | undefined, id: string): boolean {
  return (state?.applied || []).some((a) => a.id === id);
}

export function nextJudgePatch(log: PaperReviewLog, state: PaperEvolveState): PaperJudgePatch | null {
  return PAPER_JUDGE_PATCHES.find((p) => !hasPatch(state, p.id) && p.evidence(log)) || null;
}

export function applyJudgePatch(state: PaperEvolveState, id: string, day?: string, at?: string): PaperEvolveState {
  if (!PAPER_JUDGE_PATCHES.some((p) => p.id === id) || hasPatch(state, id)) return state;
  return {
    applied: [...state.applied, { id, at: at || new Date().toISOString(), day }],
  };
}

export function readPaperEvolve(storage?: Storage | null): PaperEvolveState {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return emptyEvolve();
  try {
    const raw = JSON.parse(store.getItem(PAPER_EVOLVE_KEY) || 'null');
    const applied = Array.isArray(raw?.applied) ? raw.applied : [];
    const rows = applied
      .filter((a: PaperEvolveApplied) => a && typeof a.id === 'string' && PAPER_JUDGE_PATCHES.some((p) => p.id === a.id))
      .map((a: PaperEvolveApplied) => ({ id: a.id, at: String(a.at || ''), day: a.day }));
    const base = emptyEvolve();
    for (const row of rows) {
      if (!hasPatch(base, row.id)) base.applied.push(row);
    }
    return base;
  } catch {
    return emptyEvolve();
  }
}

export function writePaperEvolve(state: PaperEvolveState, storage?: Storage | null): void {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return;
  store.setItem(PAPER_EVOLVE_KEY, JSON.stringify({ applied: state.applied }));
}

export function reviewEvolvingDesk(log: PaperReviewLog, state: PaperEvolveState = emptyEvolve()): PaperReview {
  const next = nextJudgePatch(log, state);
  const base = reviewPaperDesk(log);
  const appliedNote = state.applied.map((a) => a.id).join(', ');
  if (!next) {
    return {
      ...base,
      judge: {
        ...base.judge,
        changeId: 'none',
        change: appliedNote
          ? `Already applied: ${appliedNote}. No further engine change from this dump.`
          : 'No engine change. Wait for more fills.',
        body: appliedNote
          ? `This desk applied ${appliedNote}. Next ticks use those rules. Do not rewrite 0.8× momentum from this dump. Not a guaranteed ₹370.`
          : base.judge.body,
        fills: state.applied.map((a) => ({ under: 'engine', note: `applied ${a.id}` })),
      },
    };
  }
  return {
    ...base,
    judge: {
      id: 'judge',
      title: 'Judge',
      changeId: next.id,
      change: next.change,
      body: `Exact change: apply ${next.id} on this desk now. Next ticks use it. Do not rewrite 0.8× momentum from this dump. Not a guaranteed ₹370.`,
      fills: [{ under: 'engine', note: `pending ${next.id}` }],
    },
  };
}

export function evolvePaperDesk(
  log: PaperReviewLog,
  state: PaperEvolveState = emptyEvolve(),
): { state: PaperEvolveState; appliedNow: string | null; review: PaperReview } {
  const next = nextJudgePatch(log, state);
  if (!next) return { state, appliedNow: null, review: reviewEvolvingDesk(log, state) };
  const evolved = applyJudgePatch(state, next.id, log.day);
  return { state: evolved, appliedNow: next.id, review: reviewEvolvingDesk(log, evolved) };
}
