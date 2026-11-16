import { parseIstTimestamp } from '../live-desk/live-start-guard.util';
import { LiveAssumeBar } from './live-assume.engine';

/**
 * Kite 1-min candle → IST day + minutes.
 * Naive stamps (MCX often omits the zone) are IST, not UTC — otherwise Crude Mini
 * 09:00 bars become 14:30 and Paper test sits at 0 trades all morning.
 */
export function kiteBar(row: unknown[]): LiveAssumeBar {
  const raw = String(row[0] || '');
  const ms = parseIstTimestamp(raw);
  if (!ms) return { day: '', min: 0, open: 0, high: 0, low: 0, close: 0 };
  const ist = new Date(ms + 330 * 60 * 1000);
  return {
    day: ist.toISOString().slice(0, 10),
    min: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0,
  };
}
