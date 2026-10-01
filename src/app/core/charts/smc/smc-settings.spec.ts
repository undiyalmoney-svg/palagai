import { describe, expect, it } from 'vitest';
import {
  SMC_DEFAULT_HTF,
  SMC_DEFAULT_LTF,
  SMC_STORAGE_KEY,
  defaultSmcSettings,
  isAutoTradeOn,
  loadSmcSettings,
  parseAutoTrade,
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

  it('keeps Auto off on every book by default', () => {
    expect(defaultSmcSettings().autoTrade).toEqual({ nifty: false, bank: false, crude: false });
  });

  it('migrates the old all-books Auto flag and loads one switch per book', () => {
    expect(parseAutoTrade(true)).toEqual({ nifty: true, bank: true, crude: true });
    expect(parseAutoTrade(false)).toEqual({ nifty: false, bank: false, crude: false });
    const mixed = parseAutoTrade({ nifty: true, bank: false, crude: true });
    expect(mixed).toEqual({ nifty: true, bank: false, crude: true });
    expect(isAutoTradeOn({ autoTrade: mixed }, 'nifty')).toBe(true);
    expect(isAutoTradeOn({ autoTrade: mixed }, 'bank')).toBe(false);

    const storage = {
      getItem: () => JSON.stringify({ autoTrade: { nifty: true, bank: false, crude: false } }),
    };
    expect(loadSmcSettings(storage).autoTrade).toEqual({ nifty: true, bank: false, crude: false });
  });
});
