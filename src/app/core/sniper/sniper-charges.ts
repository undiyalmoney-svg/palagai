import { ChargeVenue, optionChargeBreakdown } from '../paper-desk/option-charges.util';
import { SniperCharges } from './sniper.models';

const zero: SniperCharges = {
  entryTurnover: 0,
  exitTurnover: 0,
  brokerage: 0,
  stt: 0,
  exchange: 0,
  sebi: 0,
  stamp: 0,
  ipft: 0,
  gst: 0,
  total: 0,
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Zerodha option long round trip, split for the dashboard. Charges once. */
export function sniperCharges(entry: number, exit: number, qty: number, venue: ChargeVenue): SniperCharges {
  if (!(qty > 0) || !(entry > 0) || !(exit >= 0)) return { ...zero };
  const raw = optionChargeBreakdown(entry, exit, qty, venue);
  const entryTurnover = r2(entry * qty);
  const exitTurnover = r2(exit * qty);
  return {
    entryTurnover,
    exitTurnover,
    brokerage: r2(raw.brokerage),
    stt: r2(raw.sttCtt),
    exchange: r2(raw.exchangeTxn),
    sebi: r2(raw.sebi),
    stamp: r2(raw.stamp),
    ipft: r2(raw.ipft),
    gst: r2(raw.gst),
    total: r2(raw.total),
  };
}

export function sniperGrossRs(entry: number, exit: number, qty: number): number {
  return r2((exit - entry) * qty);
}

export function sniperNetRs(entry: number, exit: number, qty: number, venue: ChargeVenue): number {
  const gross = sniperGrossRs(entry, exit, qty);
  const ch = sniperCharges(entry, exit, qty, venue);
  return r2(gross - ch.total);
}
