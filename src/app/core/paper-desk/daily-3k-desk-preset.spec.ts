import { describe, expect, it } from 'vitest';
import { DAILY_3K_DESK_PRESET } from './daily-3k-desk-preset';

describe('DAILY_3K_DESK_PRESET', () => {
  it('wires 1-lot Daily ₹1k–₹3k with risk locks', () => {
    expect(DAILY_3K_DESK_PRESET.niftyLots).toBe(1);
    expect(DAILY_3K_DESK_PRESET.bankLots).toBe(1);
    expect(DAILY_3K_DESK_PRESET.crudeLots).toBe(1);
    expect(DAILY_3K_DESK_PRESET.enableNifty).toBe(true);
    expect(DAILY_3K_DESK_PRESET.enableBank).toBe(true);
    expect(DAILY_3K_DESK_PRESET.enableCrude).toBe(true);
    expect(DAILY_3K_DESK_PRESET.enableNatGas).toBe(false);
    expect(DAILY_3K_DESK_PRESET.enableKutty).toBe(false);
    expect(DAILY_3K_DESK_PRESET.dayProfitLock).toBe(true);
    expect(DAILY_3K_DESK_PRESET.strictDayStop).toBe(true);
  });
});
