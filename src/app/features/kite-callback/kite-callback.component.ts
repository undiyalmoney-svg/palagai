import { Component, PLATFORM_ID, afterNextRender, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import {
  captureKiteRequestTokenFromLocation,
  peekKiteRequestToken,
  stashKiteRequestToken,
} from '../../core/kite/kite-request-token.util';

/**
 * Public Kite OAuth landing (no auth guard).
 * Always finishes on Get Token when a request_token is present — never /login.
 * (Login was killing Devil's OAuth: SSR + consume race bounced mid-flow.)
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

    // Rehydrate Devil/customer from localStorage before entering the authed tree.
    this.auth.ensureHydratedFromStorage();

    const pending = peekKiteRequestToken();
    if (!pending) {
      this.message = 'No Kite code found. Opening Get Token…';
      void this.router.navigateByUrl('/dashboard/get-token');
      return;
    }

    // Keep request_token in the URL so Get Token guards/SSR cannot miss it.
    this.message = 'Kite code saved. Opening Get Token…';
    void this.router.navigateByUrl(
      `/dashboard/get-token?request_token=${encodeURIComponent(pending)}`,
    );
  }
}
