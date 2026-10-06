import { describe, expect, it } from 'vitest';
import { MOMENTUM_TABS, visibleMomentumTabs } from './momentum-shell.component';

describe('momentum tab gating', () => {
  it('shows buy and sell suggestions with no Paper or Live tabs', () => {
    expect(MOMENTUM_TABS.map((t) => t.path)).toEqual([]);
    expect(visibleMomentumTabs(false).map((t) => t.path)).toEqual([]);
    expect(visibleMomentumTabs(true).map((t) => t.path)).toEqual([]);
  });
});
