import { describe, expect, it } from 'vitest';
import { resolveExitSellQty } from './live-exit-guard.util';

describe('resolveExitSellQty', () => {
  it('skips when broker already flat (prevents naked short)', () => {
    expect(resolveExitSellQty(0, 65)).toBeNull();
    expect(resolveExitSellQty(-65, 65)).toBeNull();
  });

  it('sells only up to broker long qty', () => {
    expect(resolveExitSellQty(65, 65)).toBe(65);
    expect(resolveExitSellQty(65, 130)).toBe(65);
    expect(resolveExitSellQty(30, 65)).toBe(30);
  });

  it('skips when planned qty is zero', () => {
    expect(resolveExitSellQty(65, 0)).toBeNull();
  });
});
