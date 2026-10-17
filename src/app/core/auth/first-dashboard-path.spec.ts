import { describe, expect, it } from 'vitest';
import { SiteModule } from './auth.constants';
import { firstDashboardPath, firstDashboardPathFor } from './auth.guard';
import { AuthService } from './auth.service';

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

  it('opens Charts when only auto is granted', () => {
    expect(firstDashboardPathFor(has('auto'))).toBe('/dashboard/charts');
  });

  it('opens Charts for a public viewer even if other modules exist on the token', () => {
    const auth = {
      isPublic: () => true,
      hasModule: () => true,
    } as Pick<AuthService, 'isPublic' | 'hasModule'>;
    expect(firstDashboardPath(auth as AuthService)).toBe('/dashboard/charts');
  });
});
