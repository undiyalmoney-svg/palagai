import { describe, expect, it } from 'vitest';
import {
  CRUDE_DAILY_GREEN,
  confirmDir,
  dayShouldStandDown,
  entryDir,
  hhmmToMin,
  orbFadeDir,
  pdhlDir,
  shouldScratch,
  skipWildPrevDay,
  smellAgainst,
  trapDir,
  weekMonday,
  weekShouldStandDown,
} from './crude-daily-green.dna';

describe('Crude daily-min DNA', () => {
  it('aims for ₹200 after charges and scratches losers before the 20-pt hard SL', () => {
    expect(CRUDE_DAILY_GREEN.profileId).toBe('daily-min-sc10');
    expect(CRUDE_DAILY_GREEN.stopPts).toBe(20);
    expect(CRUDE_DAILY_GREEN.scratchPts).toBe(10);
    expect(CRUDE_DAILY_GREEN.smellFirstBar).toBe(true);
    expect(CRUDE_DAILY_GREEN.targetPts).toBe(25);
    expect(CRUDE_DAILY_GREEN.maxTrades).toBe(2);
    expect(CRUDE_DAILY_GREEN.firstWin).toBe(true);
    expect(CRUDE_DAILY_GREEN.confirm).toBe(true);
    expect(CRUDE_DAILY_GREEN.maxPrevDayRangePts).toBe(400);
    expect(CRUDE_DAILY_GREEN.dayLockPts).toBe(20);
    expect(CRUDE_DAILY_GREEN.dayLossPts).toBe(40);
    expect(CRUDE_DAILY_GREEN.targetPts * CRUDE_DAILY_GREEN.rupeesPerPoint - CRUDE_DAILY_GREEN.chargeRs).toBe(
      200,
    );
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

  it('fades a poke back into the 10:00–11:00 opening range after 11:00', () => {
    expect(orbFadeDir(5204, 5210, 5216, 5202, 5212, 5190, 11 * 60 + 5)).toBe(-1);
    expect(orbFadeDir(5204, 5210, 5216, 5202, 5212, 5190, 10 * 60 + 30)).toBe(0);
    expect(orbFadeDir(5196, 5190, 5198, 5184, 5212, 5190, 12 * 60)).toBe(1);
  });

  it('traps a 6-bar swing pierce that closes back through the level', () => {
    expect(trapDir(5108, 5100, 5110, 5088, 5120, 5100)).toBe(1);
    expect(trapDir(5132, 5140, 5152, 5130, 5140, 5100)).toBe(-1);
    expect(trapDir(5108, 5100, 5110, 5096, 5120, 5100)).toBe(0);
  });

  it('uses PDHL first, then fade, then trap; wild yesterday blocks PDHL only', () => {
    expect(entryDir(5210, 5200, 5212, 5198, 5205, 5100, 5180, 5160, 5190, 5170, 10 * 60)).toBe(1);
    expect(entryDir(5210, 5200, 5212, 5198, 5600, 5100, 5180, 5160, 5190, 5170, 10 * 60)).toBe(0);
    expect(entryDir(5204, 5210, 5216, 5202, 5300, 5100, 5212, 5190, 5190, 5170, 11 * 60 + 5)).toBe(-1);
  });

  it('skips the 09:00 wash-out and flattens 23:10', () => {
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryStart)).toBe(10 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.entryEnd)).toBe(23 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.flatten)).toBe(23 * 60 + 10);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.orStart)).toBe(10 * 60);
    expect(hhmmToMin(CRUDE_DAILY_GREEN.orEnd)).toBe(11 * 60);
  });

  it('does not sit the rest of a green week, so every day can still hunt ₹150', () => {
    expect(CRUDE_DAILY_GREEN.weekLockPts).toBe(0);
    expect(CRUDE_DAILY_GREEN.weekLossPts).toBe(0);
    expect(CRUDE_DAILY_GREEN.sitAfterRedDay).toBe(false);
    expect(weekShouldStandDown(39)).toBe(false);
    expect(weekShouldStandDown(40)).toBe(false);
    expect(weekShouldStandDown(-40)).toBe(false);
    expect(weekMonday('2026-08-19')).toBe('2026-08-17');
  });

  it('scratches 10 pts against and smells a first bar that closes against', () => {
    expect(shouldScratch(1, 5200, 5191)).toBe(false);
    expect(shouldScratch(1, 5200, 5190)).toBe(true);
    expect(shouldScratch(-1, 5200, 5210)).toBe(true);
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
