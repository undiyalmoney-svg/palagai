import { Instrument } from '../models/instrument.model';
import {
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
} from '../constants/instruments.const';

export function resolveCrudeOilFuturesToken(
  instruments: Instrument[],
): Instrument | undefined {
  const today = startOfDay(new Date());

  const pool = instruments
    .filter(
      (item) =>
        item.exchange === 'MCX' &&
        item.instrumentType === 'FUT' &&
        item.tradingSymbol.startsWith('CRUDEOIL') &&
        !item.tradingSymbol.startsWith('CRUDEOILM'),
    )
    .sort((left, right) => expiryTime(left) - expiryTime(right));

  const next = pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) > today;
  });
  if (next) {
    return next;
  }
  return pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) >= today;
  });
}

/** Nearest MCX CRUDEOILM (mini) futures contract. */
export function resolveCrudeOilMiniFuturesToken(
  instruments: Instrument[],
): Instrument | undefined {
  return resolveMcxMiniFuturesToken(instruments, ['CRUDEOILM']);
}

/**
 * Nearest MCX Natural Gas Mini futures.
 * Tries NATGASMINI first, then NATURALGASMINI / NATURALGAS FUT (skips option legs).
 */
export function resolveNatGasMiniFuturesToken(
  instruments: Instrument[],
): Instrument | undefined {
  return (
    resolveMcxMiniFuturesToken(instruments, ['NATGASMINI', 'NATURALGASMINI']) ||
    resolveMcxMiniFuturesToken(instruments, ['NATURALGAS'])
  );
}

/**
 * Nearest MCX mini futures for any symbol prefix list.
 * Prefers next contract (expiry > today) so expiry day rolls like options;
 * falls back to same-day only if no later FUT exists.
 */
export function resolveMcxMiniFuturesToken(
  instruments: Instrument[],
  prefixes: string[],
): Instrument | undefined {
  const today = startOfDay(new Date());
  const prefs = prefixes.map((p) => p.toUpperCase());

  const pool = instruments
    .filter(
      (item) =>
        item.exchange === 'MCX' &&
        item.instrumentType === 'FUT' &&
        prefs.some((p) => item.tradingSymbol.toUpperCase().startsWith(p)),
    )
    .sort((left, right) => expiryTime(left) - expiryTime(right));

  const next = pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) > today;
  });
  if (next) {
    return next;
  }
  return pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) >= today;
  });
}

/** Nearest NSE monthly futures for Nifty / Bank Nifty (index tokens as fallback). */
export function resolveNseIndexFuturesToken(
  instruments: Instrument[],
  kind: 'nifty' | 'banknifty',
): Instrument | undefined {
  const today = startOfDay(new Date());
  const prefix = kind === 'banknifty' ? 'BANKNIFTY' : 'NIFTY';

  const pool = instruments
    .filter(
      (item) =>
        item.exchange === 'NFO' &&
        item.instrumentType === 'FUT' &&
        item.tradingSymbol.startsWith(prefix) &&
        !item.tradingSymbol.startsWith('NIFTYNXT') &&
        !(kind === 'nifty' && item.tradingSymbol.startsWith('BANKNIFTY')) &&
        !(kind === 'nifty' && item.tradingSymbol.startsWith('FINNIFTY')) &&
        !(kind === 'nifty' && item.tradingSymbol.startsWith('MIDCPNIFTY')),
    )
    .sort((left, right) => expiryTime(left) - expiryTime(right));

  const next = pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) > today;
  });
  if (next) {
    return next;
  }
  return pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) >= today;
  });
}

export function isCrudeOilInstrumentId(id: string): boolean {
  return id === CRUDE_OIL_INSTRUMENT.id;
}

export function isCrudeOilMiniInstrumentId(id: string): boolean {
  return id === CRUDE_OIL_MINI_INSTRUMENT.id;
}

export function isBankNiftyInstrumentId(id: string): boolean {
  return id === BANK_NIFTY_INSTRUMENT.id;
}

export function isNifty50InstrumentId(id: string): boolean {
  return id === NIFTY_50_INSTRUMENT.id;
}

function expiryTime(instrument: Instrument): number {
  if (!instrument.expiry) {
    return Number.MAX_SAFE_INTEGER;
  }
  const time = new Date(instrument.expiry).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
