import { Component, PLATFORM_ID, afterNextRender, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
} from '../../core/auth/auth.constants';
import {
  captureKiteRequestTokenFromLocation,
  getKiteBoundUsername,
  peekKiteRequestToken,
  stashKiteRequestToken,
} from '../../core/kite/kite-request-token.util';

/**
 * Public Kite OAuth landing (no auth guard).
 * Must use afterNextRender — under SSR, ngOnInit runs on the server and
 * isPlatformBrowser early-return never navigates; hydration won't re-run it.
 */
@Component({
  selector: 'app-kite-callback',
  standalone: true,
  template: `
    <section class="wrap">
      <p class="msg">{{ message }}</p>
    </section>
  `,
  styles: `
    .wrap {
      min-height: 40vh;
      display: grid;
      place-items: center;
      padding: 2rem;
      font-family: Inter, system-ui, sans-serif;
      color: #0f172a;
    }
    .msg {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #334155;
    }
  `,
})
export class KiteCallbackComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected message = 'Connecting Kite…';

  constructor() {
    afterNextRender(() => {
      this.finishKiteRedirect();
    });
  }

  private finishKiteRedirect(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    captureKiteRequestTokenFromLocation();
    const fromQuery = this.route.snapshot.queryParamMap.get('request_token')?.trim();
    if (fromQuery) {
      stashKiteRequestToken(fromQuery);
    }

    const pending = peekKiteRequestToken();
    this.auth.ensureHydratedFromStorage();

    // Always prefer Get Token when Palagai session exists (Devil or customer).
    if (this.hasPalagaiSession()) {
      this.message = pending
        ? 'Kite code saved. Opening Get Token…'
        : 'Opening Get Token…';
      void this.router.navigateByUrl('/dashboard/get-token');
      return;
    }

    if (pending) {
      this.message = 'Sign in to finish linking Kite…';
      void this.router.navigateByUrl('/login');
      return;
    }

    this.message = 'No Kite request_token found. Open Get Token and login to Kite again.';
    void this.router.navigateByUrl('/login');
  }

  /** True when Palagai login is already on this browser. */
  private hasPalagaiSession(): boolean {
    if (this.auth.ensureHydratedFromStorage()) {
      return true;
    }
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    // Direct localStorage fallback (SSR hydrate can leave signals false).
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)?.trim();
      const raw = localStorage.getItem(AUTH_USER_KEY)?.trim();
      if (token && raw) {
        this.auth.ensureHydratedFromStorage();
        return this.auth.isAuthenticated() || !!(getKiteBoundUsername() && token);
      }
    } catch {
      /* ignore */
    }
    const bound = getKiteBoundUsername();
    return !!(bound && this.auth.getToken());
  }
}
