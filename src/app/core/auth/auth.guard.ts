import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { SiteModule } from './auth.constants';
import { stashKiteRequestTokenFromUrl } from '../kite/kite-request-token.util';

const MODULE_HOME: Array<{ module: SiteModule; path: string }> = [
  { module: 'trade', path: '/dashboard/trade-desk' },
  { module: 'strat', path: '/dashboard/strategy-manager' },
  { module: 'crude', path: '/dashboard/crude-oil' },
  { module: 'auto', path: '/dashboard/auto-trader' },
  { module: 'test', path: '/dashboard/order-test' },
  { module: 'token', path: '/dashboard/get-token' },
];

/** First desk the user is allowed to open. */
export function firstDashboardPath(auth: AuthService): string {
  for (const row of MODULE_HOME) {
    if (auth.hasModule(row.module)) {
      return row.path;
    }
  }
  return '/dashboard/home';
}

export const authGuard: CanActivateFn = (_route, state) => {
  const token = stashKiteRequestTokenFromUrl(state.url);
  const authService = inject(AuthService);
  const router = inject(Router);

  // After full-page Kite return, rehydrate from localStorage before deciding.
  authService.ensureHydratedFromStorage();

  // Peel unauthenticated OAuth onto public /kite-callback.
  // If already signed in, stay on Get Token (request_token already stashed).
  if (token && state.url.includes('/dashboard/get-token')) {
    if (authService.isAuthenticated()) {
      return true;
    }
    return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(token)}`);
  }

  if (authService.isAuthenticated()) {
    return true;
  }

  // Pending Kite code in localStorage + site token → hydrate again and allow Get Token.
  if (state.url.includes('/dashboard/get-token') && authService.getToken()) {
    if (authService.ensureHydratedFromStorage()) {
      return true;
    }
  }

  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  // Always allow /login so a customer can sign in even if Devil's session is still on this browser.
  return true;
};

export const dashboardIndexGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  return router.parseUrl(firstDashboardPath(auth));
};

export const moduleGuard = (mod: SiteModule): CanActivateFn => {
  return (_route, state): boolean | UrlTree => {
    const token = stashKiteRequestTokenFromUrl(state.url);
    const auth = inject(AuthService);
    const router = inject(Router);

    auth.ensureHydratedFromStorage();

    if (token && state.url.includes('/dashboard/get-token')) {
      if (auth.isAuthenticated()) {
        // fall through to module check
      } else {
        return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(token)}`);
      }
    }

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login']);
    }
    if (auth.hasModule(mod)) {
      return true;
    }
    // Never bounce to /dashboard (that re-enters trade-desk and loops blank).
    return router.parseUrl(firstDashboardPath(auth));
  };
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdminSession()) {
    return true;
  }
  return router.createUrlTree(['/admin/login']);
};
