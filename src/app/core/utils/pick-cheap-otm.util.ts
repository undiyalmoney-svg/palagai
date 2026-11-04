/**
 * Next-expiry cheap OTM CE/PE that fits the ₹14k premium budget.
 * Long → CE. Short → PE. Never the dying expiry.
 */
import { Instrument } from '../models/instrument.model';
import { OPTION_14K_BOOKS, Option14kBookId, OPTION_14K_PREMIUM_BUDGET_RS } from '../paper-desk/option-14k-plan';
import { crudeMiniLotSize, crudeIstCalendarDay } from './crude-option.util';
import { istCalendarDay } from './option-chain.util';

export type CheapOtmSide = 'CE' | 'PE';

export interface CheapOtmPick {
  instrument: Instrument;
  source: 'chain' | 'synthetic';
  side: CheapOtmSide;
  strike: number;
  expiry: string;
  lotSize: number;
  lastPrice: number;
  openCostRs: number;
  fitsBudget: boolean;
}

function parseExpiry(expiry: string): Date | null {
  if (!expiry) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  const d = new Date(expiry.includes('T') ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatExpiryIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asOfDay(asOf: Date): Date {
  return istCalendarDay(asOf);
}

function isBookOption(item: Instrument, book: Option14kBookId): boolean {
  const type = (item.instrumentType || '').toUpperCase();
  if (type !== 'CE' && type !== 'PE') return false;
  const ex = (item.exchange || '').toUpperCase();
  const sym = (item.tradingSymbol || '').toUpperCase();
  const nm = (item.name || '').toUpperCase();
  if (book === 'nifty') {
    if (ex !== 'NFO') return false;
    if (sym.startsWith('BANKNIFTY') || nm === 'BANKNIFTY') return false;
    if (sym.startsWith('FINNIFTY') || nm === 'FINNIFTY') return false;
    if (sym.startsWith('MIDCPNIFTY') || nm === 'MIDCPNIFTY') return false;
    if (sym.startsWith('NIFTYNXT')) return false;
    return sym.startsWith('NIFTY') || nm === 'NIFTY';
  }
  if (book === 'bank') {
    return ex === 'NFO' && (sym.startsWith('BANKNIFTY') || nm === 'BANKNIFTY');
  }
  if (book === 'sensex') {
    if (ex !== 'BFO') return false;
    if (sym.startsWith('SENSEX50') || nm.startsWith('SENSEX50')) return false;
    if (sym.startsWith('BANKEX') || nm === 'BANKEX') return false;
    return sym.startsWith('SENSEX') || nm === 'SENSEX';
  }
  if (ex !== 'MCX') return false;
  return sym.startsWith('CRUDEOILM') || nm === 'CRUDEOILM' || sym.startsWith('CRUDEOIL');
}

function lotOf(item: Instrument, book: Option14kBookId): number {
  if (book === 'crude') return crudeMiniLotSize(item.lotSize);
  const n = Math.floor(Number(item.lotSize) || 0);
  return n > 0 ? n : OPTION_14K_BOOKS[book].lot;
}

function roundStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

function nextFriday(day: Date, rollSameDay: boolean): Date {
  const dow = day.getDay();
  let add = (5 - dow + 7) % 7;
  if (add === 0 && rollSameDay) add = 7;
  const exp = new Date(day);
  exp.setDate(exp.getDate() + add);
  return exp;
}

function syntheticExpiry(book: Option14kBookId, day: Date): Date {
  if (book === 'sensex') return nextFriday(day, true);
  const exp = new Date(day);
  exp.setDate(exp.getDate() + (book === 'bank' ? 28 : 7));
  return exp;
}

function buildSynthetic(
  book: Option14kBookId,
  side: CheapOtmSide,
  strike: number,
  expiry: Date,
): Instrument {
  const plan = OPTION_14K_BOOKS[book];
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${plan.name} OTM ${strike} ${side}`,
    name: plan.name,
    exchange: plan.exchange,
    segment: `${plan.exchange}-OPT`,
    instrumentType: side,
    expiry: formatExpiryIso(expiry),
    strike,
    tickSize: 0.05,
    lotSize: plan.lot,
    lastPrice: plan.targetPremRs,
  };
}

function toPick(item: Instrument, book: Option14kBookId, source: 'chain' | 'synthetic', budget: number): CheapOtmPick {
  const side = item.instrumentType.toUpperCase() === 'PE' ? 'PE' : 'CE';
  const lotSize = lotOf(item, book);
  const lastPrice = Number(item.lastPrice) || OPTION_14K_BOOKS[book].targetPremRs;
  const openCostRs = Math.round(lastPrice * lotSize);
  return {
    instrument: item,
    source,
    side,
    strike: item.strike,
    expiry: item.expiry,
    lotSize,
    lastPrice,
    openCostRs,
    fitsBudget: openCostRs > 0 && openCostRs <= budget,
  };
}

export function pickCheapOtm(params: {
  instruments: Instrument[];
  book: Option14kBookId;
  direction: 'BUY' | 'SELL';
  spot: number;
  asOf: Date;
  premiumBudgetRs?: number;
  /** Override the plan's OTM distance (0 = ATM). */
  otmPts?: number;
}): CheapOtmPick {
  const plan = OPTION_14K_BOOKS[params.book];
  const budget = params.premiumBudgetRs ?? OPTION_14K_PREMIUM_BUDGET_RS;
  const side: CheapOtmSide = params.direction === 'BUY' ? 'CE' : 'PE';
  const day = params.book === 'crude' ? crudeIstCalendarDay(params.asOf) : asOfDay(params.asOf);
  const atm = roundStrike(params.spot, plan.strikeStep);
  const otm = params.otmPts ?? plan.otmPts;
  const target = side === 'CE' ? atm + otm : atm - otm;
  const want = roundStrike(target, plan.strikeStep);

  const pool = params.instruments
    .filter((item) => isBookOption(item, params.book) && item.instrumentType.toUpperCase() === side)
    .map((item) => ({ item, exp: parseExpiry(item.expiry) }))
    .filter((row): row is { item: Instrument; exp: Date } => row.exp != null && row.exp.getTime() > day.getTime())
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  const front = pool[0]?.exp ?? null;
  const frontPool = front ? pool.filter((row) => row.exp.getTime() === front.getTime()) : [];

  const scored = frontPool
    .map((row) => {
      const strike = row.item.strike;
      const otmOk = side === 'CE' ? strike >= atm : strike <= atm;
      const dist = Math.abs(strike - want);
      const last = Number(row.item.lastPrice) || 0;
      const cost = last > 0 ? last * lotOf(row.item, params.book) : plan.openCostRs;
      const over = cost > budget ? 1 : 0;
      return { row, otmOk, dist, over, cost };
    })
    .sort((a, b) => a.over - b.over || Number(b.otmOk) - Number(a.otmOk) || a.dist - b.dist);

  if (scored[0]) {
    return toPick(scored[0].row.item, params.book, 'chain', budget);
  }

  const synExp = front ?? syntheticExpiry(params.book, day);
  return toPick(buildSynthetic(params.book, side, want, synExp), params.book, 'synthetic', budget);
}
