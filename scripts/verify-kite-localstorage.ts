/**
 * Standalone proof for Kite localStorage behavior (Devil + customer).
 * Run: npx tsx scripts/verify-kite-localstorage.ts
 */
import '@angular/compiler';
import { JSDOM } from 'jsdom';
import { Injector, PLATFORM_ID } from '@angular/core';
import { KiteSessionService } from '../src/app/core/kite/kite-session.service';
import {
  clearPendingKiteRequestToken,
  consumeKiteRequestToken,
  getKiteBoundUsername,
  peekKiteRequestToken,
  setKiteBoundUsername,
  stashKiteRequestToken,
} from '../src/app/core/kite/kite-request-token.util';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost:4200/',
});
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { localStorage: Storage }).localStorage = dom.window.localStorage;
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = dom.window.sessionStorage;

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  OK  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

function resetStorage(): void {
  localStorage.clear();
  sessionStorage.clear();
}

function makeKite(): KiteSessionService {
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      KiteSessionService,
    ],
  });
  return injector.get(KiteSessionService);
}

console.log('\n=== 1) request_token survives login bounce (localStorage) ===');
resetStorage();
stashKiteRequestToken('req_abc123');
assert(
  localStorage.getItem('palagai_pending_kite_request_token') === 'req_abc123',
  'stash writes palagai_pending_kite_request_token',
);
assert(peekKiteRequestToken() === 'req_abc123', 'peek returns stashed token');
assert(consumeKiteRequestToken() === 'req_abc123', 'consume returns token once');
assert(peekKiteRequestToken() === null, 'consume clears pending token');

resetStorage();
stashKiteRequestToken('old_req');
clearPendingKiteRequestToken();
assert(peekKiteRequestToken() === null, 'Redirect clearPending drops request_token');

console.log('\n=== 2) username binding ===');
resetStorage();
setKiteBoundUsername('Devil');
assert(getKiteBoundUsername() === 'Devil', 'stores palagai_kite_username=Devil');
assert(localStorage.getItem('palagai_kite_username') === 'Devil', 'raw localStorage key present');

console.log('\n=== 3) access token for Devil ===');
resetStorage();
const kite = makeKite();

assert(
  kite.saveFromTokenResponse({
    status: 'success',
    data: { user_id: 'AB', api_key: 'k', access_token: 'tok' },
  }) === false,
  'refuse save when unbound (no silent fake localStorage write)',
);
assert(
  Object.keys(localStorage).filter((k) => k.startsWith('palagai_kite_session')).length === 0,
  'no palagai_kite_session* keys when unbound',
);

const devilId = 'devil-mongo-id-001';
kite.bindSiteUser(devilId);
const saved = kite.saveFromTokenResponse({
  status: 'success',
  data: {
    user_id: 'AB1234',
    api_key: 'kite_key',
    access_token: 'devil_access_token_xyz',
  },
});
assert(saved === true, 'save returns true for Devil after bind');
const devilKey = `palagai_kite_session:${devilId}`;
const raw = localStorage.getItem(devilKey);
assert(!!raw, `localStorage has ${devilKey}`);
const parsed = raw ? JSON.parse(raw) : null;
assert(parsed?.data?.access_token === 'devil_access_token_xyz', 'JSON.data.access_token is set');
assert(parsed?.data?.api_key === 'kite_key', 'JSON.data.api_key is set');
assert(parsed?.siteUserId === devilId, 'JSON.siteUserId matches Devil id');
assert(kite.getSession()?.data.access_token === 'devil_access_token_xyz', 'in-memory session set');

console.log('\n=== 4) customer isolation ===');
kite.detach();
kite.bindSiteUser('customer-id');
kite.saveFromTokenResponse({
  status: 'success',
  data: { user_id: 'C1', api_key: 'k2', access_token: 'customer_tok' },
});
assert(
  JSON.parse(localStorage.getItem(devilKey)!).data.access_token === 'devil_access_token_xyz',
  'Devil key untouched after customer save',
);
assert(
  JSON.parse(localStorage.getItem('palagai_kite_session:customer-id')!).data.access_token ===
    'customer_tok',
  'customer has own scoped key',
);

console.log('\n=== 5) Redirect clearSession ===');
kite.bindSiteUser(devilId);
kite.clearSession();
assert(localStorage.getItem(devilKey) === null, 'clearSession removes Devil access token key');
assert(
  localStorage.getItem('palagai_kite_session:customer-id') !== null,
  'clearSession does not wipe other users',
);

console.log('\n=== 6) username switch clearAllSessions ===');
kite.bindSiteUser(devilId);
kite.saveFromTokenResponse({
  status: 'success',
  data: { user_id: 'D1', api_key: 'k1', access_token: 'd2' },
});
kite.clearAllSessions();
assert(localStorage.getItem(devilKey) === null, 'clearAllSessions removes Devil');
assert(
  localStorage.getItem('palagai_kite_session:customer-id') === null,
  'clearAllSessions removes customer too',
);

console.log('\n=== 7) reload after rebind ===');
kite.bindSiteUser(devilId);
kite.saveFromTokenResponse({
  status: 'success',
  data: { user_id: 'D1', api_key: 'k1', access_token: 'persist_me' },
});
kite.detach();
assert(kite.getSession() === null, 'detach clears memory');
kite.bindSiteUser(devilId);
assert(kite.getSession()?.data.access_token === 'persist_me', 'rebind reloads from localStorage');

console.log('\n=== 8) Get Token exchange path (bind then save — Devil) ===');
resetStorage();
const kite2 = makeKite();
const siteUser = { id: 'devil-real-id', username: 'Devil' };
// Mirrors get-token.component.ts exchange success handler
kite2.bindSiteUser(siteUser.id);
const exchangeOk = kite2.saveFromTokenResponse({
  status: 'success',
  data: {
    user_id: 'ZERODHA1',
    api_key: 'live_key',
    access_token: 'live_access_token',
  },
});
assert(exchangeOk === true, 'exchange path save succeeds when siteUser.id bound');
setKiteBoundUsername(siteUser.username);
assert(
  localStorage.getItem(`palagai_kite_session:${siteUser.id}`) !== null,
  'Devil exchange writes palagai_kite_session:devil-real-id',
);
assert(
  JSON.parse(localStorage.getItem(`palagai_kite_session:${siteUser.id}`)!).data.access_token ===
    'live_access_token',
  'Devil exchange stores live_access_token in JSON',
);
assert(localStorage.getItem('palagai_kite_username') === 'Devil', 'username stored after exchange');

console.log('\n=== 9) different username clears access tokens ===');
const prev = getKiteBoundUsername();
const next = 'CustomerOne';
assert(!!prev && prev.toLowerCase() !== next.toLowerCase(), 'username actually changed');
kite2.clearAllSessions();
setKiteBoundUsername(next);
assert(
  localStorage.getItem(`palagai_kite_session:${siteUser.id}`) === null,
  'access token cleared on username switch',
);
assert(getKiteBoundUsername() === 'CustomerOne', 'new username stored');

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
