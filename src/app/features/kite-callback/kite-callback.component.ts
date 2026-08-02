import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
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
 * Stashes request_token, then sends the user to Get Token (if signed in) or Login.
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
export class KiteCallbackComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected message = 'Connecting Kite…';

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    captureKiteRequestTokenFromLocation();
    const fromQuery = this.route.snapshot.queryParamMap.get('request_token')?.trim();
    if (fromQuery) {
      stashKiteRequestToken(fromQuery);
    }

    const pending = peekKiteRequestToken();
    if (!pending) {
      this.message = 'No Kite request_token found. Open Get Token and login to Kite again.';
      void this.router.navigateByUrl('/dashboard/get-token');
      return;
    }

    this.message = 'Kite code saved. Finishing…';
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl('/dashboard/get-token');
    } else {
      void this.router.navigateByUrl('/login');
    }
  }
}
