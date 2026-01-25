// Suppress Node.js deprecation warnings
process.removeAllListeners('warning');
const originalEmitWarning = process.emitWarning.bind(process);
(process as any).emitWarning = function(warning: string | Error, options?: NodeJS.EmitWarningOptions) {
  if (warning && typeof warning === 'object' && 'name' in warning && warning.name === 'DeprecationWarning') {
    // Suppress url.parse() deprecation warnings
    if ('message' in warning && typeof warning.message === 'string' && warning.message.includes('url.parse()')) {
      return;
    }
  }
  return originalEmitWarning(warning, options);
};

import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(App, config, context);

export default bootstrap;
