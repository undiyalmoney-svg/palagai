import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { captureKiteRequestTokenFromLocation } from './app/core/kite/kite-request-token.util';

captureKiteRequestTokenFromLocation();

bootstrapApplication(App, appConfig)
  .catch((err) => {
    console.error('Error bootstrapping application:', err);
  });
