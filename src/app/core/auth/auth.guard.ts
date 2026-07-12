import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import {
  captureKiteRequestTokenFromLocation,
  peekKiteRequestToken,
  stashKiteRequestToken,
} from '../kite/kite-request-token.util';

export const authGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const queryToken = route.queryParamMap.get('request_token');
  if (queryToken) {
    stashKiteRequestToken(queryToken);
  } else {
    captureKiteRequestTokenFromLocation();
  }

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const queryToken = route.queryParamMap.get('request_token');
  if (queryToken) {
    stashKiteRequestToken(queryToken);
  } else {
    captureKiteRequestTokenFromLocation();
  }

  if (!authService.isAuthenticated()) {
    return true;
  }

  if (peekKiteRequestToken()) {
    return router.createUrlTree(['/dashboard/get-token']);
  }

  return router.createUrlTree(['/dashboard']);
};
