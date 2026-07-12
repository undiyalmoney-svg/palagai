import { HttpErrorResponse } from '@angular/common/http';
import { Timeframe } from '../models/candle.model';

interface KiteErrorBody {
  status?: string;
  message?: string;
  error_type?: string;
}

export function extractKiteApiError(error: unknown, context: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as KiteErrorBody | string | null;
    if (body && typeof body === 'object' && body.message) {
      return `Kite API (${context}): ${body.message}`;
    }
    if (typeof body === 'string' && body.trim()) {
      return `Kite API (${context}): ${body}`;
    }
    return `Kite API (${context}): HTTP ${error.status}`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Kite API (${context}): request failed.`;
}

export function assertKiteHistoricalSuccess(
  response: unknown,
  timeframe: Timeframe,
): void {
  const parsed = response as KiteErrorBody;
  if (parsed?.status === 'error') {
    throw new Error(parsed.message ?? `Kite API (${timeframe}): historical data request failed.`);
  }
}
