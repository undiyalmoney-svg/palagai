import { describe, expect, it } from 'vitest';
import { PaperInstrumentStatus } from './paper-desk.models';
import { buildLiveAssistant, describeStatusForAssistant, isQuietSignal } from './live-assistant.util';

function status(
  partial: Partial<PaperInstrumentStatus> & Pick<PaperInstrumentStatus, 'instrumentName'>,
): PaperInstrumentStatus {
  return {
    instrumentId: partial.instrumentId ?? partial.instrumentName,
    instrumentName: partial.instrumentName,
    lastBarTime: null,
    dayNetIndexPts: 0,
    dayNetOptionRs: 0,
    openTrade: partial.openTrade ?? null,
    chosenOption: null,
    chosenBias: null,
    indexSpot: null,
    chosenAsOf: null,
    lastSignal: partial.lastSignal ?? 'Waiting',
    lastExitReason: partial.lastExitReason ?? null,
    lastExitTime: partial.lastExitTime ?? null,
    tradesToday: 0,
    strategyId: 'trap',
    strategyName: partial.strategyName ?? 'Trap',
    maxTradesPerDay: 0,
    livePhase: partial.livePhase ?? 'waiting',
    livePhaseLabel: partial.livePhaseLabel ?? 'Waiting for entry',
    brokerSlTrigger: null,
    brokerSlOrderId: null,
    brokerEntryOrderId: partial.brokerEntryOrderId ?? null,
    kiteBlockReason: partial.kiteBlockReason ?? null,
  };
}

describe('live-assistant.util', () => {
  it('detects quiet waiting signals', () => {
    expect(isQuietSignal('Waiting')).toBe(true);
    expect(isQuietSignal('OR mid not ready')).toBe(false);
  });

  it('says scanning when alive with no setups', () => {
    const view = buildLiveAssistant({
      running: true,
      marketOpen: true,
      realOrders: false,
      message: '',
      statuses: [
        status({ instrumentName: 'Nifty 50', livePhase: 'waiting', lastSignal: 'Waiting' }),
        status({ instrumentName: 'Bank Nifty', livePhase: 'waiting', lastSignal: 'Waiting' }),
      ],
    });
    expect(view?.tone).toBe('scanning');
    expect(view?.headline).toContain('Scanning');
    expect(view?.lines[0]?.text).toContain('no trigger yet');
  });

  it('flags blocked live-money signals', () => {
    const blocked = status({
      instrumentName: 'Nifty 50',
      livePhase: 'in_trade',
      openTrade: {
        direction: 'BUY',
        indexEntry: 24800,
        indexStop: 24770,
        indexTarget: 24860,
        entryTime: '2026-07-29T10:00:00+0530',
        option: null,
        optionEntryPremium: null,
      },
      brokerEntryOrderId: null,
      kiteBlockReason: 'Synthetic/missing NFO option',
    });
    const view = buildLiveAssistant({
      running: true,
      marketOpen: true,
      realOrders: true,
      message: '',
      statuses: [blocked],
    });
    expect(view?.tone).toBe('blocked');
    expect(describeStatusForAssistant(blocked, true)).toContain('not on Kite');
  });

  it('reports in-trade when paper leg is open', () => {
    const view = buildLiveAssistant({
      running: true,
      marketOpen: true,
      realOrders: false,
      message: '',
      statuses: [
        status({
          instrumentName: 'Nifty 50',
          livePhase: 'in_trade',
          openTrade: {
            direction: 'SELL',
            indexEntry: 24800,
            indexStop: 24830,
            indexTarget: 24740,
            entryTime: '2026-07-29T11:00:00+0530',
            option: null,
            optionEntryPremium: null,
          },
        }),
      ],
    });
    expect(view?.tone).toBe('in_trade');
    expect(view?.headline).toContain('paper');
  });
});
