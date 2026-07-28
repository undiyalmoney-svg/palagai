import { describe, expect, it } from 'vitest';
import { liveOpenMatchesBroker } from './live-open-match.util';

describe('liveOpenMatchesBroker', () => {
  const baseOpen = {
    direction: 'BUY' as const,
    entryTime: '2026-07-28T10:00:00+05:30',
    option: { tradingSymbol: 'NIFTY28JUL25000CE' },
  };

  it('matches same broker leg (SL amend path)', () => {
    expect(
      liveOpenMatchesBroker(
        {
          status: 'open',
          tradingSymbol: 'NIFTY28JUL25000CE',
          entryTime: '2026-07-28T10:00:00+05:30',
          direction: 'BUY',
        },
        baseOpen,
      ),
    ).toBe(true);
  });

  it('detects handoff when option symbol changes (Kutty→Strat)', () => {
    expect(
      liveOpenMatchesBroker(
        {
          status: 'open',
          tradingSymbol: 'NIFTY28JUL24950CE',
          entryTime: '2026-07-28T10:00:00+05:30',
          direction: 'BUY',
        },
        baseOpen,
      ),
    ).toBe(false);
  });

  it('detects handoff when entryTime changes (drain→rehunt)', () => {
    expect(
      liveOpenMatchesBroker(
        {
          status: 'open',
          tradingSymbol: 'NIFTY28JUL25000CE',
          entryTime: '2026-07-28T10:00:00+05:30',
          direction: 'BUY',
        },
        { ...baseOpen, entryTime: '2026-07-28T11:30:00+05:30' },
      ),
    ).toBe(false);
  });
});
