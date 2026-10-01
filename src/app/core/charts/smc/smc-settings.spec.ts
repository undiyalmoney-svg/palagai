import { describe, expect, it } from 'vitest';
import {
  SMC_DEFAULT_HTF,
  SMC_DEFAULT_LTF,
  SMC_STORAGE_KEY,
  defaultSmcSettings,
  loadSmcSettings,
} from './smc-settings';

describe('smc settings', () => {
  it('defaults to a 1-minute entry and a 5-minute trend filter', () => {
    expect(SMC_DEFAULT_LTF).toBe('1m');
    expect(SMC_DEFAULT_HTF).toBe('5m');
    expect(defaultSmcSettings()).toMatchObject({
      ltf: '1m',
      htf: '5m',
    });
    expect(defaultSmcSettings().layers).toMatchObject({
      session: true,
      structure: true,
      fvg: true,
      liquidity: true,
      levels: true,
      swings: false,
      orderBlocks: false,
      fib: false,
      premiumDiscount: false,
    });
  });

  it('stores the 1-minute pathway under a new key so old 15m books stay behind', () => {
    expect(SMC_STORAGE_KEY).toBe('palagai.smc.settings.v2');
    const storage = {
      getItem: (key: string) =>
        key === 'palagai.smc.settings.v1' ? JSON.stringify({ ltf: '15m', htf: '1h' }) : null,
    };
    expect(loadSmcSettings(storage)).toMatchObject({ ltf: '1m', htf: '5m' });
  });
});
