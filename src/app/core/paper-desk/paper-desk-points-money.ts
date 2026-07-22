import {
  PDHL_BANK_RUPEES_PER_POINT,
  PDHL_RUPEES_PER_POINT,
  rupeesPerPointForInstrument,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { PaperTrade } from './paper-desk.models';

/** Research / Ruler money scale: Nifty ₹65/pt · Bank ₹30/pt × lots. */
export function indexPointsMoneyRs(
  indexPoints: number,
  instrumentId: string | null | undefined,
  lots: number,
): number {
  const rs = rupeesPerPointForInstrument(instrumentId);
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  return indexPoints * rs * lotMult;
}

/** Sum research-scale pts money across paper trades (per-instrument ₹65/₹30). */
export function sumPointsMoneyRs(trades: PaperTrade[], lots: number): number {
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  return trades.reduce(
    (a, t) => a + indexPointsMoneyRs(t.indexPoints, t.instrumentId, lotMult),
    0,
  );
}

export function pointsMoneyLabel(): string {
  return `Pts money ₹ (Nifty ₹${PDHL_RUPEES_PER_POINT} · Bank ₹${PDHL_BANK_RUPEES_PER_POINT})`;
}
