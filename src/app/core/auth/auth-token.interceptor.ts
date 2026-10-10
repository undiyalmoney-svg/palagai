import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

/** Attach site or admin Bearer token for Order-API auth/momentum/pnl/vault calls. */
export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const url = req.url;
  const needsAdmin =
    url.includes('/api/auth/admin/') ||
    url.includes('/api/auth/vault') ||
    url.includes('/api/pnl');
  const needsSite =
    url.includes('/api/auth/me') ||
    url.includes('/api/momentum') ||
    url.includes('/api/research');

  if (needsAdmin) {
    const t = auth.getAdminToken();
    if (t && !url.includes('/api/auth/admin/login')) {
      return next(
        req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }),
      );
    }
  }

  if (needsSite) {
    const t = auth.getToken();
    if (t) {
      return next(
        req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }),
      );
    }
  }

  return next(req);
};
