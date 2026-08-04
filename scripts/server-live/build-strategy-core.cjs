#!/usr/bin/env node
/**
 * Bundle Angular-free Server Live strategy core for Palagai-Order-API.
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '../..');
const entry = path.join(__dirname, 'bundle-entry.ts');
const outLocal = path.join(__dirname, 'strategy-core.cjs');
const outApi =
  process.env.ORDER_API_STRATEGY_OUT ||
  path.resolve(root, '../Palagai-Order-API/live/strategy-core.cjs');

const angularStub = `
export function Injectable(_opts) {
  return function (target) { return target; };
}
export function inject() { return null; }
export class NgZone {}
`;

const commonStub = `
export class HttpErrorResponse extends Error {
  constructor(init) {
    super((init && init.message) || 'HttpErrorResponse');
    this.status = init && init.status;
    this.error = init && init.error;
  }
}
`;

const rxjsStub = `
export function firstValueFrom(x) { return Promise.resolve(x); }
export class Observable {
  constructor(sub) { this._sub = sub; }
  subscribe(o) { return { unsubscribe() {} }; }
}
`;

async function main() {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outLocal,
    logLevel: 'info',
    plugins: [
      {
        name: 'stub-angular-rxjs',
        setup(build) {
          build.onResolve({ filter: /^@angular\/core$/ }, () => ({
            path: 'angular-core-stub',
            namespace: 'stub',
          }));
          build.onResolve({ filter: /^@angular\/common$/ }, () => ({
            path: 'angular-common-stub',
            namespace: 'stub',
          }));
          build.onResolve({ filter: /^rxjs$/ }, () => ({
            path: 'rxjs-stub',
            namespace: 'stub',
          }));
          build.onResolve({ filter: /^rxjs\/.*/ }, () => ({
            path: 'rxjs-stub',
            namespace: 'stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
            if (args.path === 'angular-core-stub') {
              return { contents: angularStub, loader: 'js' };
            }
            if (args.path === 'angular-common-stub') {
              return { contents: commonStub, loader: 'js' };
            }
            return { contents: rxjsStub, loader: 'js' };
          });
        },
      },
    ],
  });

  console.log('Wrote', outLocal);
  try {
    fs.mkdirSync(path.dirname(outApi), { recursive: true });
    fs.copyFileSync(outLocal, outApi);
    console.log('Wrote', outApi);
  } catch (err) {
    console.warn('Skip Order-API copy (sibling missing):', err.message || err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
