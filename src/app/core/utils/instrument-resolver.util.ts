import { Instrument } from '../models/instrument.model';
import {
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
} from '../constants/instruments.const';

export function resolveCrudeOilFuturesToken(
  instruments: Instrument[],
): Instrument | undefined {
  const today = startOfDay(new Date());

  return instruments
    .filter(
      (item) =>
        item.exchange === 'MCX' &&
        item.instrumentType === 'FUT' &&
        item.tradingSymbol.startsWith('CRUDEOIL') &&
        !item.tradingSymbol.startsWith('CRUDEOILM'),
    )
    .filter((item) => {
      if (!item.expiry) {
        return true;
      }
      const expiry = startOfDay(new Date(item.expiry));
      return expiry >= today;
    })
    .sort((left, right) => expiryTime(left) - expiryTime(right))[0];
}

/** Nearest NSE monthly futures for Nifty / Bank Nifty (index tokens as fallback). */
export function resolveNseIndexFuturesToken(
  instruments: Instrument[],
  kind: 'nifty' | 'banknifty',
): Instrument | undefined {
  const today = startOfDay(new Date());
  const prefix = kind === 'banknifty' ? 'BANKNIFTY' : 'NIFTY';

  return instruments
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
    .filter((item) => {
      if (!item.expiry) {
        return true;
      }
      const expiry = startOfDay(new Date(item.expiry));
      return expiry >= today;
    })
    .sort((left, right) => expiryTime(left) - expiryTime(right))[0];
}

export function isCrudeOilInstrumentId(id: string): boolean {
  return id === CRUDE_OIL_INSTRUMENT.id;
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
