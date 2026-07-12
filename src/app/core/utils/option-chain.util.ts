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
  return kind === 'banknifty' ? 15 : 65;
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

/**
 * Nearest weekly CE/PE at ATM from Kite instruments.
 * Falls back to a synthetic label when the chain has no match
 * (common for historical Testing dates — expired contracts leave the dump).
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

  const pool = instruments.filter(
    (item) => isIndexOption(item, kind) && item.instrumentType === optType,
  );

  const withExpiry = pool
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null);

  // 1) Exact ATM, expiry on/after as-of
  const exact = withExpiry
    .filter((row) => {
      if (Math.abs(row.item.strike - strike) > 0.01) {
        return false;
      }
      if (row.exp < asOfDay) {
        return false;
      }
      if (row.exp.getTime() === asOfDay.getTime() && rollSameDay) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (exact[0]) {
    return { instrument: exact[0].item, source: 'chain' };
  }

  // 2) Near ATM (±1 step), expiry on/after as-of
  const near = withExpiry
    .filter((row) => {
      if (Math.abs(row.item.strike - strike) > step) {
        return false;
      }
      if (row.exp < asOfDay) {
        return false;
      }
      if (row.exp.getTime() === asOfDay.getTime() && rollSameDay) {
        return false;
      }
      return true;
    })
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

  // 3) Historical date: chain only has live contracts — pick nearest live expiry ATM
  const liveAtm = withExpiry
    .filter((row) => Math.abs(row.item.strike - strike) <= step)
    .sort((a, b) => {
      const ea = a.exp.getTime() - b.exp.getTime();
      if (ea !== 0) {
        return ea;
      }
      return Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike);
    });

  if (liveAtm[0]) {
    return { instrument: liveAtm[0].item, source: 'chain' };
  }

  // 4) Always show something
  const synthetic = buildSyntheticAtmOption(params);
  synthetic.tradingSymbol = `${optionName(kind)} ATM ${strike} ${optType} · week ${formatExpiryLabel(nextWeeklyExpiryDate(asOfDay, rollSameDay))}`;
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
