/**
 * 5-Minute Sniper — independent of Arise. Four books, ₹50,000 each.
 * Fade the previous 5m candle: green → ATM PE, red → ATM CE. Doji skips. ₹100 max loss.
 * Not a guaranteed profit.
 */
import { ChargeVenue } from '../paper-desk/option-charges.util';

export type SniperUnder = 'nifty' | 'bank' | 'sensex' | 'crude';
export type SniperMode = 'replay' | 'paper' | 'live';
export type SniperDir = 'green' | 'red' | 'doji';
export type SniperExit = 'sl' | 'time' | 'eod' | 'exception';

export const SNIPER_CAPITAL_RS = 50_000;
export const SNIPER_MAX_LOSS_RS = 100;
export const SNIPER_BAR_MIN = 5;
/** Missed the open of this 5-minute slot — do not catch up. */
export const SNIPER_ENTRY_GRACE_MIN = 1;
export const SNIPER_TICK_RS = 0.05;
/** Circuit: no new tickets if a book is down half its bank. */
export const SNIPER_DAY_FLOOR_RS = 25_000;

export interface SniperBookCfg {
  id: SniperUnder;
  label: string;
  openMin: number;
  lastEntryMin: number;
  flatMin: number;
  venue: ChargeVenue;
  exchange: 'NFO' | 'BFO' | 'MCX';
  underNames: string[];
  underExchange: 'NSE' | 'BSE' | 'MCX';
}

export const SNIPER_BOOKS: SniperBookCfg[] = [
  {
    id: 'nifty',
    label: 'Nifty 50',
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: 'NSE',
    exchange: 'NFO',
    underNames: ['NIFTY 50'],
    underExchange: 'NSE',
  },
  {
    id: 'bank',
    label: 'Bank Nifty',
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: 'NSE',
    exchange: 'NFO',
    underNames: ['NIFTY BANK'],
    underExchange: 'NSE',
  },
  {
    id: 'sensex',
    label: 'Sensex',
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: 'BSE',
    exchange: 'BFO',
    underNames: ['SENSEX'],
    underExchange: 'BSE',
  },
  {
    id: 'crude',
    label: 'Crude Mini',
    openMin: 9 * 60,
    lastEntryMin: 23 * 60 + 25,
    flatMin: 23 * 60 + 30,
    venue: 'MCX',
    exchange: 'MCX',
    underNames: ['CRUDEOILM'],
    underExchange: 'MCX',
  },
];

export interface SniperBar {
  day: string;
  min: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type SniperQuote = { bid: number | null; ask: number | null; last: number | null };

export type SniperPick = {
  optionType: 'CE' | 'PE';
  strike: number;
  expiry: string;
  optionSymbol: string;
  optionToken: number;
  lotSize: number;
  listed: boolean;
};

export interface SniperCharges {
  entryTurnover: number;
  exitTurnover: number;
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  ipft: number;
  gst: number;
  total: number;
}

export interface SniperFill {
  n: number;
  under: SniperUnder;
  label: string;
  day: string;
  entryAt: string;
  exitAt: string;
  entryMin: number;
  exitMin: number;
  underOpen: number;
  underClose: number;
  dir: SniperDir;
  optionType: 'CE' | 'PE';
  strike: number;
  expiry: string;
  optionSymbol: string;
  entry: number;
  exit: number;
  qty: number;
  lots: number;
  grossRs: number;
  charges: SniperCharges;
  netRs: number;
  capitalAfter: number;
  reason: SniperExit;
  entryBid: number | null;
  entryAsk: number | null;
  exitBid: number | null;
  exitAsk: number | null;
  incomplete: boolean;
}

export interface SniperSkip {
  at: string;
  min: number;
  reason: string;
}

export interface SniperBookState {
  id: SniperUnder;
  label: string;
  capital: number;
  peakCapital: number;
  troughCapital: number;
  side: 'flat' | 'long';
  dir: SniperDir | '';
  optionType: 'CE' | 'PE' | '';
  strike: number | null;
  expiry: string;
  optionSymbol: string;
  optionToken: number;
  lotSize: number;
  lots: number;
  qty: number;
  entry: number | null;
  sl: number | null;
  entryMin: number | null;
  entryAt: string;
  intervalEnd: number | null;
  underOpen: number | null;
  underClose: number | null;
  entryBid: number | null;
  entryAsk: number | null;
  last: number | null;
  liveRs: number;
  status: string;
  reason: string;
  fills: SniperFill[];
  skips: SniperSkip[];
  kiteBuyOrderId: string;
  kiteSlOrderId: string;
  kiteNote: string;
  kiteHalt: boolean;
  exception: boolean;
}

export interface SniperSession {
  day: string;
  running: boolean;
  mode: SniperMode;
  liveArmed: boolean;
  replayDay: string;
  startedAt: string;
  asOf: string;
  source: string;
  kiteError: string | null;
  honest: string;
  books: SniperBookState[];
  incomplete: boolean;
}

export const SNIPER_HONEST =
  '5-Minute Sniper is an experiment, not Arise. Fade the previous completed 5-minute candle: green buys ATM PE, red buys ATM CE, doji skips. ' +
  'Each of Nifty 50, Bank Nifty, Sensex and Crude Mini starts at ₹50,000. Max loss ₹100 per ticket after Kite charges. ' +
  'Index 09:20–15:25 IST. Crude Mini 09:05–23:25 IST on MCX. Paper records on the droplet with the tab closed. ' +
  'Live Kite needs an extra confirm. Not a guaranteed profit.';
