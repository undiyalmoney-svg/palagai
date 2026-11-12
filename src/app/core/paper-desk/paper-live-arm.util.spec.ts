import { describe, expect, it, beforeEach } from 'vitest';
import {
  PAPER_LIVE_ARM_KEY,
  emptyPaperLiveArm,
  paperLiveArmArmed,
  readPaperLiveArm,
  writePaperLiveArm,
} from './paper-live-arm.util';

describe('paper live arm persist', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts disarmed and restores Live plus ticked books', () => {
    expect(readPaperLiveArm()).toEqual(emptyPaperLiveArm());
    expect(paperLiveArmArmed(readPaperLiveArm())).toBe(false);
    writePaperLiveArm({ live: true, books: { nifty: false, bank: true, sensex: false, crude: true } });
    expect(localStorage.getItem(PAPER_LIVE_ARM_KEY)).toMatch(/bank/);
    const arm = readPaperLiveArm();
    expect(arm.live).toBe(true);
    expect(arm.books.bank).toBe(true);
    expect(arm.books.crude).toBe(true);
    expect(arm.books.nifty).toBe(false);
    expect(paperLiveArmArmed(arm)).toBe(true);
  });
});
