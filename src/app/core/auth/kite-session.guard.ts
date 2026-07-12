import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { KiteSessionService } from '../kite/kite-session.service';

function isSessionExpired(savedAt: string): boolean {
  const saved = new Date(savedAt);
  const now = new Date();
  const expiry = new Date(saved);
  expiry.setHours(6, 0, 0, 0);
  if (expiry <= saved) {
    expiry.setDate(expiry.getDate() + 1);
  }
  return now >= expiry;
}

export const kiteSessionGuard: CanActivateFn = (route) => {
  const kiteSession = inject(KiteSessionService);
  const router = inject(Router);
  const session = kiteSession.getSession();

  if (route.routeConfig?.path === 'get-token') {
    return true;
  }

  if (!session) {
    return router.createUrlTree(['/dashboard/get-token']);
  }

  if (isSessionExpired(session.savedAt)) {
    kiteSession.clearSession();
    return router.createUrlTree(['/dashboard/get-token']);
  }

  return true;
};
