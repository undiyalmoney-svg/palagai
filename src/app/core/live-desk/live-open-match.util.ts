import type { PaperOptionContract } from '../paper-desk/paper-desk.models';

export interface LiveOpenMatchPos {
  status: 'open' | 'exiting' | 'flat' | 'error';
  tradingSymbol: string;
  entryTime: string;
  direction: 'BUY' | 'SELL';
}

export interface LiveOpenMatchSignal {
  direction: 'BUY' | 'SELL';
  entryTime: string;
  option: Pick<PaperOptionContract, 'tradingSymbol'> | null;
}

/**
 * True when the broker already holds this leg, so the desk should only amend
 * the protective SL.
 *
 * The contract is identified by **option symbol alone**. Selling a contract and
 * buying the same one back is never an improvement — it pays the bid/ask spread
 * and re-enters worse. So a changed entryTime (drain→rehunt) or a direction
 * label difference on the same symbol is a hold, not a handoff.
 *
 * A real handoff is only a *different* contract (Kutty→Strat, new strike/expiry).
 *
 * 2026-08-07: with the old entryTime rule, NIFTY 24600 PE was sold at 116.85 and
 * bought back at 118.70 twenty-nine seconds later, and an adopted position (whose
 * entryTime is stamped at adopt time) would be round-tripped on every restart.
 */
export function liveOpenMatchesBroker(
  pos: LiveOpenMatchPos,
  open: LiveOpenMatchSignal,
): boolean {
  if (pos.status !== 'open') {
    return false;
  }
  const posSym = (pos.tradingSymbol || '').toUpperCase();
  const openSym = (open.option?.tradingSymbol || '').toUpperCase();
  if (posSym && openSym) {
    return posSym === openSym;
  }
  // Symbol unknown on one side — fall back to the old shape checks.
  if (pos.entryTime && open.entryTime && pos.entryTime !== open.entryTime) {
    return false;
  }
  if (pos.direction && open.direction && pos.direction !== open.direction) {
    return false;
  }
  return true;
}
