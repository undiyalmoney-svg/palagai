/** Survives Palagai login bounce after Kite OAuth redirect. */
const PENDING_REQUEST_TOKEN_KEY = 'palagai_pending_kite_request_token';

/** Last Palagai username that owned the Kite access token. */
export const KITE_BOUND_USERNAME_KEY = 'palagai_kite_username';

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  try {
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const [rawKey, ...rest] = part.trim().split('=');
      if (rawKey === name) {
        return decodeURIComponent(rest.join('=').trim());
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

/** Persist Kite request_token across /login bounce (localStorage + session + cookie). */
export function stashKiteRequestToken(token: string | null | undefined): void {
  const trimmed = token?.trim();
  if (!trimmed) {
    return;
  }
  if (canUseLocalStorage()) {
    localStorage.setItem(PENDING_REQUEST_TOKEN_KEY, trimmed);
  }
  if (canUseSessionStorage()) {
    sessionStorage.setItem(PENDING_REQUEST_TOKEN_KEY, trimmed);
  }
  writeCookie(PENDING_REQUEST_TOKEN_KEY, trimmed, 900);
}

/** Drop pending request_token only (e.g. before a fresh Kite Redirect). */
export function clearPendingKiteRequestToken(): void {
  if (canUseLocalStorage()) {
    localStorage.removeItem(PENDING_REQUEST_TOKEN_KEY);
  }
  if (canUseSessionStorage()) {
    sessionStorage.removeItem(PENDING_REQUEST_TOKEN_KEY);
  }
  clearCookie(PENDING_REQUEST_TOKEN_KEY);
}

export function consumeKiteRequestToken(): string | null {
  let token = '';
  if (canUseLocalStorage()) {
    token = localStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
  }
  if (!token && canUseSessionStorage()) {
    token = sessionStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
  }
  if (!token) {
    token = readCookie(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
  }
  clearPendingKiteRequestToken();
  return token || null;
}

export function peekKiteRequestToken(): string | null {
  if (canUseLocalStorage()) {
    const fromLocal = localStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim();
    if (fromLocal) {
      return fromLocal;
    }
  }
  if (canUseSessionStorage()) {
    const fromSession = sessionStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim();
    if (fromSession) {
      return fromSession;
    }
  }
  return readCookie(PENDING_REQUEST_TOKEN_KEY)?.trim() || null;
}

/** Stash request_token from a router URL (e.g. /dashboard/get-token?request_token=…). */
export function stashKiteRequestTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const qIndex = url.indexOf('?');
    if (qIndex < 0) {
      return null;
    }
    const token = new URLSearchParams(url.slice(qIndex)).get('request_token')?.trim() || null;
    if (token) {
      stashKiteRequestToken(token);
    }
    return token;
  } catch {
    return null;
  }
}

/** Capture request_token from the current URL / cookie before Angular routing drops it. */
export function captureKiteRequestTokenFromLocation(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('request_token')?.trim() || null;
    if (fromQuery) {
      stashKiteRequestToken(fromQuery);
      return fromQuery;
    }
    const fromLocal = canUseLocalStorage()
      ? localStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() || null
      : null;
    if (fromLocal) {
      stashKiteRequestToken(fromLocal);
      return fromLocal;
    }
    const fromCookie = readCookie(PENDING_REQUEST_TOKEN_KEY)?.trim() || null;
    if (fromCookie) {
      stashKiteRequestToken(fromCookie);
    }
    return fromCookie;
  } catch {
    return null;
  }
}

export function getKiteBoundUsername(): string | null {
  if (!canUseLocalStorage()) return null;
  return localStorage.getItem(KITE_BOUND_USERNAME_KEY)?.trim() || null;
}

export function setKiteBoundUsername(username: string | null | undefined): void {
  if (!canUseLocalStorage()) return;
  const name = String(username || '').trim();
  if (!name) {
    localStorage.removeItem(KITE_BOUND_USERNAME_KEY);
    return;
  }
  localStorage.setItem(KITE_BOUND_USERNAME_KEY, name);
}

export function clearKiteBoundUsername(): void {
  if (!canUseLocalStorage()) return;
  localStorage.removeItem(KITE_BOUND_USERNAME_KEY);
}
