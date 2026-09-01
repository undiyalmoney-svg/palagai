/** Helpers for turning `<input type="month">` values ("YYYY-MM") into date ranges. */

export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** Same YYYY-MM, `delta` months back (delta should be negative to go back). */
export function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y!, (m! - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function firstDayOfMonth(monthStr: string): string {
  return `${monthStr}-01`;
}

export function lastDayOfMonth(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y!, m!, 0); // day 0 of next month = last day of this month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDateDays(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resolves a start/end month pair into an actual [requestedFrom, requestedTo] date range
 * (clamped so `to` never exceeds today), plus a `fetchFrom` that pads backwards by
 * `bufferDays` so indicators (EMA50 etc.) have warm-up history before the requested window.
 */
export function resolveMonthRange(
  startMonth: string,
  endMonth: string,
  bufferDays: number,
): { requestedFrom: string; requestedTo: string; fetchFrom: string } {
  const today = todayIso();
  const requestedFrom = firstDayOfMonth(startMonth);
  const requestedToRaw = lastDayOfMonth(endMonth);
  const requestedTo = requestedToRaw > today ? today : requestedToRaw;
  const fetchFrom = shiftDateDays(requestedFrom, -Math.abs(bufferDays));
  return { requestedFrom, requestedTo, fetchFrom };
}
