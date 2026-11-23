import {
  SNIPER_BAR_MIN,
  SNIPER_BOOKS,
  SNIPER_OPEN_MIN,
  SNIPER_OR_END_MIN,
  SniperBar,
  SniperBookCfg,
  SniperUnder,
} from './sniper.models';

export function sniperIstDay(d = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function sniperIstMinutes(d = new Date()): number {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function sniperIstClock(iso?: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function sniperCfg(id: SniperUnder): SniperBookCfg {
  return SNIPER_BOOKS.find((b) => b.id === id) || SNIPER_BOOKS[0];
}

export function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function completedSniperBars(bars: SniperBar[], day: string, nowMin: number): SniperBar[] {
  return bars.filter((b) => b.day < day || (b.day === day && b.min + SNIPER_BAR_MIN <= nowMin));
}

export function barAt(bars: SniperBar[], day: string, min: number): SniperBar | null {
  return bars.find((b) => b.day === day && b.min === min) || null;
}

export function sniperOrBars(bars: SniperBar[], day: string): SniperBar[] {
  return bars.filter((b) => b.day === day && b.min >= SNIPER_OPEN_MIN && b.min < SNIPER_OR_END_MIN);
}

export function sniperOrbReady(nowMin: number): boolean {
  return nowMin >= SNIPER_OR_END_MIN;
}
