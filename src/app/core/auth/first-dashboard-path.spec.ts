import { describe, expect, it } from 'vitest';
import { SiteModule } from './auth.constants';
import { firstDashboardPathFor } from './auth.guard';

describe('firstDashboardPathFor', () => {
  const has = (...mods: SiteModule[]) => (m: SiteModule) => mods.includes(m);

  it('opens Momentum when that module is granted', () => {
    expect(firstDashboardPathFor(has('momentum', 'auto', 'token'))).toBe('/dashboard/momentum');
  });

  it('falls through to Charts when Momentum is not granted', () => {
    expect(firstDashboardPathFor(has('auto', 'token'))).toBe('/dashboard/charts');
  });

  it('lands on Home when no desk module is granted', () => {
    expect(firstDashboardPathFor(has())).toBe('/dashboard/home');
  });
});
