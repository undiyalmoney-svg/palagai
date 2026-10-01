import { describe, expect, it } from 'vitest';
import { MOMENTUM_TABS, visibleMomentumTabs } from './momentum-shell.component';

describe('momentum tab gating', () => {
  it('keeps the desk to Paper, Live and Settings', () => {
    expect(MOMENTUM_TABS.map((t) => t.path)).toEqual(['paper', 'live', 'settings']);
    expect(visibleMomentumTabs(false).map((t) => t.path)).toEqual(['paper', 'live', 'settings']);
    expect(visibleMomentumTabs(true).map((t) => t.path)).toEqual(['paper', 'live', 'settings']);
  });
});
