import {
  applyProtectCloses,
  decideProtectAuto,
  emptyProtectDay,
  htfAllowsProtect,
  inProtectWindow,
  loadProtectDay,
  markProtectPlaced,
  parseProtectDay,
  protectBookArmed,
  protectStatusLine,
} from './chart-protect.util';

const today = '2026-10-02';

function base(over: Partial<Parameters<typeof decideProtectAuto>[0]> = {}) {
  return {
    book: 'nifty' as const,
    type: 'BUY' as const,
    liveDay: true,
    marketOpen: true,
    busy: false,
    htfTrend: 'bullish' as const,
    istTime: '10:15',
    day: emptyProtectDay(today),
    openBooks: [] as const,
    ...over,
  };
}

describe('chart protect', () => {
  it('lets the first HTF-aligned index BUY through after 09:50', () => {
    const hit = decideProtectAuto(base());
    expect(hit.allow).toBe(true);
  });

  it('sits out 5m sideways and a BUY against a bearish 5m', () => {
    expect(decideProtectAuto(base({ htfTrend: 'sideways' })).allow).toBe(false);
    expect(decideProtectAuto(base({ htfTrend: null })).allow).toBe(false);
    expect(decideProtectAuto(base({ htfTrend: 'bearish' })).allow).toBe(false);
    expect(htfAllowsProtect('SELL', 'bearish')).toBe(true);
    expect(htfAllowsProtect('BUY', 'bearish')).toBe(false);
  });

  it('skips the open chop and the last 15 minutes on Nifty and Bank', () => {
    expect(inProtectWindow('nifty', '09:49')).toBe(false);
    expect(inProtectWindow('bank', '09:50')).toBe(true);
    expect(inProtectWindow('nifty', '15:14')).toBe(true);
    expect(inProtectWindow('nifty', '15:15')).toBe(false);
    expect(decideProtectAuto(base({ istTime: '09:30' })).allow).toBe(false);
  });

  it('keeps Crude off during NSE hours and arms it after 15:30', () => {
    expect(inProtectWindow('crude', '11:00')).toBe(false);
    expect(inProtectWindow('crude', '15:30')).toBe(true);
    expect(inProtectWindow('crude', '20:59')).toBe(true);
    expect(inProtectWindow('crude', '21:00')).toBe(false);
    expect(
      decideProtectAuto(
        base({
          book: 'crude',
          type: 'SELL',
          htfTrend: 'bearish',
          istTime: '11:00',
        }),
      ).allow,
    ).toBe(false);
    expect(
      decideProtectAuto(
        base({
          book: 'crude',
          type: 'SELL',
          htfTrend: 'bearish',
          istTime: '19:10',
        }),
      ).allow,
    ).toBe(true);
  });

  it('blocks a second fill on the same book and the other NSE book', () => {
    const afterNifty = markProtectPlaced(emptyProtectDay(today), 'nifty');
    expect(afterNifty.nseBook).toBe('nifty');
    expect(decideProtectAuto(base({ day: afterNifty })).allow).toBe(false);
    expect(
      decideProtectAuto(
        base({
          book: 'bank',
          type: 'SELL',
          htfTrend: 'bearish',
          day: afterNifty,
        }),
      ).allow,
    ).toBe(false);
    expect(
      decideProtectAuto(
        base({
          book: 'crude',
          type: 'SELL',
          htfTrend: 'bearish',
          istTime: '19:10',
          day: afterNifty,
        }),
      ).allow,
    ).toBe(true);
  });

  it('refuses a new Auto while any Charts fill is still open', () => {
    expect(decideProtectAuto(base({ openBooks: ['nifty'] })).allow).toBe(false);
    expect(
      decideProtectAuto(
        base({
          book: 'bank',
          type: 'SELL',
          htfTrend: 'bearish',
          openBooks: ['nifty'],
        }),
      ).allow,
    ).toBe(false);
  });

  it('locks the book once the Protect fill has closed', () => {
    const placed = markProtectPlaced(emptyProtectDay(today), 'bank');
    const stillOpen = applyProtectCloses(placed, [{ book: 'bank', status: 'OPEN' }]);
    expect(stillOpen.done.bank).toBe(false);
    const closed = applyProtectCloses(placed, [{ book: 'bank', status: 'TP_HIT' }]);
    expect(closed.done.bank).toBe(true);
    expect(
      decideProtectAuto(
        base({
          book: 'bank',
          type: 'SELL',
          htfTrend: 'bearish',
          day: closed,
        }),
      ).allow,
    ).toBe(false);
  });

  it('does not arm a book that already placed, even before the close is seen', () => {
    const day = markProtectPlaced(emptyProtectDay(today), 'nifty');
    expect(protectBookArmed('nifty', day, '10:15')).toBe(false);
    expect(protectBookArmed('bank', day, '10:15')).toBe(false);
    expect(protectBookArmed('crude', day, '10:15')).toBe(false);
    expect(protectBookArmed('crude', day, '16:00')).toBe(true);
  });

  it('forgets yesterday and keeps today', () => {
    const packed = {
      date: '2026-10-01',
      nseBook: 'nifty',
      placed: { nifty: true, bank: false, crude: false },
      done: { nifty: true, bank: false, crude: false },
    };
    expect(parseProtectDay(packed, today)).toEqual(emptyProtectDay(today));
    expect(parseProtectDay({ ...packed, date: today }, today).nseBook).toBe('nifty');
    const storage = {
      getItem: () => JSON.stringify({ ...packed, date: today }),
    };
    expect(loadProtectDay(storage, today).placed.nifty).toBe(true);
    expect(loadProtectDay(null, today)).toEqual(emptyProtectDay(today));
  });

  it('names the sit-out so the toggle is not a black box', () => {
    expect(
      protectStatusLine({
        on: false,
        liveDay: true,
        istTime: '10:15',
        day: emptyProtectDay(today),
        openBooks: [],
        trends: {},
      }),
    ).toMatch(/Protect off/);
    expect(
      protectStatusLine({
        on: true,
        liveDay: true,
        istTime: '09:20',
        day: emptyProtectDay(today),
        openBooks: [],
        trends: { nifty: 'bullish', bank: 'bullish' },
      }),
    ).toMatch(/09:50/);
    expect(
      protectStatusLine({
        on: true,
        liveDay: true,
        istTime: '10:15',
        day: emptyProtectDay(today),
        openBooks: [],
        trends: { nifty: 'sideways', bank: 'sideways' },
      }),
    ).toMatch(/sideways/);
    const done = applyProtectCloses(markProtectPlaced(emptyProtectDay(today), 'nifty'), []);
    expect(
      protectStatusLine({
        on: true,
        liveDay: true,
        istTime: '11:00',
        day: done,
        openBooks: [],
        trends: {},
      }),
    ).toMatch(/Crude after 15:30/);
  });
});
