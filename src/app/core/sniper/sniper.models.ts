/**
 * Sniper — Bank Nifty PE only.
 * 09:15–09:30 ORB. First 5m close below the range. First 40% red, buy PE when a
 * later 5m high tags that red high. Up-breaks skip the day. One trade. SL ₹750, sell ₹750.
 */
import { ChargeVenue } from '../paper-desk/option-charges.util';

export type SniperUnder = 'bank';
export type SniperMode = 'paper' | 'live';
export type SniperDir = 'green' | 'red' | 'doji';
export type SniperBreak = 'up' | 'down' | '';
export type SniperExit = 'sl' | 'tp' | 'eod' | 'exception';
export type SniperEvent =
  | 'watching'
  | 'orb_break'
  | 'breakout_candle'
  | 'found_entry'
  | 'trade_taken'
  | 'trade_closed'
  | 'parked'
  | 'off';

export const SNIPER_EVENT_STEPS = [
  { id: 'orb_break', label: 'ORB break' },
  { id: 'breakout_candle', label: 'Breakout candle' },
  { id: 'found_entry', label: 'Entry' },
  { id: 'trade_taken', label: 'Trade taken' },
  { id: 'trade_closed', label: 'Trade closed' },
] as const;

const EVENT_RANK: Record<SniperEvent, number> = {
  off: 0,
  watching: 0,
  parked: 0,
  orb_break: 1,
  breakout_candle: 2,
  found_entry: 3,
  trade_taken: 4,
  trade_closed: 5,
};

export function sniperEventRank(event: SniperEvent | '' | undefined): number {
  return EVENT_RANK[(event || 'watching') as SniperEvent] ?? 0;
}

export const SNIPER_STOP_RS = 750;
export const SNIPER_TARGET_RS = 750;
export const SNIPER_DEFAULT_LOTS = 1;
export const SNIPER_BAR_MIN = 5;
export const SNIPER_OR_MIN = 15;
export const SNIPER_OPEN_MIN = 9 * 60 + 15;
export const SNIPER_OR_END_MIN = 9 * 60 + 30;
export const SNIPER_TICK_RS = 0.05;
export const SNIPER_STRONG_RED = 0.4;
export const SNIPER_PULSE_KEEP = 40;

export interface SniperBookCfg {
  id: SniperUnder;
  label: string;
  openMin: number;
  lastEntryMin: number;
  flatMin: number;
  venue: ChargeVenue;
  exchange: 'NFO' | 'BFO';
  underNames: string[];
  underExchange: 'NSE' | 'BSE';
}

export const SNIPER_BOOKS: SniperBookCfg[] = [
  {
    id: 'bank',
    label: 'Bank Nifty',
    openMin: SNIPER_OPEN_MIN,
    lastEntryMin: 15 * 60 + 15,
    flatMin: 15 * 60 + 30,
    venue: 'NSE',
    exchange: 'NFO',
    underNames: ['NIFTY BANK'],
    underExchange: 'NSE',
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

export interface SniperPulse {
  min: number;
  at: string;
  spot: number | null;
  peLast: number | null;
  text: string;
}

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
  breakDir: SniperBreak;
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
  watch: boolean;
  orHigh: number | null;
  orLow: number | null;
  orReady: boolean;
  cut: SniperBreak;
  cutMin: number | null;
  cutColor: SniperDir | '';
  event: SniperEvent;
  bars: SniperBar[];
  capital: number;
  peakCapital: number;
  troughCapital: number;
  side: 'flat' | 'long';
  dir: SniperDir | '';
  breakDir: SniperBreak;
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
  tp: number | null;
  stopRs: number | null;
  indexSl: number | null;
  redHigh: number | null;
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
  spot: number | null;
  minute: SniperBar | null;
  minutes: SniperBar[];
  forming5m: SniperBar | null;
  peBid: number | null;
  peAsk: number | null;
  peLast: number | null;
  pulse: SniperPulse[];
}

export interface SniperSession {
  day: string;
  running: boolean;
  mode: SniperMode;
  paperOn: boolean;
  liveArmed: boolean;
  lots: number;
  stopRs: number;
  targetRs: number;
  selected: SniperUnder | '';
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
  'Bank Nifty PE. Down ORB only. 40% red tagged at its high. One trade. SL ₹750, sell ₹750. Token on the Token page.';
