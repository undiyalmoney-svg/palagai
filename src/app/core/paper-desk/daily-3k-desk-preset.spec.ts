import { describe, expect, it } from 'vitest';
import { DAILY_3K_DESK_PRESET } from './daily-3k-desk-preset';

describe('DAILY_3K_DESK_PRESET', () => {
  it('is Nifty+Bank only with capital guards on', () => {
    expect(DAILY_3K_DESK_PRESET.niftyLots).toBe(1);
    expect(DAILY_3K_DESK_PRESET.bankLots).toBe(1);
    expect(DAILY_3K_DESK_PRESET.enableNifty).toBe(true);
    expect(DAILY_3K_DESK_PRESET.enableBank).toBe(true);
    expect(DAILY_3K_DESK_PRESET.enableKutty).toBe(false);
    expect(DAILY_3K_DESK_PRESET.dayProfitLock).toBe(true);
    expect(DAILY_3K_DESK_PRESET.strictDayStop).toBe(true);
    expect('enableCrude' in DAILY_3K_DESK_PRESET).toBe(false);
  });
});
