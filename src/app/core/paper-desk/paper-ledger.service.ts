import { Injectable, signal } from '@angular/core';
import { LivePaperFill } from './live-paper.engine';
import { LEDGER_VERSION, LedgerState, emptyLedger, mergeFills, observeDay } from './paper-ledger.util';

const LEDGER_KEY = 'palagai_paper_ledger_v1';

/** Browser-side forward-paper ledger. Append-only: there is deliberately no delete or edit method. */
@Injectable({ providedIn: 'root' })
export class PaperLedgerService {
  readonly state = signal<LedgerState>(read());

  sync(day: string, fills: readonly LivePaperFill[]): void {
    const next = mergeFills(observeDay(this.state(), day), fills);
    if (next === this.state()) return;
    this.state.set(next);
    write(next);
  }
}

function read(): LedgerState {
  try {
    if (typeof localStorage === 'undefined') return emptyLedger();
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as LedgerState;
    if (parsed?.version !== LEDGER_VERSION || !Array.isArray(parsed.trades) || !Array.isArray(parsed.observedDays)) {
      return emptyLedger();
    }
    return parsed;
  } catch {
    return emptyLedger();
  }
}

function write(s: LedgerState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LEDGER_KEY, JSON.stringify(s));
  } catch {
    /* quota */
  }
}
