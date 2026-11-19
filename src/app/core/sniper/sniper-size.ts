import { ChargeVenue } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperNetRs } from './sniper-charges';
import { SNIPER_MAX_LOSS_RS, SNIPER_TICK_RS } from './sniper.models';

export type SniperSize = {
  lots: number;
  qty: number;
  sl: number;
  skip: string;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Whole lots only. Skip if one lot cannot fit capital or the ₹100 net stop.
 * Stop premium is the highest exit that still keeps net P/L ≥ −₹100 after Kite charges.
 */
export function sniperSize(
  capital: number,
  premium: number,
  lotSize: number,
  venue: ChargeVenue,
): SniperSize {
  const empty = { lots: 0, qty: 0, sl: 0, skip: '' };
  const lot = Math.floor(Number(lotSize) || 0);
  const px = Number(premium);
  if (!(lot > 0) || !(px > 0)) return { ...empty, skip: 'invalid premium or lot' };
  const qty1 = lot;
  const cost1 = px * qty1;
  if (!(capital >= cost1)) return { ...empty, skip: 'one lot does not fit capital' };
  const scratch = sniperCharges(px, px, qty1, venue).total;
  if (scratch >= SNIPER_MAX_LOSS_RS) return { ...empty, skip: 'charges already at ₹100 risk' };

  let lots = 1;
  while (true) {
    const next = lots + 1;
    const qty = next * lot;
    if (px * qty > capital) break;
    const sl = stopPx(px, qty, venue);
    if (!(sl > 0) || px - sl < SNIPER_TICK_RS) break;
    lots = next;
  }
  const qty = lots * lot;
  const sl = stopPx(px, qty, venue);
  if (!(sl > 0) || sl >= px) return { ...empty, skip: 'cannot place a ₹100 stop on one lot' };
  return { lots, qty, sl: r2(sl), skip: '' };
}

function stopPx(entry: number, qty: number, venue: ChargeVenue): number {
  let lo = SNIPER_TICK_RS;
  let hi = entry;
  let best = 0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const net = sniperNetRs(entry, mid, qty, venue);
    if (net >= -SNIPER_MAX_LOSS_RS) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (!(best > 0)) return 0;
  const tick = SNIPER_TICK_RS;
  let sl = Math.floor(best / tick) * tick;
  while (sl < entry && sniperNetRs(entry, sl, qty, venue) < -SNIPER_MAX_LOSS_RS) {
    sl = r2(sl + tick);
  }
  if (sl >= entry || sniperNetRs(entry, sl, qty, venue) < -SNIPER_MAX_LOSS_RS) return 0;
  return r2(sl);
}
