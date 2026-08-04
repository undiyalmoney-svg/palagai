import { Instrument } from '../models/instrument.model';

export type IndexOptionKind = 'nifty' | 'banknifty';

/** NSE Nifty weekly expiry weekday (0 Sun … 2 Tue). Changed from Thursday in Sep 2025. */
const NIFTY_WEEKLY_DOW = 2;

/** Nifty strikes step 50; Bank Nifty step 100. */
export function strikeStep(kind: IndexOptionKind): number {
  return kind === 'banknifty' ? 100 : 50;
}

export function roundAtmStrike(spot: number, kind: IndexOptionKind): number {
  const step = strikeStep(kind);
  return Math.round(spot / step) * step;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Calendar day in Asia/Kolkata (avoids UTC `setHours(0)` shifting early IST mornings).
 */
export function istCalendarDay(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function parseExpiry(expiry: string): Date | null {
  if (!expiry) {
    return null;
  }
  // Prefer YYYY-MM-DD as a pure calendar date (no TZ shift).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const d = new Date(expiry.includes('T') ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function asOfCalendarDay(asOf: Date): Date {
  return istCalendarDay(asOf);
}

function optionName(kind: IndexOptionKind): string {
  return kind === 'banknifty' ? 'BANKNIFTY' : 'NIFTY';
}

function isIndexOption(item: Instrument, kind: IndexOptionKind): boolean {
  if (item.exchange !== 'NFO') {
    return false;
  }
  if (item.instrumentType !== 'CE' && item.instrumentType !== 'PE') {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  const nm = (item.name || '').toUpperCase();
  if (kind === 'banknifty') {
    return sym.startsWith('BANKNIFTY') || nm === 'BANKNIFTY';
  }
  // Nifty — exclude other indices that also start with NIFTY*
  if (sym.startsWith('BANKNIFTY') || nm === 'BANKNIFTY') {
    return false;
  }
  if (sym.startsWith('FINNIFTY') || nm === 'FINNIFTY') {
    return false;
  }
  if (sym.startsWith('MIDCPNIFTY') || nm === 'MIDCPNIFTY') {
    return false;
  }
  if (sym.startsWith('NIFTYNXT')) {
    return false;
  }
  return sym.startsWith('NIFTY') || nm === 'NIFTY';
}

/** Last Tuesday of a calendar month (year, 0-based month). */
export function lastTuesdayOfMonth(year: number, month: number): Date {
  const last = new Date(year, month + 1, 0);
  last.setHours(0, 0, 0, 0);
  const back = (last.getDay() - NIFTY_WEEKLY_DOW + 7) % 7;
  last.setDate(last.getDate() - back);
  return last;
}

/**
 * Bank Nifty: monthlies only (last Tuesday). Nifty weeklies removed for BN in Nov 2024.
 */
export function nextMonthlyExpiryDate(asOf: Date, rollSameDay: boolean): Date {
  const day = asOfCalendarDay(asOf);
  let year = day.getFullYear();
  let month = day.getMonth();

  for (let i = 0; i < 4; i += 1) {
    const candidate = lastTuesdayOfMonth(year, month);
    if (candidate.getTime() > day.getTime()) {
      return candidate;
    }
    if (candidate.getTime() === day.getTime() && !rollSameDay) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return lastTuesdayOfMonth(year, month);
}

/**
 * Next front expiry on/after asOf.
 * - Nifty: weekly Tuesday (NSE since Sep 2025; was Thursday).
 * - Bank Nifty: monthly last Tuesday (weeklies discontinued).
 */
export function nextWeeklyExpiryDate(
  asOf: Date,
  rollSameDay: boolean,
  kind: IndexOptionKind = 'nifty',
): Date {
  if (kind === 'banknifty') {
    return nextMonthlyExpiryDate(asOf, rollSameDay);
  }
  const day = asOfCalendarDay(asOf);
  const dow = day.getDay(); // 0 Sun … 2 Tue
  let add = (NIFTY_WEEKLY_DOW - dow + 7) % 7;
  if (add === 0 && rollSameDay) {
    add = 7;
  }
  const exp = new Date(day);
  exp.setDate(exp.getDate() + add);
  return exp;
}

/**
 * True when asOf is the current front expiry day for this index.
 * Prefer chain evidence (holiday-shifted Mon); fall back to calendar Tuesday / monthly.
 */
export function isCurrentWeeklyExpiryDay(
  asOfDay: Date,
  instruments: Instrument[] | null | undefined,
  kind: IndexOptionKind,
): boolean {
  const day = asOfCalendarDay(asOfDay);
  const chain = instruments ?? [];
  const expiresToday = chain.some((item) => {
    if (!isIndexOption(item, kind)) {
      return false;
    }
    if (item.instrumentType !== 'CE' && item.instrumentType !== 'PE') {
      return false;
    }
    const exp = parseExpiry(item.expiry);
    return exp != null && exp.getTime() === day.getTime();
  });
  if (expiresToday) {
    return true;
  }
  if (kind === 'banknifty') {
    return nextMonthlyExpiryDate(day, false).getTime() === day.getTime();
  }
  // Synthetic / empty chain — NSE Nifty weekly is Tuesday.
  return day.getDay() === NIFTY_WEEKLY_DOW;
}

/**
 * Never trade the current expiry contract on expiry day — always next weekly/monthly.
 * (Removed legacy “after 13:00 IST always roll” — that only confused non-expiry days
 * and still left morning expiry-day gaps when chain detection failed.)
 */
export function shouldRollWeeklyExpiry(params: {
  asOf: Date;
  instruments: Instrument[];
  kind: IndexOptionKind;
}): boolean {
  const asOfDay = asOfCalendarDay(params.asOf);
  return isCurrentWeeklyExpiryDay(asOfDay, params.instruments, params.kind);
}

function formatExpiryIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatExpiryLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function defaultLot(kind: IndexOptionKind): number {
  // Money proxy / research: Nifty ₹65/pt · Bank ₹30/pt (current NSE lot sizes).
  return kind === 'banknifty' ? 30 : 65;
}

export function buildSyntheticAtmOption(params: {
  kind: IndexOptionKind;
  direction: 'BUY' | 'SELL';
  spot: number;
  asOfDateTime: string;
  /** Optional chain — used to detect holiday-shifted expiry day. */
  instruments?: Instrument[];
}): Instrument {
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  const asOfSafe = Number.isNaN(asOf.getTime()) ? new Date() : asOf;
  const asOfDay = asOfCalendarDay(asOfSafe);
  const rollSameDay = shouldRollWeeklyExpiry({
    asOf: asOfSafe,
    instruments: params.instruments ?? [],
    kind: params.kind,
  });
  const exp = nextWeeklyExpiryDate(asOfDay, rollSameDay, params.kind);
  const name = optionName(params.kind);
  const optType = params.direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundAtmStrike(params.spot, params.kind);
  const expiryIso = formatExpiryIso(exp);

  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${name} ATM ${strike} ${optType}`,
    name,
    exchange: 'NFO',
    segment: 'NFO-OPT',
    instrumentType: optType,
    expiry: expiryIso,
    strike,
    tickSize: 0.05,
    lotSize: defaultLot(params.kind),
    lastPrice: 0,
  };
}

/** Nifty weekly front window (Tue→Tue ≈ 7; +holiday slack). Bank monthly needs ~45. */
function maxFrontExpiryDays(kind: IndexOptionKind): number {
  return kind === 'banknifty' ? 45 : 10;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** True when expiry is a tradeable front contract for as-of — not a far live week from today's dump. */
export function isFrontWeeklyExpiry(
  asOfDay: Date,
  expiry: Date,
  rollSameDay: boolean,
  kind: IndexOptionKind = 'nifty',
): boolean {
  const day = asOfCalendarDay(asOfDay);
  // Never trade same-day expiry (expiry-day → next contract).
  if (expiry.getTime() <= day.getTime()) {
    return false;
  }
  const expected = nextWeeklyExpiryDate(day, rollSameDay, kind);
  const toExp = daysBetween(day, expiry);
  if (toExp < 0 || toExp > maxFrontExpiryDays(kind)) {
    return false;
  }
  // Must be near the expected weekly/monthly (holiday moves expiry by a day or two).
  return Math.abs(daysBetween(expected, expiry)) <= 3;
}

/**
 * Nearest front CE/PE at ATM from Kite instruments.
 * Falls back to a synthetic label when the chain has no match
 * (common for historical Testing dates — expired contracts leave the dump).
 *
 * Never binds historical trades to far live weeklies still in today's NFO dump —
 * that invented huge option ₹ vs flat index pts.
 *
 * Live resilience: if the calendar expected expiry is missing (holiday / rule change),
 * fall back to the nearest unexpired expiry still inside the front window.
 */
export function resolveAtmWeeklyOption(params: {
  instruments: Instrument[];
  kind: IndexOptionKind;
  direction: 'BUY' | 'SELL';
  spot: number;
  asOfDateTime: string;
}): { instrument: Instrument; source: 'chain' | 'synthetic' } {
  const { instruments, kind, direction, spot } = params;
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  if (Number.isNaN(asOf.getTime())) {
    return {
      instrument: buildSyntheticAtmOption(params),
      source: 'synthetic',
    };
  }

  const asOfDay = asOfCalendarDay(asOf);
  // Always roll on expiry day — never bind ATM to a same-day expiring contract.
  const rollSameDay = shouldRollWeeklyExpiry({
    asOf,
    instruments,
    kind,
  });
  const optType = direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundAtmStrike(spot, kind);
  const step = strikeStep(kind);
  const expected = nextWeeklyExpiryDate(asOfDay, rollSameDay, kind);
  const maxDays = maxFrontExpiryDays(kind);

  const pool = instruments.filter(
    (item) => isIndexOption(item, kind) && item.instrumentType === optType,
  );

  const withExpiry = pool
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null)
    .filter((row) => {
      // Hard rule: never trade same-day or past expiry (even if roll flag missed).
      if (row.exp.getTime() <= asOfDay.getTime()) {
        return false;
      }
      const toExp = daysBetween(asOfDay, row.exp);
      return toExp > 0 && toExp <= maxDays;
    });

  // Prefer calendar front (± holiday); else nearest live expiry in the window.
  const onExpected = withExpiry.filter(
    (row) => Math.abs(daysBetween(expected, row.exp)) <= 3,
  );
  const candidatePool = onExpected.length > 0 ? onExpected : withExpiry;

  // 1) Exact ATM, earliest front expiry
  const exact = candidatePool
    .filter((row) => Math.abs(row.item.strike - strike) <= 0.01)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (exact[0]) {
    return { instrument: exact[0].item, source: 'chain' };
  }

  // 2) Near ATM (±1 step), earliest front expiry
  const near = candidatePool
    .filter((row) => Math.abs(row.item.strike - strike) <= step)
    .sort((a, b) => {
      const ea = a.exp.getTime() - b.exp.getTime();
      if (ea !== 0) {
        return ea;
      }
      return Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike);
    });

  if (near[0]) {
    return { instrument: near[0].item, source: 'chain' };
  }

  // Historical / missing week: synthetic + δ estimate in paper desk (do NOT use far live week).
  const synthetic = buildSyntheticAtmOption({ ...params, instruments });
  synthetic.tradingSymbol = `${optionName(kind)} ATM ${strike} ${optType} · week ${formatExpiryLabel(expected)}`;
  return { instrument: synthetic, source: 'synthetic' };
}

export function countIndexOptions(instruments: Instrument[]): number {
  return instruments.filter(
    (i) =>
      i.exchange === 'NFO' &&
      (i.instrumentType === 'CE' || i.instrumentType === 'PE') &&
      (i.tradingSymbol.startsWith('NIFTY') || i.tradingSymbol.startsWith('BANKNIFTY')),
  ).length;
}

/** Diagnostics for Live money SKIP banners when chain resolve fails. */
export function describeOptionChainGap(params: {
  instruments: Instrument[];
  kind: IndexOptionKind;
  direction: 'BUY' | 'SELL';
  spot: number;
  asOfDateTime: string;
}): string {
  const count = countIndexOptions(params.instruments);
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  if (Number.isNaN(asOf.getTime())) {
    return `bad entry time · ${count} index options cached`;
  }
  const rollSameDay = shouldRollWeeklyExpiry({
    asOf,
    instruments: params.instruments,
    kind: params.kind,
  });
  const expected = nextWeeklyExpiryDate(asOfCalendarDay(asOf), rollSameDay, params.kind);
  const strike = roundAtmStrike(params.spot, params.kind);
  const optType = params.direction === 'BUY' ? 'CE' : 'PE';
  return (
    `${count} index options cached · want ${optionName(params.kind)} ${strike}${optType} ` +
    `exp ${formatExpiryIso(expected)} — refresh Instruments / check token`
  );
}
