import { describe, expect, it } from 'vitest';
import {
  PAPER_REVIEW_BID_THROUGH,
  fillThroughStop,
  fillsSamePoll,
  paperReviewClock,
  reviewPaperDesk,
} from './paper-review.util';

/** Closed today 2026-11-13, copied from palagai.app night log. Asia/Calcutta. */
const TODAY = {
  day: '2026-11-13',
  closedRs: -3535.1,
  fills: [
    {
      under: 'nifty',
      label: 'Nifty 50',
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
      gaugeMove: -22.4,
      gaugeNeed: 17.6,
      entryAt: '2026-11-13T05:22:15.711Z',
      exitAt: '2026-11-13T05:32:37.600Z',
      lot: 65,
    },
    {
      under: 'bank',
      label: 'Bank Nifty',
      contract: 'BANKNIFTY 61200 CE · exp 23 Nov',
      optionType: 'CE',
      mode: 'momentum',
      structure: 'trend',
      entry: 635.35,
      exit: 567.2,
      sl: 623.02,
      tp: 650.79,
      rs: -2133,
      grade: 'F',
      reason: 'sl',
      holdMin: 10,
      gaugeMove: -88.3,
      gaugeNeed: 70,
      entryAt: '2026-11-13T05:22:13.798Z',
      exitAt: '2026-11-13T05:32:37.096Z',
      lot: 30,
    },
  ],
};

describe('paper review agents', () => {
  it('clocks the dump in IST', () => {
    expect(paperReviewClock('2026-11-13T05:22:15.711Z')).toBe('10:52');
    expect(paperReviewClock('2026-11-13T05:32:37.600Z')).toBe('11:02');
  });

  it('sees both 13 Nov stops as through-SL on the same poll', () => {
    expect(TODAY.fills.every(fillThroughStop)).toBe(true);
    expect(fillsSamePoll(TODAY.fills)).toBe(true);
  });

  it('scout says why each CE was taken, critic says why it failed, judge names the bid-through tick', () => {
    const r = reviewPaperDesk(TODAY);
    expect(r.taken.title).toBe('Why taken');
    expect(r.taken.fills[0].note).toMatch(/ATM CE/);
    expect(r.taken.fills[0].note).toMatch(/10:52 IST/);
    expect(r.taken.fills[0].note).toMatch(/range/);
    expect(r.taken.fills[1].note).toMatch(/trend/);
    expect(r.taken.body).toMatch(/Not a lock/);

    expect(r.failed.title).toBe('Why it failed');
    expect(r.failed.body).toMatch(/lagged/);
    expect(r.failed.fills[0].note).toMatch(/141\.6/);
    expect(r.failed.fills[0].note).toMatch(/156\.41/);
    expect(r.failed.fills[1].note).toMatch(/567\.2/);
    expect(r.failed.body).toMatch(/Not a guaranteed profit/);

    expect(r.judge.title).toBe('Judge');
    expect(r.judge.changeId).toBe(PAPER_REVIEW_BID_THROUGH);
    expect(r.judge.change).toMatch(/barsHandleExit/);
    expect(r.judge.change).toMatch(/tooSoon/);
    expect(r.judge.body).toMatch(/Do not rewrite 0\.8/);
  });

  it('does not ask for an engine change when the stop fills at the written SL', () => {
    const r = reviewPaperDesk({
      fills: [
        {
          under: 'nifty',
          contract: 'NIFTY 25250 CE',
          optionType: 'CE',
          mode: 'momentum',
          structure: 'range',
          entry: 162.1,
          exit: 156.41,
          sl: 156.41,
          tp: 168.92,
          rs: -440,
          grade: 'F',
          reason: 'sl',
          holdMin: 4,
          entryAt: '2026-11-13T05:22:15.711Z',
          exitAt: '2026-11-13T05:26:15.711Z',
          lot: 65,
        },
      ],
    });
    expect(r.judge.changeId).toBe('none');
    expect(fillThroughStop({ ...TODAY.fills[0], exit: 156.41 })).toBe(false);
  });
});
