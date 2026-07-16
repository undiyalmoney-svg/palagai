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

export function roundCrudeStrike(spot: number): number {
  const step = crudeStrikeStep();
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

function isCrudeMiniOption(item: Instrument): boolean {
  if (item.exchange !== 'MCX') {
    return false;
  }
  const type = item.instrumentType?.toUpperCase() ?? '';
  if (type !== 'CE' && type !== 'PE') {
    return false;
  }
  return item.tradingSymbol.toUpperCase().startsWith('CRUDEOILM');
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

export function countCrudeMiniOptions(instruments: Instrument[]): number {
  return instruments.filter(isCrudeMiniOption).length;
}

/** List near-ATM CRUDEOILM options for the nearest live expiry. */
export function listCrudeOilMiniOptions(
  instruments: Instrument[],
  spot: number,
  limit = 12,
): { atm: CrudeOptionPick[]; expiry: string | null } {
  const today = startOfDay(new Date());
  const options = instruments.filter(isCrudeMiniOption).filter((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay(new Date(item.expiry)) >= today;
  });

  if (!options.length) {
    return { atm: [], expiry: null };
  }

  const nearestExpiry = options
    .map((item) => item.expiry)
    .filter(Boolean)
    .sort()[0];

  const chain = options.filter((item) => item.expiry === nearestExpiry);
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

  return { atm: picks, expiry: nearestExpiry ?? null };
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
 * ATM CRUDEOILM CE/PE for paper + live desk.
 * Prefers mini chain; falls back to synthetic label when missing.
 */
export function resolveAtmCrudeMiniOption(params: {
  instruments: Instrument[];
  direction: 'BUY' | 'SELL';
  spot: number;
  asOfDateTime: string;
}): { instrument: Instrument; source: 'chain' | 'synthetic' } {
  const optType = params.direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundCrudeStrike(params.spot);
  const asOf = new Date(
    params.asOfDateTime.includes('T')
      ? params.asOfDateTime
      : params.asOfDateTime.replace(' ', 'T'),
  );
  const asOfDay = Number.isNaN(asOf.getTime()) ? startOfDay(new Date()) : startOfDay(asOf);

  const pool = params.instruments
    .filter((item) => isCrudeMiniOption(item) || isAnyCrudeOption(item))
    .filter((item) => item.instrumentType.toUpperCase() === optType)
    .sort((a, b) => {
      const aMini = a.tradingSymbol.startsWith('CRUDEOILM') ? 0 : 1;
      const bMini = b.tradingSymbol.startsWith('CRUDEOILM') ? 0 : 1;
      return aMini - bMini;
    });

  const withExpiry = pool
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null)
    .filter((row) => row.exp >= asOfDay);

  const exact = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) < 0.01)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (exact[0]) {
    return { instrument: exact[0].item, source: 'chain' };
  }

  const near = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) <= crudeStrikeStep())
    .sort(
      (a, b) =>
        Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike) ||
        a.exp.getTime() - b.exp.getTime(),
    );

  if (near[0]) {
    return { instrument: near[0].item, source: 'chain' };
  }

  return {
    instrument: buildSyntheticCrudeOption(params.direction, params.spot, asOfDay),
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
    product: 'NRML',
  };
}

function buildSyntheticCrudeOption(
  direction: 'BUY' | 'SELL',
  spot: number,
  asOfDay: Date,
): Instrument {
  const optType = direction === 'BUY' ? 'CE' : 'PE';
  const strike = roundCrudeStrike(spot);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expiry = `${asOfDay.getFullYear()}-${pad(asOfDay.getMonth() + 1)}-${pad(asOfDay.getDate())}`;
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `CRUDEOILM ATM ${strike} ${optType}`,
    name: 'CRUDEOILM',
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
