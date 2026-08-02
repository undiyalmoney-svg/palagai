const PENDING_REQUEST_TOKEN_KEY = 'palagai_pending_kite_request_token';

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

/** Persist Kite request_token across SSR → /login bounces (sessionStorage + cookie). */
export function stashKiteRequestToken(token: string | null | undefined): void {
  const trimmed = token?.trim();
  if (!trimmed) {
    return;
  }
  if (canUseSessionStorage()) {
    sessionStorage.setItem(PENDING_REQUEST_TOKEN_KEY, trimmed);
  }
  writeCookie(PENDING_REQUEST_TOKEN_KEY, trimmed, 900);
}

export function consumeKiteRequestToken(): string | null {
  let token = '';
  if (canUseSessionStorage()) {
    token = sessionStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
    sessionStorage.removeItem(PENDING_REQUEST_TOKEN_KEY);
  }
  if (!token) {
    token = readCookie(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
  }
  clearCookie(PENDING_REQUEST_TOKEN_KEY);
  return token || null;
}

export function peekKiteRequestToken(): string | null {
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
    const fromCookie = readCookie(PENDING_REQUEST_TOKEN_KEY)?.trim() || null;
    if (fromCookie) {
      stashKiteRequestToken(fromCookie);
    }
    return fromCookie;
  } catch {
    return null;
  }
}
