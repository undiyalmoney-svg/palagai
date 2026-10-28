/** Last completed IST weekday (skips today so Kite 5-minute history is a full session). */
export function lastCompletedSession(now = new Date()): string {
  for (let i = 1; i <= 10; i += 1) {
    const d = new Date(now.getTime() - i * 86400000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const bag: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') bag[p.type] = p.value;
    }
    if (bag['weekday'] === 'Sat' || bag['weekday'] === 'Sun') continue;
    return `${bag['year']}-${bag['month']}-${bag['day']}`;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
