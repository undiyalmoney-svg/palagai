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

  it('REGRESSION: same contract with a new entryTime is a hold, not a round trip', () => {
    // drain→rehunt on the same symbol used to sell and buy the identical option
    // back seconds later, paying the spread for nothing.
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
    ).toBe(true);
  });

  it('REGRESSION: adopted leg (entryTime stamped at adopt, direction BUY) is held', () => {
    // reconcileFromBroker stamps entryTime = now and direction = BUY. A long PE
    // signal reads as fut SELL, so the old rule round-tripped it on every restart.
    expect(
      liveOpenMatchesBroker(
        {
          status: 'open',
          tradingSymbol: 'NIFTY2681124600PE',
          entryTime: '2026-08-07T11:12:00+05:30',
          direction: 'BUY',
        },
        {
          direction: 'SELL',
          entryTime: '2026-08-07T10:10:00+05:30',
          option: { tradingSymbol: 'NIFTY2681124600PE' },
        },
      ),
    ).toBe(true);
  });

  it('still hands off to a different strike', () => {
    expect(
      liveOpenMatchesBroker(
        {
          status: 'open',
          tradingSymbol: 'NIFTY2681124600PE',
          entryTime: '2026-08-07T10:10:00+05:30',
          direction: 'SELL',
        },
        {
          direction: 'SELL',
          entryTime: '2026-08-07T11:30:00+05:30',
          option: { tradingSymbol: 'NIFTY2681124550PE' },
        },
      ),
    ).toBe(false);
  });

  it('a flat broker leg never matches', () => {
    expect(
      liveOpenMatchesBroker(
        {
          status: 'flat',
          tradingSymbol: 'NIFTY28JUL25000CE',
          entryTime: '2026-07-28T10:00:00+05:30',
          direction: 'BUY',
        },
        baseOpen,
      ),
    ).toBe(false);
  });
});
