import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import {
  captureKiteRequestTokenFromLocation,
  peekKiteRequestToken,
  stashKiteRequestToken,
} from '../kite/kite-request-token.util';

function stashTokenFromRoute(route: { queryParamMap: { get(name: string): string | null } }): void {
  const queryToken = route.queryParamMap.get('request_token');
  if (queryToken) {
    stashKiteRequestToken(queryToken);
  } else {
    captureKiteRequestTokenFromLocation();
  }
}

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  stashTokenFromRoute(route);

  // Allow Kite OAuth return URL without app login so live redirect works.
  if (state.url.startsWith('/dashboard/get-token')) {
    return true;
  }

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  stashTokenFromRoute(route);

  if (!authService.isAuthenticated()) {
    return true;
  }

  if (peekKiteRequestToken()) {
    return router.createUrlTree(['/dashboard/get-token']);
  }

  return router.createUrlTree(['/dashboard']);
};
