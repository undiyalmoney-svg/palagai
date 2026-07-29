import { describe, expect, it } from 'vitest';
import {
  indexRsPerPoint,
  protectionDayCapsFromExtras,
  PROTECTION_DNA_EXTRAS,
} from './strategy-dna-caps';

describe('protectionDayCapsFromExtras', () => {
  it('maps dayLossCapRs ₹2500 → Nifty/Bank dayStopPts', () => {
    const extras = { ...PROTECTION_DNA_EXTRAS };
    expect(protectionDayCapsFromExtras(extras, 'nifty')).toEqual({
      dayStopPts: Math.round(2500 / 65),
    });
    expect(protectionDayCapsFromExtras(extras, 'bank')).toEqual({
      dayStopPts: Math.round(2500 / 30),
    });
  });

  it('maps dayBankQuitRs when set', () => {
    const caps = protectionDayCapsFromExtras(
      { dayLossCapRs: 2500, dayBankQuitRs: 1000 },
      'nifty',
    );
    expect(caps.dayStopPts).toBe(Math.round(2500 / 65));
    expect(caps.dayProfitLockPts).toBe(Math.round(1000 / 65));
  });

  it('ignores stocks channel', () => {
    expect(protectionDayCapsFromExtras(PROTECTION_DNA_EXTRAS, 'stocks')).toEqual({});
  });

  it('uses researched ₹/pt scales', () => {
    expect(indexRsPerPoint('nifty')).toBe(65);
    expect(indexRsPerPoint('bank')).toBe(30);
  });
});
