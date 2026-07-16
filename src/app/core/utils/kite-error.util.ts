import { HttpErrorResponse } from '@angular/common/http';
import { Timeframe } from '../models/candle.model';

interface KiteErrorBody {
  status?: string;
  message?: unknown;
  error_type?: unknown;
  error?: unknown;
}

/** Always return a readable string — never "[object Object]". */
export function toErrorText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    const msg = value.message?.trim();
    if (msg && msg !== '[object Object]') {
      return msg;
    }
    return value.name || 'Error';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error_type', 'error', 'detail', 'statusText']) {
      const nested = toErrorText(record[key]);
      if (nested && nested !== '[object Object]') {
        return nested;
      }
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== '{}' && json !== 'null') {
        return json.length > 280 ? `${json.slice(0, 280)}…` : json;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

export function extractKiteApiError(error: unknown, context: string): string {
  if (error instanceof HttpErrorResponse) {
    const bodyText = toErrorText(error.error);
    if (bodyText) {
      if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|proxy error|EPERM/i.test(bodyText)) {
        return `Kite API (${context}): cannot reach api.kite.trade — check internet / VPN / DNS.`;
      }
      if (bodyText !== '[object Object]') {
        return `Kite API (${context}): ${bodyText}`;
      }
    }

    if (error.status === 0) {
      return `Kite API (${context}): network error — check internet and that the Angular proxy is running.`;
    }
    if (error.status >= 500) {
      return `Kite API (${context}): proxy/server error (HTTP ${error.status}) — cannot reach Kite (often DNS/offline).`;
    }
    if (error.statusText && error.statusText !== 'Unknown Error') {
      return `Kite API (${context}): HTTP ${error.status} ${error.statusText}`;
    }
    return `Kite API (${context}): HTTP ${error.status}`;
  }

  const text = toErrorText(error);
  if (text) {
    if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|Failed to fetch|NetworkError|EPERM/i.test(text)) {
      return `Kite API (${context}): cannot reach Kite — check internet connection.`;
    }
    if (text !== '[object Object]') {
      return text.includes('Kite API') ? text : `Kite API (${context}): ${text}`;
    }
  }

  return `Kite API (${context}): request failed.`;
}

/** Turn any thrown value into a user-visible message (never "[object Object]"). */
export function formatUnknownError(error: unknown, context?: string): string {
  if (error instanceof HttpErrorResponse) {
    return extractKiteApiError(error, context ?? 'request');
  }

  const text = toErrorText(error);
  if (text && text !== '[object Object]') {
    return context && !text.startsWith(context) ? `${context}: ${text}` : text;
  }

  return context ? `${context}: request failed.` : 'Request failed.';
}

/** Kite often returns HTTP 200 with { status: 'error', message: '...' }. */
export function assertKiteResponseSuccess(response: unknown, context: string): void {
  const parsed = response as KiteErrorBody;
  if (parsed?.status === 'error') {
    const detail =
      toErrorText(parsed.message) ||
      toErrorText(parsed.error_type) ||
      `Kite API (${context}): request failed.`;
    throw new Error(detail);
  }
}

export function assertKiteHistoricalSuccess(
  response: unknown,
  timeframe: Timeframe,
): void {
  const parsed = response as KiteErrorBody;
  if (parsed?.status === 'error') {
    const detail =
      toErrorText(parsed.message) ||
      `Kite API (${timeframe}): historical data request failed.`;
    throw new Error(detail);
  }
}
