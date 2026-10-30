import { describe, expect, it } from 'vitest';
import {
  CRUDE_DAILY_GREEN,
  confirmDir,
  dayShouldStandDown,
  hhmmToMin,
  pdhlDir,
  shouldScratch,
  skipWildPrevDay,
  smellAgainst,
  weekMonday,
  weekShouldStandDown,
} from './crude-daily-green.dna';

describe('Crude weekly-bank DNA', () => {
  it('banks a small green day and scratches losers before the 20-pt hard SL', () => {
    expect(CRUDE_DAILY_GREEN.profileId).toBe('weekly-bank-sc8');
    expect(CRUDE_DAILY_GREEN.stopPts).toBe(20);
    expect(CRUDE_DAILY_GREEN.scratchPts).toBe(8);
    expect(CRUDE_DAILY_GREEN.smellFirstBar).toBe(true);
    expect(CRUDE_DAILY_GREEN.targetPts).toBe(30);
    expect(CRUDE_DAILY_GREEN.maxTrades).toBe(2);
    expect(CRUDE_DAILY_GREEN.firstWin).toBe(true);
    expect(CRUDE_DAILY_GREEN.confirm).toBe(true);
    expect(CRUDE_DAILY_GREEN.maxPrevDayRangePts).toBe(400);
    expect(CRUDE_DAILY_GREEN.dayLockPts).toBe(20);
    expect(CRUDE_DAILY_GREEN.dayLossPts).toBe(40);
  });

  it('skips only when yesterday was wider than 400 pts', () => {
    expect(skipWildPrevDay(5400, 5000)).toBe(false);
    expect(skipWildPrevDay(5400, 4999)).toBe(true);
    expect(skipWildPrevDay(5200, 5100)).toBe(false);
  });

  it('takes a prior-day break only with candle colour, then next-bar confirm', () => {
    expect(pdhlDir(5210, 5200, 5205, 5100)).toBe(1);
    expect(pdhlDir(5210, 5215, 5205, 5100)).toBe(0);
    expect(pdhlDir(5090, 5100, 5205, 5095)).toBe(-1);
    expect(confirmDir(1, 5210, 5212, 5218)).toBe(true);
    expect(confirmDir(1, 5210, 5218, 5211)).toBe(false);
  });

  it('uses the all-session window and 23:10 flatten', () => {
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryStart)).toBe(9 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryEnd)).toBe(23 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.flatten)).toBe(23 * 60 + 10);
  });

  it('banks the week at +40 pts so a green week is not given back', () => {
    expect(CRUDE_DAILY_GREEN.weekLockPts).toBe(40);
    expect(CRUDE_DAILY_GREEN.weekLossPts).toBe(0);
    expect(CRUDE_DAILY_GREEN.sitAfterRedDay).toBe(false);
    expect(weekShouldStandDown(39)).toBe(false);
    expect(weekShouldStandDown(40)).toBe(true);
    expect(weekShouldStandDown(-40)).toBe(false);
    expect(weekMonday('2026-08-19')).toBe('2026-08-17');
  });

  it('scratches 8 pts against and smells a first bar that closes against', () => {
    expect(shouldScratch(1, 5200, 5193)).toBe(false);
    expect(shouldScratch(1, 5200, 5192)).toBe(true);
    expect(shouldScratch(-1, 5200, 5208)).toBe(true);
    expect(smellAgainst(1, 5200, 5194)).toBe(true);
    expect(smellAgainst(1, 5200, 5201)).toBe(false);
  });

  it('sits down after a green day (first win / +20 lock)', () => {
    expect(dayShouldStandDown(-8, 1)).toBe(false);
    expect(dayShouldStandDown(20, 1)).toBe(true);
    expect(dayShouldStandDown(5, 1)).toBe(true);
    expect(dayShouldStandDown(0, 2)).toBe(true);
  });
});
