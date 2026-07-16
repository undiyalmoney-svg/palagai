import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { KiteSessionService } from '../kite/kite-session.service';

/** Seeds a dev Kite session from environment when no session is stored. */
export function bootstrapDevKiteSession(): void {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return;
  }

  const dev = (environment as {
    devKiteSession?: { apiKey: string; accessToken: string };
  }).devKiteSession;

  if (!dev?.apiKey?.trim() || !dev?.accessToken?.trim()) {
    return;
  }

  const kiteSession = inject(KiteSessionService);
  if (kiteSession.hasSession()) {
    return;
  }

  kiteSession.saveManualAccessToken({
    apiKey: dev.apiKey.trim(),
    accessToken: dev.accessToken.trim(),
    userId: 'dev',
  });
}
