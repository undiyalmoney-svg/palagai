import { Instrument } from '../models/instrument.model';

export type IndexOptionKind = 'nifty' | 'banknifty';

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

function parseExpiry(expiry: string): Date | null {
  if (!expiry) {
    return null;
  }
  const d = new Date(expiry.includes('T') ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
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

/** Next Thursday on/after asOf (NSE weekly). */
export function nextWeeklyExpiryDate(asOf: Date, rollSameDay: boolean): Date {
  const day = startOfDay(asOf);
  const dow = day.getDay(); // 0 Sun … 4 Thu
  let add = (4 - dow + 7) % 7;
  if (add === 0 && rollSameDay) {
    add = 7;
  }
  const exp = new Date(day);
  exp.setDate(exp.getDate() + add);
  return exp;
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
}): Instrument {
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  const hhmm = Number.isNaN(asOf.getTime())
    ? '10:00'
    : asOf.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      });
  const rollSameDay = hhmm >= '13:00';
  const exp = nextWeeklyExpiryDate(
    Number.isNaN(asOf.getTime()) ? new Date() : asOf,
    rollSameDay,
  );
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

/** Days from as-of → expiry allowed for a front weekly (Fri→next Thu ≈ 6–7; +holiday slack). */
const MAX_FRONT_WEEKLY_DAYS = 10;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** True when expiry is the trade-date front weekly — not a far live week from today's dump. */
export function isFrontWeeklyExpiry(asOfDay: Date, expiry: Date, rollSameDay: boolean): boolean {
  if (expiry < asOfDay) {
    return false;
  }
  if (expiry.getTime() === asOfDay.getTime() && rollSameDay) {
    return false;
  }
  const expected = nextWeeklyExpiryDate(asOfDay, rollSameDay);
  const toExp = daysBetween(asOfDay, expiry);
  if (toExp < 0 || toExp > MAX_FRONT_WEEKLY_DAYS) {
    return false;
  }
  // Must be near the expected weekly (holiday moves expiry by a day or two).
  return Math.abs(daysBetween(expected, expiry)) <= 3;
}

/**
 * Nearest weekly CE/PE at ATM from Kite instruments.
 * Falls back to a synthetic label when the chain has no match
 * (common for historical Testing dates — expired contracts leave the dump).
 *
 * Never binds historical trades to far live weeklies still in today's NFO dump —
 * that invented huge option ₹ vs flat index pts.
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

  const asOfDay = startOfDay(asOf);
  const hhmm = asOf.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
  const rollSameDay = hhmm >= '13:00';
  const optType = direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundAtmStrike(spot, kind);
  const step = strikeStep(kind);
  const expected = nextWeeklyExpiryDate(asOfDay, rollSameDay);

  const pool = instruments.filter(
    (item) => isIndexOption(item, kind) && item.instrumentType === optType,
  );

  const withExpiry = pool
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null)
    .filter((row) => isFrontWeeklyExpiry(asOfDay, row.exp, rollSameDay));

  // 1) Exact ATM, front weekly only
  const exact = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) <= 0.01)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (exact[0]) {
    return { instrument: exact[0].item, source: 'chain' };
  }

  // 2) Near ATM (±1 step), front weekly only
  const near = withExpiry
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
  const synthetic = buildSyntheticAtmOption(params);
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
