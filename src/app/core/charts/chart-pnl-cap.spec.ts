import {
  anyCapSet,
  capDraftFromCaps,
  capSet,
  capsFromDraft,
  capsEqual,
  defaultPnlCaps,
  fillsToFlatten,
  hitChartPnlCap,
  parsePnlCaps,
  parseRsCap,
} from './chart-pnl-cap';

describe('chart pnl caps', () => {
  it('treats blank, zero and junk as unset so the system stop/target stay in force', () => {
    expect(parseRsCap('')).toBeNull();
    expect(parseRsCap(0)).toBeNull();
    expect(parseRsCap(-50)).toBeNull();
    expect(parseRsCap('abc')).toBeNull();
    expect(parseRsCap(500)).toBe(500);
    expect(parseRsCap(550)).toBe(550);
    expect(parseRsCap(560)).toBe(560);
    expect(parseRsCap(1000)).toBe(1000);
    expect(parseRsCap(2000)).toBe(2000);
    expect(parseRsCap('1,250.5')).toBe(1250.5);
  });

  it('loads one cap pair per book and defaults the rest to unset', () => {
    expect(defaultPnlCaps()).toEqual({
      nifty: { maxProfitRs: null, maxLossRs: null },
      bank: { maxProfitRs: null, maxLossRs: null },
      crude: { maxProfitRs: null, maxLossRs: null },
    });
    const parsed = parsePnlCaps({
      nifty: { maxProfitRs: 800, maxLossRs: 400 },
      bank: { maxProfitRs: 0 },
    });
    expect(parsed.nifty).toEqual({ maxProfitRs: 800, maxLossRs: 400 });
    expect(parsed.bank).toEqual({ maxProfitRs: null, maxLossRs: null });
    expect(parsed.crude).toEqual({ maxProfitRs: null, maxLossRs: null });
    expect(capSet(parsed.nifty)).toBe(true);
    expect(capSet(parsed.bank)).toBe(false);
    expect(anyCapSet(parsed)).toBe(true);
  });

  it('fires only when that side is set and THIS fill has crossed it', () => {
    const cap = { maxProfitRs: 500, maxLossRs: 300 };
    expect(hitChartPnlCap(120, cap)).toBeNull();
    expect(hitChartPnlCap(500, cap)).toBe('PROFIT');
    expect(hitChartPnlCap(501, cap)).toBe('PROFIT');
    expect(hitChartPnlCap(-300, cap)).toBe('LOSS');
    expect(hitChartPnlCap(-301, cap)).toBe('LOSS');
    expect(hitChartPnlCap(800, { maxProfitRs: null, maxLossRs: 300 })).toBeNull();
    expect(hitChartPnlCap(-800, { maxProfitRs: 500, maxLossRs: null })).toBeNull();
    expect(hitChartPnlCap(null, cap)).toBeNull();
    expect(hitChartPnlCap(550, { maxProfitRs: 550, maxLossRs: 560 })).toBe('PROFIT');
    expect(hitChartPnlCap(-560, { maxProfitRs: 550, maxLossRs: 560 })).toBe('LOSS');
    expect(hitChartPnlCap(2000, { maxProfitRs: 2000, maxLossRs: 1000 })).toBe('PROFIT');
  });

  it('applies each book cap to every new fill, not the day stack', () => {
    const caps = {
      nifty: { maxProfitRs: 500, maxLossRs: 500 },
      bank: { maxProfitRs: 300, maxLossRs: 300 },
      crude: { maxProfitRs: 300, maxLossRs: 300 },
    };
    const crudeLoss = {
      id: 'crude:1',
      status: 'OPEN',
      book: 'crude' as const,
      pnl: -300,
    };
    expect(fillsToFlatten([crudeLoss], caps)).toEqual([{ id: 'crude:1', reason: 'LOSS' }]);
    expect(fillsToFlatten([{ ...crudeLoss, status: 'EXITED' }], caps)).toEqual([]);

    const nextCrude = {
      id: 'crude:2',
      status: 'OPEN',
      book: 'crude' as const,
      pnl: 300,
    };
    expect(fillsToFlatten([nextCrude], caps, ['crude:1'])).toEqual([
      { id: 'crude:2', reason: 'PROFIT' },
    ]);
    expect(fillsToFlatten([{ ...nextCrude, pnl: -300 }], caps)).toEqual([
      { id: 'crude:2', reason: 'LOSS' },
    ]);

    const nifty = { id: 'nifty:1', status: 'OPEN', book: 'nifty' as const, pnl: 300 };
    expect(fillsToFlatten([nifty], caps)).toEqual([]);
    expect(fillsToFlatten([{ ...nifty, pnl: 500 }], caps)).toEqual([
      { id: 'nifty:1', reason: 'PROFIT' },
    ]);
    expect(
      fillsToFlatten([{ id: 'bank:1', status: 'OPEN', book: 'bank' as const, pnl: -300 }], caps),
    ).toEqual([{ id: 'bank:1', reason: 'LOSS' }]);
  });

  it('saves typed amounts only when they are committed from the draft', () => {
    const draft = capDraftFromCaps({
      nifty: { maxProfitRs: 550, maxLossRs: 560 },
      bank: { maxProfitRs: 1000, maxLossRs: 2000 },
      crude: { maxProfitRs: null, maxLossRs: null },
    });
    expect(draft.nifty).toEqual({ maxProfitRs: '550', maxLossRs: '560' });
    expect(draft.crude).toEqual({ maxProfitRs: '', maxLossRs: '' });
    const next = capsFromDraft({
      ...draft,
      crude: { maxProfitRs: '560', maxLossRs: '550' },
    });
    expect(next.crude).toEqual({ maxProfitRs: 560, maxLossRs: 550 });
    expect(capsEqual(next, capsFromDraft(capDraftFromCaps(next)))).toBe(true);
  });
});
