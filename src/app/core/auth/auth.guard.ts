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
  { module: 'token', path: '/dashboard/get-token' },
  { module: 'backtest', path: '/dashboard/historical-backtest' },
  { module: 'test', path: '/dashboard/order-test' },
];

/** Keep login bounce on the desk the user asked for. Reject anything outside /dashboard/. */
export function safeDashboardReturn(url: string | null | undefined): string | null {
  const path = String(url || '').trim().split('?')[0] || '';
  if (!path.startsWith('/dashboard/')) return null;
  if (path.startsWith('//') || path.includes('://') || path.includes('\\')) return null;
  return path;
}

function loginTree(router: Router, returnUrl?: string): UrlTree {
  const next = safeDashboardReturn(returnUrl);
  if (next) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: next } });
  }
  return router.createUrlTree(['/login']);
}

/** First desk the user is allowed to open. */
export function firstDashboardPathFor(hasModule: (mod: SiteModule) => boolean): string {
  for (const row of MODULE_HOME) {
    if (hasModule(row.module)) {
      return row.path;
    }
  }
  return '/dashboard/home';
}

/** First desk the user is allowed to open. */
export function firstDashboardPath(auth: AuthService): string {
  if (auth.isPublic()) return '/login';
  return firstDashboardPathFor((mod) => auth.hasModule(mod));
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
      if (authService.isPublic()) {
        authService.logout();
        return loginTree(router);
      }
      return true;
    }
  }

  if (hasPendingKiteOAuth(state.url) || !!peekKiteRequestToken()) {
    return router.parseUrl('/dashboard/get-token');
  }

  return loginTree(router, state.url);
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

  if (auth.isPublic()) {
    auth.logout();
    return true;
  }

  // If Devil/customer is signed in and Kite just returned, don't trap on login.
  if (
    (auth.isAuthenticated() || !!auth.getToken()) &&
    (hasPendingKiteOAuth() || !!peekKiteRequestToken())
  ) {
    return router.parseUrl('/dashboard/get-token');
  }

  // Full-page Historical Backtest click SSR-bounces here; localStorage still has the session.
  if (auth.isAuthenticated() || !!auth.getToken()) {
    auth.ensureHydratedFromStorage();
    if (auth.isAuthenticated() && !auth.isPublic()) {
      const dest = safeDashboardReturn(route.queryParamMap.get('returnUrl'));
      if (dest) {
        return router.parseUrl(dest);
      }
    }
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
    return loginTree(router);
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
        return loginTree(router, state.url);
      }
    }
    if (auth.isPublic()) {
      auth.logout();
      return loginTree(router);
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
