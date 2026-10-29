function istParts(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const bag: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  return bag;
}

function isoFromBag(bag: Record<string, string>): string {
  return `${bag['year']}-${bag['month']}-${bag['day']}`;
}

/** Last completed IST weekday. After 15:30 IST that is today; before the close it is the previous weekday. */
export function lastCompletedSession(now = new Date()): string {
  const today = istParts(now);
  const weekday = today['weekday'];
  const hour = Number(today['hour']);
  const minute = Number(today['minute']);
  const closed = hour * 60 + minute >= 15 * 60 + 30;
  if (weekday !== 'Sat' && weekday !== 'Sun' && closed) {
    return isoFromBag(today);
  }
  for (let i = 1; i <= 10; i += 1) {
    const d = new Date(now.getTime() - i * 86400000);
    const bag = istParts(d);
    if (bag['weekday'] === 'Sat' || bag['weekday'] === 'Sun') continue;
    return isoFromBag(bag);
  }
  return isoFromBag(today);
}

export function inr(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function pct(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return `${(n * 100).toFixed(2)}%`;
}

/** Calendar days before an ISO date (YYYY-MM-DD), used for discovery range defaults. */
export function daysBefore(iso: string, days: number): string {
  const [y, m, d] = String(iso || '')
    .split('-')
    .map((p) => Number(p));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - Math.max(0, days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
