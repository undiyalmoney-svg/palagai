import {
  InstrumentSessionConfig,
  NSE_SESSION,
  resolveSessionConfig,
} from '../../config/session.config';

/** @deprecated Use session config from context or resolveSessionConfig(). */
export const SESSION_CLOSE_CANDLE = NSE_SESSION.sessionCloseCandle;

/** True when string already carries Z / ±HH:MM / ±HHMM. */
function hasExplicitOffset(dateTime: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(dateTime.trim());
}

/**
 * Parse market timestamp. Naive wall-clock strings (no Z/offset) are IST —
 * analyst cache uses `YYYY-MM-DD HH:mm:ss` without +05:30. Treating those as
 * UTC shifted Trap entry window by +5:30 (09:15 → 14:45 → always "after window").
 */
function parseMarketTimestamp(dateTime: string): number {
  const normalized = dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T');
  if (!hasExplicitOffset(normalized)) {
    return new Date(`${normalized}+05:30`).getTime();
  }
  return new Date(normalized).getTime();
}

/** Extract HH:mm in IST regardless of browser timezone or +0530 suffix. */
export function extractHhMm(
  dateTime: string,
  timezone: string = NSE_SESSION.timezone,
): string {
  // Fast path: naive IST wall clock — trust the digits (cache / Testing).
  if (!hasExplicitOffset(dateTime)) {
    const normalized = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
    const part = (normalized.split(/\s+/)[1] ?? '').slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(part)) {
      return part;
    }
  }

  const ts = parseMarketTimestamp(dateTime);
  if (Number.isNaN(ts)) {
    const normalized = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
    return (normalized.split(' ')[1] ?? '').slice(0, 5);
  }

  return new Date(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
}

export function isSessionCloseCandle(
  dateTime: string,
  session: InstrumentSessionConfig = NSE_SESSION,
): boolean {
  return extractHhMm(dateTime, session.timezone) === session.sessionCloseCandle;
}

export function resolveSessionFromContext(ctx?: {
  session?: InstrumentSessionConfig;
  instrumentId?: string;
}): InstrumentSessionConfig {
  if (ctx?.session) {
    return ctx.session;
  }
  return resolveSessionConfig({ instrumentId: ctx?.instrumentId });
}
