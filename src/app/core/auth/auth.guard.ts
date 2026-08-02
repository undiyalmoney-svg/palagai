import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { SiteModule } from './auth.constants';
import {
  hasPendingKiteOAuth,
  peekKiteRequestToken,
  stashKiteRequestToken,
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
  stateUrl: string,
  urlToken: string | null,
): boolean {
  authService.ensureHydratedFromStorage();

  // Kite OAuth return — never bounce this page to /login.
  if (urlToken) {
    return true;
  }

  if (authService.isAuthenticated() || !!authService.getToken()) {
    authService.ensureHydratedFromStorage();
    return true;
  }

  if (hasPendingKiteOAuth(stateUrl) || !!peekKiteRequestToken()) {
    return true;
  }

  return false;
}

function isGetTokenUrl(url: string, routePath?: string | null): boolean {
  return (
    url.includes('/dashboard/get-token') ||
    url.includes('get-token') ||
    routePath === 'get-token'
  );
}

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // state.url sometimes drops query under Vercel SSR — also read the route snapshot.
  const fromState = stashKiteRequestTokenFromUrl(state.url);
  const fromRoute =
    route.queryParamMap.get('request_token')?.trim() ||
    route.firstChild?.queryParamMap.get('request_token')?.trim() ||
    null;
  if (fromRoute) {
    stashKiteRequestToken(fromRoute);
  }
  const token = fromState || fromRoute;

  authService.ensureHydratedFromStorage();

  const childPath = route.firstChild?.routeConfig?.path ?? null;
  if (isGetTokenUrl(state.url, childPath)) {
    if (allowGetTokenDuringKiteOAuth(authService, state.url, token)) {
      return true;
    }
  }

  if (token) {
    return router.parseUrl(`/kite-callback?request_token=${encodeURIComponent(token)}`);
  }

  if (authService.isAuthenticated() || !!authService.getToken()) {
    authService.ensureHydratedFromStorage();
    if (authService.isAuthenticated()) {
      return true;
    }
  }

  if (hasPendingKiteOAuth(state.url) || !!peekKiteRequestToken()) {
    return router.parseUrl('/dashboard/get-token');
  }

  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  auth.ensureHydratedFromStorage();

  // Bad redirect / edge bounce sometimes lands on /login?request_token=…
  const queryToken = route.queryParamMap.get('request_token')?.trim();
  if (queryToken) {
    stashKiteRequestToken(queryToken);
    return router.parseUrl(
      `/kite-callback?request_token=${encodeURIComponent(queryToken)}`,
    );
  }

  // If Devil/customer is signed in and Kite just returned, don't trap on login.
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
  return (route, state): boolean | UrlTree => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const fromState = stashKiteRequestTokenFromUrl(state.url);
    const fromRoute =
      route.queryParamMap.get('request_token')?.trim() ||
      route.parent?.queryParamMap.get('request_token')?.trim() ||
      null;
    if (fromRoute) {
      stashKiteRequestToken(fromRoute);
    }
    const token = fromState || fromRoute;

    auth.ensureHydratedFromStorage();

    if (mod === 'token') {
      if (allowGetTokenDuringKiteOAuth(auth, state.url, token)) {
        return true;
      }
    }

    if (token) {
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
