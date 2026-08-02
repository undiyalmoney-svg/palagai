import { Instrument } from '../models/instrument.model';
import { PaperOptionContract } from '../paper-desk/paper-desk.models';

export type CrudeOptionSide = 'CE' | 'PE';

export interface CrudeOptionPick {
  instrument: Instrument;
  side: CrudeOptionSide;
  strike: number;
  expiry: string;
  tradingSymbol: string;
  lotSize: number;
  lastPrice: number;
  distanceFromSpot: number;
}

/** MCX crude mini options use 50-point strike steps. */
export function crudeStrikeStep(): number {
  return 50;
}

export function roundCrudeStrike(spot: number, step = crudeStrikeStep()): number {
  return Math.round(spot / step) * step;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Calendar day in Asia/Kolkata (same rule as Nifty/Bank option-chain util).
 * Avoids UTC `setHours(0)` shifting early IST mornings onto the previous day.
 */
export function crudeIstCalendarDay(date: Date): Date {
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

function formatExpiryIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isCrudeMiniOption(item: Instrument): boolean {
  return isMcxMiniOption(item, ['CRUDEOILM']);
}

function isMcxMiniOption(item: Instrument, prefixes: string[]): boolean {
  if (item.exchange !== 'MCX') {
    return false;
  }
  const type = item.instrumentType?.toUpperCase() ?? '';
  if (type !== 'CE' && type !== 'PE') {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  return prefixes.some((p) => sym.startsWith(p.toUpperCase()));
}

function isAnyCrudeOption(item: Instrument): boolean {
  if (item.exchange !== 'MCX') {
    return false;
  }
  const type = item.instrumentType?.toUpperCase() ?? '';
  if (type !== 'CE' && type !== 'PE') {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  return sym.startsWith('CRUDEOIL');
}

export function countCrudeMiniOptions(
  instruments: Instrument[],
  prefixes: string[] = ['CRUDEOILM'],
): number {
  return instruments.filter((item) => isMcxMiniOption(item, prefixes)).length;
}

/**
 * Unique sorted option expiry days on/after asOf.
 */
export function listCrudeLiveExpiries(
  instruments: Instrument[],
  asOfDay: Date,
  prefixes: string[] = ['CRUDEOILM'],
): Date[] {
  const day = crudeIstCalendarDay(asOfDay);
  const seen = new Set<number>();
  const out: Date[] = [];
  for (const item of instruments) {
    if (!isMcxMiniOption(item, prefixes) && !(prefixes.includes('CRUDEOILM') && isAnyCrudeOption(item))) {
      continue;
    }
    const exp = parseExpiry(item.expiry);
    // Hard rule (same as Nifty/Bank): never keep same-day or past expiry.
    if (!exp || exp.getTime() <= day.getTime()) {
      continue;
    }
    const key = exp.getTime();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(exp);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/**
 * Never trade the current expiry on expiry day — always the next contract.
 * `listCrudeLiveExpiries` already drops same-day/past; front = earliest remaining.
 */
export function resolveCrudeFrontExpiry(
  asOfDay: Date,
  liveExpiries: Date[],
): Date | null {
  if (!liveExpiries.length) {
    return null;
  }
  return liveExpiries[0]!;
}

/** True when asOf matches a listed crude option expiry (must roll). */
export function isCrudeOptionExpiryDay(
  asOfDay: Date,
  instruments: Instrument[],
): boolean {
  const day = crudeIstCalendarDay(asOfDay);
  // Check raw chain for an expiry matching today (before the same-day filter).
  return instruments.some((item) => {
    if (!isCrudeMiniOption(item) && !isAnyCrudeOption(item)) {
      return false;
    }
    const exp = parseExpiry(item.expiry);
    return exp != null && exp.getTime() === day.getTime();
  });
}

/** List near-ATM CRUDEOILM options for the tradeable front expiry (skips expiry day). */
export function listCrudeOilMiniOptions(
  instruments: Instrument[],
  spot: number,
  limit = 12,
  asOfDateTime?: string,
): { atm: CrudeOptionPick[]; expiry: string | null } {
  const asOf = asOfDateTime
    ? new Date(asOfDateTime.includes('T') ? asOfDateTime : asOfDateTime.replace(' ', 'T'))
    : new Date();
  const asOfDay = Number.isNaN(asOf.getTime())
    ? crudeIstCalendarDay(new Date())
    : crudeIstCalendarDay(asOf);
  const live = listCrudeLiveExpiries(instruments, asOfDay);
  const front = resolveCrudeFrontExpiry(asOfDay, live);
  if (!front) {
    return { atm: [], expiry: null };
  }
  const nearestExpiry = formatExpiryIso(front);

  const chain = instruments
    .filter(isCrudeMiniOption)
    .filter((item) => {
      const exp = parseExpiry(item.expiry);
      return exp != null && exp.getTime() === front.getTime();
    });
  const atmStrike = roundCrudeStrike(spot);

  const picks: CrudeOptionPick[] = chain
    .filter((item) => Math.abs(item.strike - atmStrike) <= crudeStrikeStep() * 2)
    .map((item) => toPick(item, spot))
    .sort((a, b) => {
      if (a.side !== b.side) {
        return a.side === 'CE' ? -1 : 1;
      }
      return a.strike - b.strike;
    })
    .slice(0, limit);

  return { atm: picks, expiry: nearestExpiry };
}

export function pickCrudeDirectionOption(
  instruments: Instrument[],
  spot: number,
  direction: 'BUY' | 'SELL',
): CrudeOptionPick | null {
  const side: CrudeOptionSide = direction === 'BUY' ? 'CE' : 'PE';
  const { atm } = listCrudeOilMiniOptions(instruments, spot, 24);
  return atm.find((item) => item.side === side) ?? null;
}

/**
 * ATM MCX mini CE/PE for paper + live desk (Crude Oil Mini by default).
 * Prefers mini chain; falls back to synthetic label when missing.
 * On expiry day, always selects the **next** expiry (never same-day contract).
 */
export function resolveAtmCrudeMiniOption(params: {
  instruments: Instrument[];
  direction: 'BUY' | 'SELL';
  spot: number;
  asOfDateTime: string;
  /** Option/fut symbol prefixes — default CRUDEOILM. */
  prefixes?: string[];
  strikeStep?: number;
  syntheticName?: string;
}): { instrument: Instrument; source: 'chain' | 'synthetic' } {
  const prefixes = (params.prefixes?.length ? params.prefixes : ['CRUDEOILM']).map((p) =>
    p.toUpperCase(),
  );
  const strikeStep = params.strikeStep && params.strikeStep > 0 ? params.strikeStep : crudeStrikeStep();
  const syntheticName = params.syntheticName || prefixes[0] || 'CRUDEOILM';
  const optType = params.direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundCrudeStrike(params.spot, strikeStep);
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  const asOfDay = Number.isNaN(asOf.getTime())
    ? crudeIstCalendarDay(new Date())
    : crudeIstCalendarDay(asOf);

  const pool = params.instruments
    .filter(
      (item) =>
        isMcxMiniOption(item, prefixes) ||
        (prefixes.some((p) => p.startsWith('CRUDE')) && isAnyCrudeOption(item)),
    )
    .filter((item) => item.instrumentType.toUpperCase() === optType)
    .sort((a, b) => {
      const aMini = prefixes.some((p) => a.tradingSymbol.toUpperCase().startsWith(p)) ? 0 : 1;
      const bMini = prefixes.some((p) => b.tradingSymbol.toUpperCase().startsWith(p)) ? 0 : 1;
      return aMini - bMini;
    });

  const liveExpiries = listCrudeLiveExpiries(params.instruments, asOfDay, prefixes);
  const front = resolveCrudeFrontExpiry(asOfDay, liveExpiries);

  const withExpiry = pool
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null)
    .filter((row) => {
      // Hard rule: never same-day or past expiry (even if front map missed).
      if (row.exp.getTime() <= asOfDay.getTime()) {
        return false;
      }
      if (!front) {
        return true;
      }
      return row.exp.getTime() === front.getTime();
    });

  const exact = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) < 0.01)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (exact[0]) {
    return { instrument: exact[0].item, source: 'chain' };
  }

  const near = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) <= strikeStep)
    .sort(
      (a, b) =>
        Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike) ||
        a.exp.getTime() - b.exp.getTime(),
    );

  if (near[0]) {
    return { instrument: near[0].item, source: 'chain' };
  }

  return {
    instrument: buildSyntheticCrudeOption(
      params.direction,
      params.spot,
      asOfDay,
      front ?? undefined,
      { strikeStep, name: syntheticName },
    ),
    source: 'synthetic',
  };
}

export function toCrudePaperOption(
  instrument: Instrument,
  source: 'chain' | 'synthetic',
): PaperOptionContract {
  return {
    tradingSymbol: instrument.tradingSymbol,
    instrumentToken: instrument.instrumentToken,
    strike: instrument.strike,
    expiry: instrument.expiry,
    optionType: instrument.instrumentType === 'PE' ? 'PE' : 'CE',
    lotSize: instrument.lotSize > 0 ? instrument.lotSize : 10,
    source,
    exchange: 'MCX',
    product: 'MIS',
  };
}

function buildSyntheticCrudeOption(
  direction: 'BUY' | 'SELL',
  spot: number,
  asOfDay: Date,
  frontExpiry?: Date,
  opts?: { strikeStep?: number; name?: string },
): Instrument {
  const optType = direction === 'BUY' ? 'CE' : 'PE';
  const step = opts?.strikeStep && opts.strikeStep > 0 ? opts.strikeStep : crudeStrikeStep();
  const name = opts?.name || 'CRUDEOILM';
  const strike = roundCrudeStrike(spot, step);
  // Prefer known next front; else bump one calendar day so we never label same-day expiry.
  const day = crudeIstCalendarDay(asOfDay);
  let exp = frontExpiry ? crudeIstCalendarDay(frontExpiry) : day;
  if (exp.getTime() <= day.getTime()) {
    exp = new Date(day);
    exp.setDate(exp.getDate() + 1);
  }
  const expiry = formatExpiryIso(exp);
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${name} ATM ${strike} ${optType}`,
    name,
    exchange: 'MCX',
    segment: 'MCX-OPT',
    instrumentType: optType,
    expiry,
    strike,
    tickSize: 0.05,
    lotSize: 10,
    lastPrice: 0,
  };
}

function toPick(item: Instrument, spot: number): CrudeOptionPick {
  const side = item.instrumentType.toUpperCase() as CrudeOptionSide;
  return {
    instrument: item,
    side,
    strike: item.strike,
    expiry: item.expiry,
    tradingSymbol: item.tradingSymbol,
    lotSize: item.lotSize > 0 ? item.lotSize : 10,
    lastPrice: item.lastPrice,
    distanceFromSpot: Math.abs(item.strike - spot),
  };
}
