import { defineConfig } from 'vite';

// Suppress Node.js deprecation warnings in Vite
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

export default defineConfig({
  ssr: {
    noExternal: [
      /^@angular\/material/,
      /^@angular\/cdk/
    ],
    external: [
      'rxjs',
      'rxjs/operators'
    ]
  },
  optimizeDeps: {
    exclude: [
      'rxjs',
      'rxjs/operators'
    ]
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});

