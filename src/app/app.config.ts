import {
  APP_INITIALIZER,
  ApplicationConfig,
  PLATFORM_ID,
  inject,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';
import { KiteSessionService } from './core/kite/kite-session.service';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideAnimations(),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const platformId = inject(PLATFORM_ID);
        const kiteSession = inject(KiteSessionService);
        const dev = (environment as {
          devKiteSession?: { apiKey: string; accessToken: string };
        }).devKiteSession;

        return () => {
          if (!isPlatformBrowser(platformId) || !dev?.apiKey?.trim() || !dev?.accessToken?.trim()) {
            return;
          }
          if (kiteSession.hasSession()) {
            return;
          }
          kiteSession.saveManualAccessToken({
            apiKey: dev.apiKey.trim(),
            accessToken: dev.accessToken.trim(),
            userId: 'dev',
          });
        };
      },
    },
  ],
};
