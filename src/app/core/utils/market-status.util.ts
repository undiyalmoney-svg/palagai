/**
 * Is the market open right now?
 *
 * Purely clock-based: it reads the IST wall clock and the weekday against a
 * session's open/close times. There is no exchange holiday calendar in the
 * app, so Diwali reads as "open" here — the Kite feed simply returns the
 * previous session's candles on such a day, which is the same thing the tab
 * shows after close.
 *
 * Kept free of Angular so it can be unit tested against fixed clocks.
 */
import { InstrumentSessionConfig } from '../config/session.config';

export type MarketPhase = 'pre-open' | 'open' | 'after-close' | 'weekend';

export interface MarketStatus {
  phase: MarketPhase;
  /** True only while the session is actually running. */
  open: boolean;
  /** Badge text, e.g. `Live`, `Opens 09:00`, `Closed`. */
  label: string;
  /** One line explaining what the chart is showing and why. */
  detail: string;
  /** Minutes until this session opens; null unless the phase is pre-open. */
  minutesToOpen: number | null;
  /** The IST clock the verdict was taken on (HH:mm), for tooltips and tests. */
  istTime: string;
}

export interface IstClockParts {
  /** `YYYY-MM-DD` in IST. */
  date: string;
  /** `HH:mm` in IST, 24-hour. */
  time: string;
  /** 0 Sun … 6 Sat, in IST — not the browser's day. */
  weekday: number;
}

/**
 * IST date, clock and weekday for an instant.
 *
 * `sv-SE` is used because it formats as `YYYY-MM-DD HH:mm:ss`, which needs no
 * reassembly. The weekday is taken from that date read back as UTC so a
 * browser west of IST cannot shift it a day.
 */
export function istClockParts(now: Date = new Date()): IstClockParts {
  const stamp = now.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
  const [date, clock = '00:00:00'] = stamp.replace('T', ' ').split(' ');
  return {
    date,
    time: clock.slice(0, 5),
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

/** Minutes since midnight for an `HH:mm` string; NaN-safe at 0. */
export function minutesOfDay(hhMm: string): number {
  const [hours, minutes] = hhMm.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

/** `135` → `2h 15m`, `45` → `45m`. */
export function formatMinutesGap(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Where `now` sits in `session`.
 *
 * NSE and MCX are both shut on Saturday and Sunday, so the weekend is decided
 * before the clock is looked at.
 */
export function marketStatusAt(
  session: InstrumentSessionConfig,
  now: Date = new Date(),
): MarketStatus {
  const { time, weekday } = istClockParts(now);
  const open = session.marketOpen;
  const close = session.marketClose;
  const window = `${open}–${close} IST`;

  if (weekday === 0 || weekday === 6) {
    return {
      phase: 'weekend',
      open: false,
      label: 'Weekend',
      detail: `Closed for the weekend. Showing the last session's candles; trading resumes Monday ${open} IST.`,
      minutesToOpen: null,
      istTime: time,
    };
  }

  const nowMin = minutesOfDay(time);
  if (nowMin < minutesOfDay(open)) {
    const gap = minutesOfDay(open) - nowMin;
    return {
      phase: 'pre-open',
      open: false,
      label: `Opens ${open}`,
      detail: `Opens in ${formatMinutesGap(gap)} (${window}). Showing the last session's candles until then.`,
      minutesToOpen: gap,
      istTime: time,
    };
  }

  if (nowMin >= minutesOfDay(close)) {
    return {
      phase: 'after-close',
      open: false,
      label: 'Closed',
      detail: `Session ended at ${close} IST (${window}). Showing today's final candles.`,
      minutesToOpen: null,
      istTime: time,
    };
  }

  return {
    phase: 'open',
    open: true,
    label: 'Live',
    detail: `Market open (${window}). Candles refresh on their own while this tab is in front.`,
    minutesToOpen: null,
    istTime: time,
  };
}
