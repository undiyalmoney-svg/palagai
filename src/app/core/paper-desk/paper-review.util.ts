/**
 * Two agents + a judge on a night log. Scout says why the desk took the fill.
 * Critic says why it failed or what to change. Judge names one exact engine change.
 * Same rules every dump — not a chat model, not a guaranteed profit.
 */

export const PAPER_REVIEW_BID_THROUGH = 'option-tick-exit-when-bid-through-level';

export interface PaperReviewFill {
  under?: string;
  label?: string;
  contract?: string;
  optionType?: string;
  side?: string;
  mode?: string;
  structure?: string;
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  rs: number;
  pts?: number;
  grade?: string;
  reason: string;
  holdMin?: number | null;
  gaugeMove?: number | null;
  gaugeNeed?: number | null;
  entryAt?: string;
  exitAt?: string;
  charges?: number | null;
  lot?: number;
  entryAsk?: number | null;
  exitBid?: number | null;
}

export interface PaperReviewLog {
  day?: string;
  closedRs?: number;
  fills?: PaperReviewFill[];
}

export interface PaperAgentFillNote {
  under: string;
  note: string;
}

export interface PaperAgent {
  id: 'taken' | 'failed' | 'judge';
  title: string;
  body: string;
  fills: PaperAgentFillNote[];
  changeId?: string;
  change?: string;
}

export interface PaperReview {
  taken: PaperAgent;
  failed: PaperAgent;
  judge: PaperAgent;
}

export function paperReviewClock(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

export function fillThroughStop(f: PaperReviewFill): boolean {
  if (f.reason !== 'sl' && f.reason !== 'scratch') return false;
  const sl = Number(f.sl);
  const exit = Number(f.exit);
  if (!(sl > 0) || !Number.isFinite(exit)) return false;
  return exit < sl - 0.05;
}

export function fillsSamePoll(fills: PaperReviewFill[], ms = 2000): boolean {
  const times = fills
    .map((f) => Date.parse(String(f.exitAt || '')))
    .filter((n) => Number.isFinite(n));
  if (times.length < 2) return false;
  return Math.max(...times) - Math.min(...times) <= ms;
}

function nameOf(f: PaperReviewFill): string {
  return f.contract || f.label || f.under || 'book';
}

function takenNote(f: PaperReviewFill): string {
  const kind = f.optionType === 'PE' ? 'PE' : f.optionType === 'CE' ? 'CE' : 'option';
  const dir = kind === 'PE' ? 'down' : 'up';
  const st = f.structure ? ` Morning was ${f.structure}.` : '';
  const mode = f.mode || 'momentum';
  const lot = f.lot ? ` ${f.lot} qty.` : '';
  return (
    `${nameOf(f)} — ATM ${kind} because ${mode} 0.8× 1-min ${dir} confirm at ` +
    `${paperReviewClock(f.entryAt)} IST, fill at ask ₹${f.entry}.` +
    st +
    ` SL ₹${f.sl} (₹370 stop)${lot} Target ₹${f.tp}.`
  );
}

function failedNote(f: PaperReviewFill): string {
  const through = fillThroughStop(f);
  const slip = through ? Math.round((Number(f.sl) - Number(f.exit)) * 10) / 10 : 0;
  const extra =
    through && f.lot
      ? ` ~₹${Math.round(slip * f.lot)} past the ₹370 stop.`
      : '';
  const gauge =
    f.gaugeMove != null && f.gaugeNeed != null
      ? ` Underlying ${f.gaugeMove} vs need ${f.gaugeNeed}.`
      : '';
  const hold = f.holdMin != null ? ` Held ${f.holdMin}m.` : '';
  if (through) {
    return (
      `${nameOf(f)} — ${f.reason} sold ₹${f.exit} vs SL ₹${f.sl} (${slip} pts through).` +
      extra +
      gauge +
      hold +
      ` ₹${f.rs}. Grade ${f.grade || 'F'}.`
    );
  }
  return (
    `${nameOf(f)} — ${f.reason} exit ₹${f.exit} from ₹${f.entry}.` +
    gauge +
    hold +
    ` ₹${f.rs}. Grade ${f.grade || '—'}.`
  );
}

function judgeOf(fills: PaperReviewFill[]): Pick<PaperAgent, 'body' | 'changeId' | 'change' | 'fills'> {
  const through = fills.filter(fillThroughStop);
  const same = fillsSamePoll(fills);
  if (through.length) {
    const change =
      'In tickBook, do not let barsHandleExit skip the 8s hitExit when the live bid is already through SL, scratch, or TP. Keep tooSoon and the fill-minute skip. A lagged 1-min option candle must not block a bid that is already through the stop.';
    const why = same
      ? ` ${through.length} books stopped on the same poll, sold through the SL. That is a lagged candle, not two independent hits.`
      : ' The fill sold through the written SL. The live bid was not checked while option candles lagged.';
    return {
      changeId: PAPER_REVIEW_BID_THROUGH,
      change,
      body: `Exact change: honor the live bid stop on that tick.${why} Do not rewrite 0.8× momentum from this dump. Not a guaranteed ₹370.`,
      fills: [
        {
          under: 'engine',
          note: `live-paper.engine.ts tickBook — ${PAPER_REVIEW_BID_THROUGH}`,
        },
      ],
    };
  }
  return {
    changeId: 'none',
    change: 'No engine change. Wait for more fills.',
    body: 'Stops printed at the written SL. The signal went the wrong way. Do not rewrite 0.8× or skip-range from this dump. Not a guaranteed ₹370.',
    fills: [],
  };
}

export function reviewPaperDesk(log: PaperReviewLog): PaperReview {
  const fills = log.fills || [];
  const through = fills.filter(fillThroughStop);
  const same = fillsSamePoll(fills);
  const takenBody = fills.length
    ? 'Each book bought its own ATM CE/PE from a 0.8× 1-min confirm. Paper always records. Not a lock.'
    : 'No closed fill yet.';
  const failedBody = !fills.length
    ? 'No closed fill yet.'
    : through.length
      ? same
        ? 'The live bid stop did not fire while 1-min option candles lagged. One poll then sold every open book at the crashed bid. Direction was also wrong. Honoring the bid still loses about ₹370 each, not thousands past the stop. Not a guaranteed profit.'
        : 'The fill sold through the written SL. Honor the live bid on every tick when it is already through. A ₹370 stop that fills at the bid is still a loss. Not a guaranteed profit.'
      : 'The stop filled at the written SL. The underlying went the other way. That is a wrong-direction fill, not an exit-path bug. Not a guaranteed profit.';
  const judge = judgeOf(fills);
  return {
    taken: {
      id: 'taken',
      title: 'Why taken',
      body: takenBody,
      fills: fills.map((f) => ({ under: f.under || f.label || 'book', note: takenNote(f) })),
    },
    failed: {
      id: 'failed',
      title: 'Why it failed',
      body: failedBody,
      fills: fills.map((f) => ({ under: f.under || f.label || 'book', note: failedNote(f) })),
    },
    judge: {
      id: 'judge',
      title: 'Judge',
      body: judge.body,
      fills: judge.fills,
      changeId: judge.changeId,
      change: judge.change,
    },
  };
}
