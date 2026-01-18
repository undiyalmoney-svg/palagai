import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideQuillConfig } from 'ngx-quill';
import { provideServiceWorker } from '@angular/service-worker';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withRouterConfig({
        onSameUrlNavigation: 'reload',
        paramsInheritanceStrategy: 'always'
      })
    ),
    provideClientHydration(withEventReplay()),
    provideAnimations(),
    provideQuillConfig({
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'font': ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'] }],
          [{ 'size': ['small', false, 'large', 'huge'] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'align': [] }],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
          ['blockquote', 'code-block'],
          ['link'],
          ['clean']
        ]
      },
      formats: [
        'bold', 'italic', 'underline', 'strike', 'blockquote', 'code-block',
        'header', 'list', 'script', 'indent', 'direction', 'size', 'color', 'background',
        'font', 'align', 'link'
      ]
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
