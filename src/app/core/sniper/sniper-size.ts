import { ChargeVenue } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperNetRs } from './sniper-charges';
import { SNIPER_STOP_RS, SNIPER_TARGET_RS, SNIPER_TICK_RS } from './sniper.models';

export type SniperSize = {
  lots: number;
  qty: number;
  sl: number;
  tp: number;
  skip: string;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stopPx(entry: number, qty: number, venue: ChargeVenue, stopRs: number): number {
  let lo = SNIPER_TICK_RS;
  let hi = entry;
  let best = 0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const net = sniperNetRs(entry, mid, qty, venue);
    if (net >= -stopRs) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (!(best > 0)) return 0;
  const tick = SNIPER_TICK_RS;
  let sl = Math.floor(best / tick) * tick;
  while (sl < entry && sniperNetRs(entry, sl, qty, venue) < -stopRs) {
    sl = r2(sl + tick);
  }
  if (sl >= entry || sniperNetRs(entry, sl, qty, venue) < -stopRs) return 0;
  return r2(sl);
}

function targetPx(entry: number, qty: number, venue: ChargeVenue, targetRs: number): number {
  if (!(qty > 0) || !(targetRs > 0)) return r2(entry);
  let pts = targetRs / qty;
  for (let i = 0; i < 3; i++) {
    const ch = sniperCharges(entry, entry + pts, qty, venue).total;
    pts = (targetRs + ch) / qty;
  }
  const tick = SNIPER_TICK_RS;
  return r2(Math.ceil((entry + pts) / tick) * tick);
}

export function sniperSize(
  lots: number,
  lotSize: number,
  premium: number,
  venue: ChargeVenue,
  stopRs = SNIPER_STOP_RS,
  targetRs = SNIPER_TARGET_RS,
): SniperSize {
  const empty = { lots: 0, qty: 0, sl: 0, tp: 0, skip: '' };
  const n = Math.floor(Number(lots) || 0);
  const lot = Math.floor(Number(lotSize) || 0);
  const px = Number(premium);
  const risk = Number(stopRs) > 0 ? Number(stopRs) : SNIPER_STOP_RS;
  const bank = Number(targetRs) > 0 ? Number(targetRs) : SNIPER_TARGET_RS;
  if (!(n > 0) || !(lot > 0) || !(px > 0)) return { ...empty, skip: 'lots' };
  const qty = n * lot;
  const scratch = sniperCharges(px, px, qty, venue).total;
  if (scratch >= risk) return { ...empty, skip: `charges ₹${Math.round(scratch)} over SL ₹${risk}` };
  const sl = stopPx(px, qty, venue, risk);
  if (!(sl > 0) || sl >= px) return { ...empty, skip: `cannot place ₹${risk} stop` };
  return { lots: n, qty, sl, tp: targetPx(px, qty, venue, bank), skip: '' };
}
