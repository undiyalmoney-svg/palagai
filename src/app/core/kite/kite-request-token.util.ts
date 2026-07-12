const PENDING_REQUEST_TOKEN_KEY = 'palagai_pending_kite_request_token';

export function stashKiteRequestToken(token: string | null | undefined): void {
  const trimmed = token?.trim();
  if (!trimmed || typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(PENDING_REQUEST_TOKEN_KEY, trimmed);
}

export function consumeKiteRequestToken(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const token = sessionStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() ?? '';
  if (!token) {
    return null;
  }
  sessionStorage.removeItem(PENDING_REQUEST_TOKEN_KEY);
  return token;
}

export function peekKiteRequestToken(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage.getItem(PENDING_REQUEST_TOKEN_KEY)?.trim() || null;
}

/** Capture request_token from the current URL (Kite redirect) before Angular routing drops it. */
export function captureKiteRequestTokenFromLocation(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('request_token')?.trim() || null;
    if (token) {
      stashKiteRequestToken(token);
    }
    return token;
  } catch {
    return null;
  }
}
