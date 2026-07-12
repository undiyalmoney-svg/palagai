/** Kite historical API max calendar days per request (official limits). */
export const KITE_HISTORICAL_MAX_DAYS: Record<string, number> = {
  minute: 60,
  '2minute': 60,
  '3minute': 100,
  '4minute': 100,
  '5minute': 100,
  '10minute': 100,
  '15minute': 200,
  '30minute': 200,
  '60minute': 400,
  hour: 400,
  day: 2000,
};

/** Stay one day under the published cap to avoid edge-case rejections. */
export function kiteMaxDaysForInterval(interval: string): number {
  const cap = KITE_HISTORICAL_MAX_DAYS[interval] ?? 60;
  return Math.max(1, cap - 1);
}

export function datePart(dateTime: string): string {
  return dateTime.trim().slice(0, 10);
}

/** Inclusive calendar-day span between YYYY-MM-DD values. */
export function calendarDaysInclusive(fromIso: string, toIso: string): number {
  const from = new Date(`${datePart(fromIso)}T00:00:00`);
  const to = new Date(`${datePart(toIso)}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 0;
  }
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export interface DateChunk {
  fromDate: string;
  toDate: string;
}

/**
 * Split an inclusive YYYY-MM-DD range into chunks that fit Kite's per-call day cap.
 */
export function chunkInclusiveDateRange(
  fromIso: string,
  toIso: string,
  maxDays: number,
): DateChunk[] {
  const fromDate = datePart(fromIso);
  const toDate = datePart(toIso);
  const span = calendarDaysInclusive(fromDate, toDate);
  if (span <= 0) {
    return [];
  }
  if (span <= maxDays) {
    return [{ fromDate, toDate }];
  }

  const chunks: DateChunk[] = [];
  let cursor = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);

  while (cursor <= end) {
    const chunkStart = toIsoDate(cursor);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setDate(chunkEndDate.getDate() + maxDays - 1);
    if (chunkEndDate > end) {
      chunkEndDate.setTime(end.getTime());
    }
    chunks.push({ fromDate: chunkStart, toDate: toIsoDate(chunkEndDate) });
    cursor = new Date(chunkEndDate);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
