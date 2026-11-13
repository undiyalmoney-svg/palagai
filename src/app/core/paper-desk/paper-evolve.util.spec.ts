import { describe, expect, it } from 'vitest';
import {
  PAPER_PATCH_BID_THROUGH,
  PAPER_PATCH_NO_STALE_CATCHUP,
  emptyEvolve,
  evolvePaperDesk,
  hasPatch,
  paperEvolveFlags,
  reviewEvolvingDesk,
} from './paper-evolve.util';

const TODAY = {
  day: '2026-11-13',
  closedRs: -3535.1,
  fills: [
    {
      under: 'nifty',
      contract: 'NIFTY 25250 CE · exp 17 Nov',
      optionType: 'CE',
      mode: 'momentum',
      structure: 'range',
      entry: 162.1,
      exit: 141.6,
      sl: 156.41,
      tp: 168.92,
      rs: -1402.1,
      grade: 'F',
      reason: 'sl',
      holdMin: 10,
      entryAt: '2026-11-13T05:22:15.711Z',
      exitAt: '2026-11-13T05:32:37.600Z',
      lot: 65,
    },
  ],
};

describe('paper evolve judge', () => {
  it('ships bid-through and names no-stale-catchup on the 13 Nov through-SL dump', () => {
    const seed = emptyEvolve();
    expect(hasPatch(seed, PAPER_PATCH_BID_THROUGH)).toBe(true);
    expect(paperEvolveFlags(seed).bidThroughTick).toBe(true);
    expect(paperEvolveFlags(seed).barCatchupIgnoresLiveBid).toBe(false);
    const pending = reviewEvolvingDesk(TODAY, seed);
    expect(pending.judge.changeId).toBe(PAPER_PATCH_NO_STALE_CATCHUP);
    expect(pending.judge.body).toMatch(/apply no-stale-option-catchup-bid/);
    const evolved = evolvePaperDesk(TODAY, seed);
    expect(evolved.appliedNow).toBe(PAPER_PATCH_NO_STALE_CATCHUP);
    expect(paperEvolveFlags(evolved.state).barCatchupIgnoresLiveBid).toBe(true);
    const done = reviewEvolvingDesk(TODAY, evolved.state);
    expect(done.judge.changeId).toBe('none');
    expect(done.judge.body).toMatch(/This desk applied/);
    expect(done.judge.body).toMatch(/Not a guaranteed ₹370/);
  });

  it('does not invent a patch when the stop fills at the written SL', () => {
    const r = reviewEvolvingDesk(
      {
        fills: [
          {
            under: 'nifty',
            contract: 'NIFTY 25250 CE',
            optionType: 'CE',
            entry: 162.1,
            exit: 156.41,
            sl: 156.41,
            tp: 168.92,
            rs: -440,
            reason: 'sl',
            lot: 65,
          },
        ],
      },
      emptyEvolve(),
    );
    expect(r.judge.changeId).toBe('none');
    expect(evolvePaperDesk({ fills: [] }, emptyEvolve()).appliedNow).toBe(null);
  });
});
