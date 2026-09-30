const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const text = (decimals > 0 ? INR2 : INR).format(abs);
  return `${value < 0 ? '-' : ''}₹${text}`;
}

export function signedInr(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${inr(value, decimals)}`;
}

/** Fractions (0.123) to "12.3%". */
export function pctFrac(value: number | null | undefined, digits = 1, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const v = value * 100;
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/** Values already in percent (12.3) to "12.3%". */
export function pctNum(value: number | null | undefined, digits = 1, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function tone(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value == null || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  return code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function regimeLabel(regime: string | null | undefined): string {
  return regime === 'HIGH_VOLATILITY' ? 'High volatility' : humanize(regime);
}

export function errorMessage(err: unknown, fallback = 'Request failed'): string {
  const e = err as { error?: { message?: string }; message?: string; status?: number };
  if (e?.error?.message) return e.error.message;
  if (e?.status === 0) return 'Cannot reach the trading server. Check that the Order API is running.';
  if (e?.status === 403) return 'Your account does not have the Momentum module enabled.';
  if (e?.status === 401) return 'Session expired — sign in again.';
  return e?.message || fallback;
}

export function actionTone(action: string | null | undefined): 'up' | 'down' | 'warn' | 'info' | 'muted' | 'strong' {
  switch (action) {
    case 'STRONG_BUY':
      return 'strong';
    case 'BUY':
    case 'ADD':
      return 'up';
    case 'SELL':
    case 'EXIT':
      return 'down';
    case 'REDUCE':
      return 'warn';
    case 'HOLD':
    case 'WATCH':
      return 'info';
    default:
      return 'muted';
  }
}

export function regimeTone(regime: string | null | undefined): 'up' | 'down' | 'warn' | 'info' {
  switch (regime) {
    case 'BULLISH':
      return 'up';
    case 'BEARISH':
      return 'down';
    case 'HIGH_VOLATILITY':
      return 'warn';
    default:
      return 'info';
  }
}

export function orderTone(status: string | null | undefined): 'up' | 'down' | 'warn' | 'info' | 'muted' {
  switch (status) {
    case 'FILLED':
      return 'up';
    case 'REJECTED':
    case 'FAILED':
    case 'CANCELLED':
      return 'down';
    case 'PARTIALLY_FILLED':
    case 'PARTIAL_CANCELLED':
    case 'UNKNOWN':
    case 'QUEUED':
      return 'warn';
    case 'OPEN':
    case 'SUBMITTED':
      return 'info';
    default:
      return 'muted';
  }
}
