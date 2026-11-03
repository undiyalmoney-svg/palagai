/**
 * Executable-fill model for a long option round trip. The paper engine fills at last price and at exact
 * stop / target levels; this prices the same trade the way a retail account would actually get filled:
 * buy at the ask, sell stops at the bid, limit targets one tick worse than the level, one adverse tick of
 * slippage per leg, and exact exchange charges. Observed bid / ask are used whenever they were recorded.
 */
import { ExecutionAssumptions, PaperTrade, RealisticFill } from './paper-analytics.models';
import { optionRoundTripCharges, venueForBook } from './option-charges.util';

export const OPTION_TICK = 0.05;

export const DEFAULT_EXECUTION: ExecutionAssumptions = {
  slipTicks: 1,
  fallbackSpreadPct: 0.02,
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function valid(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function modelHalfSpread(price: number, a: ExecutionAssumptions): number {
  return Math.max(OPTION_TICK, (price * a.fallbackSpreadPct) / 2);
}

export function realisticFill(
  t: Pick<PaperTrade, 'book' | 'qty' | 'entry' | 'exit' | 'reason' | 'entryBid' | 'entryAsk' | 'exitBid' | 'exitAsk'>,
  assumptions: ExecutionAssumptions = DEFAULT_EXECUTION,
): RealisticFill {
  const slip = Math.max(0, assumptions.slipTicks) * OPTION_TICK;
  const entryQuoted = valid(t.entryAsk) && valid(t.entryBid) && t.entryAsk >= t.entryBid;
  const entryBase = entryQuoted ? (t.entryAsk as number) : t.entry + modelHalfSpread(t.entry, assumptions);
  const entryFill = r2(entryBase + slip);

  const limitExit = t.reason === 'tp';
  const exitQuoted = valid(t.exitBid) && valid(t.exitAsk) && (t.exitAsk as number) >= (t.exitBid as number);
  let exitBase: number;
  if (limitExit) {
    exitBase = t.exit;
  } else if (exitQuoted) {
    exitBase = Math.min(t.exit, t.exitBid as number);
  } else {
    exitBase = t.exit - modelHalfSpread(t.exit, assumptions);
  }
  const exitFill = r2(Math.max(OPTION_TICK, exitBase - slip));

  const grossRs = r2((exitFill - entryFill) * t.qty);
  const chargesRs = r2(optionRoundTripCharges(entryFill, exitFill, t.qty, venueForBook(t.book)));
  const netRs = r2(grossRs - chargesRs);
  const spreadSlipRs = r2(((entryFill - t.entry) + (t.exit - exitFill)) * t.qty);
  const quality = entryQuoted && (limitExit || exitQuoted) ? 'quoted' : 'modelled';
  return { entryFill, exitFill, grossRs, chargesRs, netRs, spreadSlipRs, quality };
}
