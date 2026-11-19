import { SNIPER_BAR_MIN, SNIPER_BOOKS, SniperBar, SniperBookCfg, SniperUnder } from './sniper.models';

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

/** Entry minutes: first trade is the second 5-minute slot (after the opening signal candle). */
export function sniperSlotStarts(cfg: SniperBookCfg): number[] {
  const out: number[] = [];
  for (let m = cfg.openMin + SNIPER_BAR_MIN; m <= cfg.lastEntryMin; m += SNIPER_BAR_MIN) out.push(m);
  return out;
}

export function sniperIntervalStart(cfg: SniperBookCfg, nowMin: number): number {
  if (nowMin < cfg.openMin + SNIPER_BAR_MIN) return cfg.openMin;
  const steps = Math.floor((nowMin - cfg.openMin) / SNIPER_BAR_MIN);
  return cfg.openMin + steps * SNIPER_BAR_MIN;
}

export function sniperPrevCandleMin(cfg: SniperBookCfg, nowMin: number): number {
  return sniperIntervalStart(cfg, nowMin) - SNIPER_BAR_MIN;
}

export function sniperRemainingMin(cfg: SniperBookCfg, nowMin: number): number {
  const end = sniperIntervalStart(cfg, nowMin) + SNIPER_BAR_MIN;
  return Math.max(0, end - nowMin);
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
