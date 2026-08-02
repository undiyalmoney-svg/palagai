import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { SiteModule } from './auth.constants';
import {
  hasPendingKiteOAuth,
  peekKiteRequestToken,
  stashKiteRequestTokenFromUrl,
} from '../kite/kite-request-token.util';

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

function allowGetTokenDuringKiteOAuth(
  authService: AuthService,
  router: Router,
  stateUrl: string,
  urlToken: string | null,
): boolean | UrlTree {
  authService.ensureHydratedFromStorage();

  // Legacy Kite redirect URL still hits /dashboard/get-token?request_token=
  if (urlToken && stateUrl.includes('/dashboard/get-token')) {
    if (authService.isAuthenticated() || !!authService.getToken()) {
      authService.ensureHydratedFromStorage();
      return true;
    }
    // Public peel — client callback then returns to Get Token (never /login).
    return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(urlToken)}`);
  }

  if (!stateUrl.includes('/dashboard/get-token')) {
    return false;
  }

  // Get Token during/after OAuth: allow when site session exists in localStorage
  // even if SSR left auth signals false.
  if (authService.isAuthenticated() || !!authService.getToken()) {
    authService.ensureHydratedFromStorage();
    return true;
  }

  // Pending kite code in cookie/storage — allow Get Token shell; page hydrates auth.
  if (hasPendingKiteOAuth(stateUrl) || !!peekKiteRequestToken()) {
    return true;
  }

  return false;
}

export const authGuard: CanActivateFn = (_route, state) => {
  const token = stashKiteRequestTokenFromUrl(state.url);
  const authService = inject(AuthService);
  const router = inject(Router);

  authService.ensureHydratedFromStorage();

  const getTokenGate = allowGetTokenDuringKiteOAuth(
    authService,
    router,
    state.url,
    token,
  );
  if (getTokenGate !== false) {
    return getTokenGate;
  }

  // Any other dashboard URL with a live request_token → public callback (not login).
  if (token) {
    return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(token)}`);
  }

  if (authService.isAuthenticated() || !!authService.getToken()) {
    authService.ensureHydratedFromStorage();
    if (authService.isAuthenticated()) {
      return true;
    }
  }

  // Pending OAuth but landed elsewhere → force Get Token, never login.
  if (hasPendingKiteOAuth(state.url) || !!peekKiteRequestToken()) {
    return router.parseUrl('/dashboard/get-token');
  }

  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  auth.ensureHydratedFromStorage();
  // If Devil is signed in and Kite just returned, don't trap on login.
  if (
    (auth.isAuthenticated() || !!auth.getToken()) &&
    (hasPendingKiteOAuth() || !!peekKiteRequestToken())
  ) {
    return router.parseUrl('/dashboard/get-token');
  }
  return true;
};

export const dashboardIndexGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  auth.ensureHydratedFromStorage();
  if (hasPendingKiteOAuth() || !!peekKiteRequestToken()) {
    return router.parseUrl('/dashboard/get-token');
  }
  if (!auth.isAuthenticated() && !auth.getToken()) {
    return router.createUrlTree(['/login']);
  }
  auth.ensureHydratedFromStorage();
  return router.parseUrl(firstDashboardPath(auth));
};

export const moduleGuard = (mod: SiteModule): CanActivateFn => {
  return (_route, state): boolean | UrlTree => {
    const token = stashKiteRequestTokenFromUrl(state.url);
    const auth = inject(AuthService);
    const router = inject(Router);

    auth.ensureHydratedFromStorage();

    if (mod === 'token') {
      const gate = allowGetTokenDuringKiteOAuth(auth, router, state.url, token);
      if (gate !== false) {
        // Authenticated path still needs module; pending-oauth allow is enough.
        if (gate === true) {
          if (!auth.isAuthenticated() && !auth.getToken()) {
            return true; // pending kite — show Get Token
          }
          auth.ensureHydratedFromStorage();
          if (auth.hasModule('token') || auth.isDevil()) {
            return true;
          }
          // Has session but no token module — still allow during pending kite.
          if (hasPendingKiteOAuth(state.url) || !!peekKiteRequestToken()) {
            return true;
          }
        }
        return gate;
      }
    }

    if (token && state.url.includes('/dashboard/get-token')) {
      return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(token)}`);
    }

    if (!auth.isAuthenticated()) {
      if (auth.getToken() && auth.ensureHydratedFromStorage()) {
        // continue
      } else if (hasPendingKiteOAuth(state.url) || !!peekKiteRequestToken()) {
        return router.parseUrl('/dashboard/get-token');
      } else {
        return router.createUrlTree(['/login']);
      }
    }
    if (auth.hasModule(mod)) {
      return true;
    }
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
