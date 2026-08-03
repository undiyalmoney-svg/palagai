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
  /** Optional lots label (e.g. "1 lot"). */
  meta?: string;
}

export interface LiveAssistantView {
  tone: LiveAssistantTone;
  headline: string;
  detail: string;
  lines: LiveAssistantLine[];
  /** Clock rules for mixed index + MCX desks. */
  clockNote?: string;
  /** Plain-language next action. */
  nextAction?: string;
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
  if (/index session closed|session closed/i.test(signal)) {
    return signal;
  }
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

function isCrudeStatus(s: PaperInstrumentStatus): boolean {
  const id = (s.instrumentId || '').toLowerCase();
  const name = (s.instrumentName || '').toLowerCase();
  return id.includes('crude') || name.includes('crude');
}

function isNatGasStatus(s: PaperInstrumentStatus): boolean {
  const id = (s.instrumentId || '').toLowerCase();
  const name = (s.instrumentName || '').toLowerCase();
  return (
    id.includes('natgas') ||
    name.includes('nat gas') ||
    name.includes('natural gas') ||
    name.includes('natgas')
  );
}

function isMcxStatus(s: PaperInstrumentStatus): boolean {
  return isCrudeStatus(s) || isNatGasStatus(s);
}

function buildClockNote(params: {
  nowHhMm?: string;
  hasIndex: boolean;
  hasCrude: boolean;
  hasNatGas: boolean;
}): string | undefined {
  const hasMcx = params.hasCrude || params.hasNatGas;
  if (!params.hasIndex && !hasMcx) {
    return undefined;
  }
  const mcxBits = [
    params.hasCrude ? 'Crude All-Green' : null,
    params.hasNatGas ? 'Nat Gas Daily Profit' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  if (params.hasIndex && hasMcx) {
    return `Clock · Index books until 15:15 · ${mcxBits} continues on MCX to ~23:10`;
  }
  if (hasMcx) {
    return `Clock · ${mcxBits} · entries ~09:00–23:00 · force exit ~23:10`;
  }
  return 'Clock · Index books 09:15–15:15 · no new entries after session exit';
}

function buildNextAction(params: {
  tone: LiveAssistantTone;
  realOrders: boolean;
  statuses: PaperInstrumentStatus[];
  hasCrude: boolean;
  hasNatGas: boolean;
  nowHhMm?: string;
}): string {
  const now = params.nowHhMm ?? '';
  const hasMcx = params.hasCrude || params.hasNatGas;
  if (params.tone === 'blocked') {
    return 'Fix the Kite block (Instruments / Event log), then wait for the next tick.';
  }
  if (params.tone === 'in_trade') {
    return params.realOrders
      ? 'Managing open Kite leg(s) — protective SL is live; desk exits cancel SL then SELL the long.'
      : 'Managing paper leg(s) — watching target, SL, protect rules, and session exit.';
  }
  if (hasMcx && now >= '15:15' && now <= '23:15') {
    const mcxOpen = params.statuses.find((s) => isMcxStatus(s) && !!s.openTrade);
    if (mcxOpen) {
      return 'Index session stopped · MCX book still in trade through evening.';
    }
    const labels = [
      params.hasCrude ? 'Crude All-Green' : null,
      params.hasNatGas ? 'Nat Gas Daily Profit' : null,
    ]
      .filter(Boolean)
      .join(' / ');
    return `Index session stopped · ${labels} still scanning MCX evening.`;
  }
  if (params.tone === 'closed') {
    return 'Start again when a selected book is inside its market hours.';
  }
  if (params.tone === 'done') {
    return 'No open trade — desk keeps scanning while hours remain.';
  }
  return 'Waiting for the next clean entry on an enabled book.';
}

export function buildLiveAssistant(params: {
  running: boolean;
  marketOpen: boolean;
  realOrders: boolean;
  message: string;
  statuses: PaperInstrumentStatus[];
  /** Optional IST HH:mm for clock copy. */
  nowHhMm?: string;
  /** Optional lots labels keyed by instrument id or name fragment. */
  lotsByBook?: { nifty?: number; bank?: number; crude?: number; natgas?: number };
}): LiveAssistantView | null {
  if (!params.running) {
    return null;
  }

  const money = params.realOrders ? 'Live money' : 'Live paper';
  const statuses = params.statuses;
  const hasCrude = statuses.some(isCrudeStatus);
  const hasNatGas = statuses.some(isNatGasStatus);
  const hasMcx = hasCrude || hasNatGas;
  const hasIndex = statuses.some((s) => !isMcxStatus(s));
  const clockNote = buildClockNote({
    nowHhMm: params.nowHhMm,
    hasIndex,
    hasCrude,
    hasNatGas,
  });

  const lotsMeta = (s: PaperInstrumentStatus): string | undefined => {
    const lots = params.lotsByBook;
    if (!lots) {
      return undefined;
    }
    if (isNatGasStatus(s) && lots.natgas != null) {
      return `${lots.natgas} lot${lots.natgas > 1 ? 's' : ''}`;
    }
    if (isCrudeStatus(s) && lots.crude != null) {
      return `${lots.crude} lot${lots.crude > 1 ? 's' : ''}`;
    }
    const id = (s.instrumentId || '').toLowerCase();
    if ((id.includes('bank') || s.instrumentName.toLowerCase().includes('bank')) && lots.bank != null) {
      return `${lots.bank} lot${lots.bank > 1 ? 's' : ''}`;
    }
    if (lots.nifty != null) {
      return `${lots.nifty} lot${lots.nifty > 1 ? 's' : ''}`;
    }
    return undefined;
  };

  const lines = statuses.map((s) => ({
    name: s.instrumentName,
    text: describeStatusForAssistant(s, params.realOrders),
    meta: lotsMeta(s),
  }));

  if (!params.marketOpen) {
    const view: LiveAssistantView = {
      tone: 'closed',
      headline: 'Outside market hours',
      detail:
        params.message ||
        (hasMcx
          ? 'No selected book is inside hours right now (Index 09:15–15:30 · MCX ~09:00–23:15).'
          : 'Live desk only runs 09:15–15:30 IST. Start again when the cash market is open.'),
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  const blocked = statuses.filter(
    (s) => !!s.openTrade && params.realOrders && !s.brokerEntryOrderId && !!s.kiteBlockReason,
  );
  if (blocked.length) {
    const view: LiveAssistantView = {
      tone: 'blocked',
      headline: 'Signal found — not on Kite yet',
      detail: `${money}: desk has a trade idea but the broker entry is blocked. Check Event log / refresh Instruments.`,
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  const onBroker = statuses.filter(
    (s) => !!s.openTrade && (!params.realOrders || !!s.brokerEntryOrderId),
  );
  if (onBroker.length) {
    const view: LiveAssistantView = {
      tone: 'in_trade',
      headline: params.realOrders ? 'In trade on Kite' : 'In paper trade',
      detail: `${money}: managing open leg(s) — watching target, SL, protect rules, and session exit.`,
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  const deskOnly = statuses.filter((s) => !!s.openTrade);
  if (deskOnly.length) {
    const view: LiveAssistantView = {
      tone: 'waiting',
      headline: 'Entry signal — confirming',
      detail: `${money}: strategy fired; waiting for the next tick / broker confirm.`,
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  const done = statuses.filter(
    (s) => s.livePhase === 'target_hit' || s.livePhase === 'sl_hit' || s.livePhase === 'exited',
  );
  const waiting = statuses.filter((s) => s.livePhase === 'waiting' || s.livePhase === 'idle');

  if (waiting.length && done.length === statuses.length - waiting.length) {
    const quiet = waiting.every((s) => isQuietSignal(s.lastSignal));
    const view: LiveAssistantView = {
      tone: quiet ? 'scanning' : 'waiting',
      headline: quiet ? 'Scanning — no setup yet' : 'Looking for entry',
      detail: quiet
        ? `${money}: desk is alive and scanning each tick. Market has not given a strategy trigger yet (looks quiet / flat vs rules).`
        : `${money}: scanning each tick for ${waiting.map((s) => s.strategyName || 'strategy').join(' / ')}. Setup filters are active — waiting for a clean entry.`,
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  if (done.length && !waiting.length) {
    const view: LiveAssistantView = {
      tone: 'done',
      headline: 'Session legs closed',
      detail: `${money}: no open trade right now. Desk keeps scanning if still inside hours.`,
      lines,
      clockNote,
    };
    view.nextAction = buildNextAction({
      tone: view.tone,
      realOrders: params.realOrders,
      statuses,
      hasCrude,
      hasNatGas,
      nowHhMm: params.nowHhMm,
    });
    return view;
  }

  const view: LiveAssistantView = {
    tone: 'scanning',
    headline: 'Live desk running',
    detail: `${money}: scanning for opportunities on each tick (about every 60s).`,
    lines,
    clockNote,
  };
  view.nextAction = buildNextAction({
    tone: view.tone,
    realOrders: params.realOrders,
    statuses,
    hasCrude,
    hasNatGas,
    nowHhMm: params.nowHhMm,
  });
  return view;
}
