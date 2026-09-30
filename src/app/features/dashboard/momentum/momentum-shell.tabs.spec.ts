import { describe, expect, it } from 'vitest';
import { MOMENTUM_TABS, visibleMomentumTabs } from './momentum-shell.component';

describe('momentum tab gating', () => {
  it('lists every section when a broker is configured', () => {
    const tabs = visibleMomentumTabs(true);
    expect(tabs.map((t) => t.path)).toEqual(MOMENTUM_TABS.map((t) => t.path));
    expect(tabs.some((t) => t.path === 'live-trading')).toBe(true);
  });

  it('hides Live Trading until a broker session exists', () => {
    const tabs = visibleMomentumTabs(false);
    expect(tabs.some((t) => t.path === 'live-trading')).toBe(false);
    expect(tabs.map((t) => t.path)).toContain('dashboard');
    expect(tabs.map((t) => t.path)).toContain('paper-trading');
    expect(tabs.map((t) => t.path)).toContain('settings');
  });
});
