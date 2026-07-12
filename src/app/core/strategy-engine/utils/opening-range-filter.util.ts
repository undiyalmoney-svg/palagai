import { Candle } from '../../models/candle.model';

const SESSION_OPEN = '09:15';

export interface OpeningRangeFilterResult {
  allowed: boolean;
  reason: string;
}

/** Block entries until the 09:15–09:20 candle has completed (first bar of the session). */
export function evaluateOpeningRangeFilter(candle: Candle): OpeningRangeFilterResult {
  const time = extractHhMm(candle.date);
  if (time === SESSION_OPEN) {
    return {
      allowed: false,
      reason: 'Opening range — waiting for 09:20 candle close',
    };
  }
  return {
    allowed: true,
    reason: 'Opening range complete',
  };
}

function extractHhMm(dateTime: string): string {
  const normalized = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  const timePart = normalized.split(' ')[1] ?? '';
  return timePart.slice(0, 5);
}
