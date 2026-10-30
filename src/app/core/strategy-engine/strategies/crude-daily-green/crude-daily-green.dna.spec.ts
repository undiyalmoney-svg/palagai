import { describe, expect, it } from 'vitest';
import {
  CRUDE_DAILY_GREEN,
  confirmDir,
  hhmmToMin,
  pdhlDir,
  skipWildPrevDay,
} from './crude-daily-green.dna';

describe('Crude daily-green DNA', () => {
  it('keeps Daily Profit size and adds the 400-pt wild-day skip', () => {
    expect(CRUDE_DAILY_GREEN.stopPts).toBe(20);
    expect(CRUDE_DAILY_GREEN.targetPts).toBe(40);
    expect(CRUDE_DAILY_GREEN.maxTrades).toBe(2);
    expect(CRUDE_DAILY_GREEN.firstWin).toBe(false);
    expect(CRUDE_DAILY_GREEN.confirm).toBe(true);
    expect(CRUDE_DAILY_GREEN.maxPrevDayRangePts).toBe(400);
    expect(CRUDE_DAILY_GREEN.dayLockPts).toBe(50);
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

  it('uses the evening window and 23:10 flatten', () => {
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryStart)).toBe(18 * 60 + 30);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryEnd)).toBe(21 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.flatten)).toBe(23 * 60 + 10);
  });
});
