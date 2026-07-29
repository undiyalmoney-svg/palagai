import { PaperInstrumentStatus } from '../paper-desk/paper-desk.models';

export type LiveAssistantTone =
  | 'closed'
  | 'scanning'
  | 'waiting'
  | 'in_trade'
  | 'blocked'
  | 'done';

export interface LiveAssistantLine {
  name: string;
  text: string;
}

export interface LiveAssistantView {
  tone: LiveAssistantTone;
  headline: string;
  detail: string;
  lines: LiveAssistantLine[];
}

export function isQuietSignal(lastSignal: string | null | undefined): boolean {
  const s = (lastSignal || '').trim().toLowerCase();
  return !s || s === 'waiting' || s === 'idle' || s.startsWith('preview atm');
}

export function describeStatusForAssistant(
  s: PaperInstrumentStatus,
  realOrders: boolean,
): string {
  const strat = s.strategyName || 'assigned strategy';
  if (s.openTrade) {
    const o = s.openTrade;
    if (realOrders && !s.brokerEntryOrderId) {
      return `Signal ${o.direction} @ ${o.indexEntry.toFixed(1)} — not on Kite${
        s.kiteBlockReason ? ` (${s.kiteBlockReason})` : ''
      }`;
    }
    return `In trade ${o.direction} · entry ${o.indexEntry.toFixed(1)} → tgt ${o.indexTarget.toFixed(1)} · SL ${o.indexStop.toFixed(1)}`;
  }
  if (s.livePhase === 'target_hit') {
    return `Target hit earlier · ${s.lastExitReason || 'closed'} · back to scan`;
  }
  if (s.livePhase === 'sl_hit') {
    return `Stop hit earlier · ${s.lastExitReason || 'closed'} · back to scan`;
  }
  if (s.livePhase === 'exited') {
    return `Exited · ${s.lastExitReason || 'closed'} · scanning again`;
  }
  const signal = (s.lastSignal || '').trim();
  if (isQuietSignal(signal)) {
    return `Scanning ${strat} — no trigger yet (quiet / flat vs rules)`;
  }
  if (/kutty wait/i.test(signal)) {
    return signal;
  }
  if (/max trades|day stop|day stopped/i.test(signal)) {
    return signal;
  }
  return `Watching ${strat}: ${signal}`;
}

export function buildLiveAssistant(params: {
  running: boolean;
  marketOpen: boolean;
  realOrders: boolean;
  message: string;
  statuses: PaperInstrumentStatus[];
}): LiveAssistantView | null {
  if (!params.running) {
    return null;
  }

  const money = params.realOrders ? 'Live money' : 'Live paper';
  const statuses = params.statuses;
  const lines = statuses.map((s) => ({
    name: s.instrumentName,
    text: describeStatusForAssistant(s, params.realOrders),
  }));

  if (!params.marketOpen) {
    return {
      tone: 'closed',
      headline: 'Outside market hours',
      detail:
        params.message ||
        'Live desk only runs 09:15–15:30 IST. Start again when the cash market is open.',
      lines,
    };
  }

  const blocked = statuses.filter(
    (s) => !!s.openTrade && params.realOrders && !s.brokerEntryOrderId && !!s.kiteBlockReason,
  );
  if (blocked.length) {
    return {
      tone: 'blocked',
      headline: 'Signal found — not on Kite yet',
      detail: `${money}: desk has a trade idea but the broker entry is blocked. Check Event log / refresh Instruments.`,
      lines,
    };
  }

  const onBroker = statuses.filter(
    (s) => !!s.openTrade && (!params.realOrders || !!s.brokerEntryOrderId),
  );
  if (onBroker.length) {
    return {
      tone: 'in_trade',
      headline: params.realOrders ? 'In trade on Kite' : 'In paper trade',
      detail: `${money}: managing open leg(s) — watching target, SL, protect rules, and session exit.`,
      lines,
    };
  }

  const deskOnly = statuses.filter((s) => !!s.openTrade);
  if (deskOnly.length) {
    return {
      tone: 'waiting',
      headline: 'Entry signal — confirming',
      detail: `${money}: strategy fired; waiting for the next tick / broker confirm.`,
      lines,
    };
  }

  const done = statuses.filter(
    (s) => s.livePhase === 'target_hit' || s.livePhase === 'sl_hit' || s.livePhase === 'exited',
  );
  const waiting = statuses.filter((s) => s.livePhase === 'waiting' || s.livePhase === 'idle');

  if (waiting.length && done.length === statuses.length - waiting.length) {
    const quiet = waiting.every((s) => isQuietSignal(s.lastSignal));
    return {
      tone: quiet ? 'scanning' : 'waiting',
      headline: quiet ? 'Scanning — no setup yet' : 'Looking for entry',
      detail: quiet
        ? `${money}: desk is alive and scanning each tick. Market has not given a strategy trigger yet (looks quiet / flat vs rules).`
        : `${money}: scanning each tick for ${waiting.map((s) => s.strategyName || 'strategy').join(' / ')}. Setup filters are active — waiting for a clean entry.`,
      lines,
    };
  }

  if (done.length && !waiting.length) {
    return {
      tone: 'done',
      headline: 'Session legs closed',
      detail: `${money}: no open trade right now. Desk keeps scanning if still inside hours.`,
      lines,
    };
  }

  return {
    tone: 'scanning',
    headline: 'Live desk running',
    detail: `${money}: scanning for opportunities on each tick (about every 60s).`,
    lines,
  };
}
