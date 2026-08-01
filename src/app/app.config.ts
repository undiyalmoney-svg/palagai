import {
  APP_INITIALIZER,
  ApplicationConfig,
  PLATFORM_ID,
  inject,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { KiteSessionService } from './core/kite/kite-session.service';
import { AuthService } from './core/auth/auth.service';
import { authTokenInterceptor } from './core/auth/auth-token.interceptor';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([authTokenInterceptor])),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Event replay was swallowing nav clicks after hydration — keep hydration plain.
    provideClientHydration(),
    provideAnimations(),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const platformId = inject(PLATFORM_ID);
        const kiteSession = inject(KiteSessionService);
        const auth = inject(AuthService);
        const dev = (environment as {
          devKiteSession?: { apiKey: string; accessToken: string };
        }).devKiteSession;

        return () => {
          if (!isPlatformBrowser(platformId) || !dev?.apiKey?.trim() || !dev?.accessToken?.trim()) {
            return;
          }
          // Never inject shared dev Kite into a customer session.
          if (!auth.isDevil()) {
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
