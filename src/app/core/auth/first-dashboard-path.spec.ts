import { describe, expect, it } from 'vitest';
import { SiteModule } from './auth.constants';
import {
  firstDashboardPath,
  firstDashboardPathFor,
  safeDashboardReturnUrl,
} from './auth.guard';
import { AuthService } from './auth.service';

describe('firstDashboardPathFor', () => {
  const has = (...mods: SiteModule[]) => (m: SiteModule) => mods.includes(m);

  it('opens Token when that module is granted', () => {
    expect(firstDashboardPathFor(has('token', 'backtest', 'test'))).toBe('/dashboard/get-token');
  });

  it('falls through to Historical Backtest when Token is not granted', () => {
    expect(firstDashboardPathFor(has('backtest', 'test'))).toBe('/dashboard/historical-backtest');
  });

  it('lands on Home when no desk module is granted', () => {
    expect(firstDashboardPathFor(has())).toBe('/dashboard/home');
  });

  it('opens Test when only test is granted', () => {
    expect(firstDashboardPathFor(has('test'))).toBe('/dashboard/order-test');
  });

  it('sends a public viewer to login', () => {
    const auth = {
      isPublic: () => true,
      hasModule: () => true,
    } as Pick<AuthService, 'isPublic' | 'hasModule'>;
    expect(firstDashboardPath(auth as AuthService)).toBe('/login');
  });
});

describe('safeDashboardReturnUrl', () => {
  it('keeps Historical Backtest after a login bounce', () => {
    expect(safeDashboardReturnUrl('/dashboard/historical-backtest')).toBe(
      '/dashboard/historical-backtest',
    );
    expect(safeDashboardReturnUrl('/dashboard/historical-backtest?x=1')).toBe(
      '/dashboard/historical-backtest',
    );
  });

  it('rejects open redirects and non-desk paths', () => {
    expect(safeDashboardReturnUrl('/login')).toBeNull();
    expect(safeDashboardReturnUrl('https://evil.example/dashboard/historical-backtest')).toBeNull();
    expect(safeDashboardReturnUrl('//evil.example')).toBeNull();
    expect(safeDashboardReturnUrl('')).toBeNull();
  });
});
