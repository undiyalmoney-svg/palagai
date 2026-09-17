import { describe, expect, it } from 'vitest';
import { isKiteAuthError } from './kite-auth-error.util';

describe('isKiteAuthError', () => {
  it('recognises Kite rejecting the token', () => {
    expect(isKiteAuthError(new Error('Incorrect `api_key` or `access_token`.'))).toBe(true);
    expect(isKiteAuthError(new Error('TokenException'))).toBe(true);
    expect(isKiteAuthError(new Error('Kite API (15m): session expired'))).toBe(true);
  });

  it('recognises a missing local session', () => {
    expect(isKiteAuthError(new Error('Kite access token required. Connect in the Token tab.'))).toBe(
      true,
    );
  });

  it('treats 401 and 403 as auth failures whatever the body says', () => {
    // Shape of an HttpErrorResponse, read structurally so this stays testable.
    for (const status of [401, 403]) {
      expect(isKiteAuthError({ status, error: 'nope' })).toBe(true);
    }
  });

  it('reads the message Kite nests under the error body', () => {
    expect(isKiteAuthError({ status: 400, error: { message: 'TokenException' } })).toBe(true);
  });

  it('does not mistake ordinary failures for auth failures', () => {
    expect(isKiteAuthError(new Error('Kite API (15m): no candles returned'))).toBe(false);
    expect(isKiteAuthError(new Error('cannot reach api.kite.trade — check internet'))).toBe(false);
    expect(
      isKiteAuthError(new Error('No CRUDEOILM futures contract in the instrument list.')),
    ).toBe(false);
    expect(isKiteAuthError({ status: 500, error: 'boom' })).toBe(false);
    expect(isKiteAuthError(null)).toBe(false);
    expect(isKiteAuthError(undefined)).toBe(false);
  });
});
