/**
 * Telling "your Kite login died" apart from "that request failed".
 *
 * Kite access tokens expire every day around 06:00 IST and this app has no
 * refresh flow — no stored api_secret, no TOTP, no scheduled re-login — so
 * anything that polls Kite will start failing once a day until the user runs
 * the Get Token flow again. Callers need to say that plainly rather than
 * surfacing a raw API error.
 *
 * Kite reports it as `TokenException` / "Incorrect `api_key` or
 * `access_token`", usually on HTTP 403.
 *
 * Deliberately free of Angular imports so it stays unit testable: the error
 * status is read structurally rather than through `instanceof
 * HttpErrorResponse`, which also means it works on a plain fetch error.
 */

const AUTH_PATTERN =
  /TokenException|access[_ ]?token|api[_ ]?key|invalid token|token expired|session expired/i;

export function isKiteAuthError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (status === 401 || status === 403) {
    return true;
  }
  return AUTH_PATTERN.test(errorText(error));
}

/** Message text of the shapes this predicate actually receives. */
function errorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || '';
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error_type', 'error']) {
      const value = record[key];
      if (typeof value === 'string' && value) {
        return value;
      }
      // Kite nests the payload one level down on HTTP errors.
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>)['message'];
        if (typeof nested === 'string' && nested) {
          return nested;
        }
      }
    }
  }
  return '';
}
