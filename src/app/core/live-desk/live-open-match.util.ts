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
 * True when broker already holds the same paper leg (amend SL only).
 * False when paper flipped (Kutty→Strat yield, drain→rehunt, new option) → exit+re-enter.
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
  if (posSym && openSym && posSym !== openSym) {
    return false;
  }
  if (pos.entryTime && open.entryTime && pos.entryTime !== open.entryTime) {
    return false;
  }
  if (pos.direction && open.direction && pos.direction !== open.direction) {
    return false;
  }
  return true;
}
