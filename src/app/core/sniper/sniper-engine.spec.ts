import { describe, expect, it } from 'vitest';
import { optionChargeBreakdown } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperNetRs } from './sniper-charges';
import { completedSniperBars, sniperCfg, sniperSlotStarts } from './sniper-clock';
import { candleDir, emptySniperBook, emptySniperSession, sniperFadeType, summarizeSniper, tickSniperBook } from './sniper-engine';
import { SNIPER_BOOKS, SNIPER_CAPITAL_RS, SniperBar, SniperPick } from './sniper.models';
import { sniperSize } from './sniper-size';

const pick = (type: 'CE' | 'PE' = 'CE'): SniperPick => ({
  optionType: type,
  strike: 25000,
  expiry: '2026-11-24',
  optionSymbol: type === 'CE' ? 'NIFTY26NOV25000CE' : 'NIFTY26NOV25000PE',
  optionToken: 11,
  lotSize: 65,
  listed: true,
});

function bar(day: string, min: number, open: number, close: number): SniperBar {
  return { day, min, open, high: Math.max(open, close), low: Math.min(open, close), close };
}

describe('5-Minute Sniper engine', () => {
  it('counts 74 index slots and 173 Crude Mini slots', () => {
    expect(sniperSlotStarts(sniperCfg('nifty'))).toHaveLength(74);
    expect(sniperSlotStarts(sniperCfg('bank'))).toHaveLength(74);
    expect(sniperSlotStarts(sniperCfg('sensex'))).toHaveLength(74);
    expect(sniperSlotStarts(sniperCfg('crude'))).toHaveLength(173);
    expect(sniperCfg('nifty').openMin).toBe(9 * 60 + 15);
    expect(sniperCfg('crude').openMin).toBe(9 * 60);
    expect(SNIPER_BOOKS).toHaveLength(4);
    expect(SNIPER_CAPITAL_RS).toBe(50_000);
  });

  it('maps green to PE fade, red to CE fade, doji skip', () => {
    expect(candleDir(bar('2026-11-19', 555, 100, 101))).toBe('green');
    expect(candleDir(bar('2026-11-19', 555, 100, 99))).toBe('red');
    expect(candleDir(bar('2026-11-19', 555, 100, 100))).toBe('doji');
    expect(sniperFadeType('green')).toBe('PE');
    expect(sniperFadeType('red')).toBe('CE');
    expect(sniperFadeType('doji')).toBeNull();
  });

  it('does not trade an incomplete 5-minute candle', () => {
    const cfg = sniperCfg('nifty');
    const book = emptySniperBook(cfg);
    const bars = [bar('2026-11-19', 555, 24000, 24020)];
    const next = tickSniperBook(book, cfg, bars, '2026-11-19', 9 * 60 + 19, '2026-11-19T03:49:00.000Z', 24020, { bid: 100, ask: 101, last: 100.5 }, pick());
    expect(next.side).toBe('flat');
    expect(next.reason).toMatch(/waiting first candle/);
  });

  it('retries the 09:20 slot when the 09:15 candle is not on the tape yet', () => {
    const cfg = sniperCfg('nifty');
    const waiting = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('PE'),
    );
    expect(waiting.side).toBe('flat');
    expect(waiting.skips).toHaveLength(0);
    expect(waiting.reason).toMatch(/waiting completed candle/);
    const next = tickSniperBook(
      waiting,
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:08.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('PE'),
    );
    expect(next.side).toBe('long');
    expect(next.optionType).toBe('PE');
  });

  it('retries when Kite has no ATM yet instead of burning the slot', () => {
    const cfg = sniperCfg('nifty');
    const waiting = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      { ...pick('PE'), listed: false, optionSymbol: '' },
    );
    expect(waiting.side).toBe('flat');
    expect(waiting.skips).toHaveLength(0);
    expect(waiting.reason).toMatch(/waiting listed ATM/);
  });

  it('buys ATM PE on a completed green candle at 09:20', () => {
    const cfg = sniperCfg('nifty');
    const book = emptySniperBook(cfg);
    const bars = [bar('2026-11-19', 555, 24000, 24020)];
    const next = tickSniperBook(
      book,
      cfg,
      bars,
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('PE'),
    );
    expect(next.side).toBe('long');
    expect(next.optionType).toBe('PE');
    expect(next.entry).toBe(101);
    expect(next.qty).toBeGreaterThan(0);
    expect(next.reason).toMatch(/green fade PE/);
  });

  it('refuses the continuation CE after a green candle', () => {
    const cfg = sniperCfg('nifty');
    const next = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('CE'),
    );
    expect(next.side).toBe('flat');
    expect(next.skips).toHaveLength(0);
    expect(next.reason).toMatch(/waiting fade PE not CE/);
  });

  it('buys ATM CE on a completed red candle at 09:20', () => {
    const cfg = sniperCfg('nifty');
    const next = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 23980)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      23980,
      { bid: 100, ask: 101, last: 100.5 },
      pick('CE'),
    );
    expect(next.side).toBe('long');
    expect(next.optionType).toBe('CE');
    expect(next.reason).toMatch(/red fade CE/);
  });

  it('skips a doji instead of inventing a side', () => {
    const cfg = sniperCfg('nifty');
    const next = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 24000)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24000,
      { bid: 100, ask: 101, last: 100 },
      pick('CE'),
    );
    expect(next.side).toBe('flat');
    expect(next.reason).toMatch(/doji/);
  });

  it('drops a forming 5-minute bar so later candles cannot leak in', () => {
    const bars = [bar('2026-11-19', 555, 24000, 23900), bar('2026-11-19', 560, 23900, 24100)];
    expect(completedSniperBars(bars, '2026-11-19', 9 * 60 + 24).map((b) => b.min)).toEqual([555]);
  });

  it('does not look ahead: a 09:25 bar is ignored at 09:24', () => {
    const cfg = sniperCfg('nifty');
    const bars = [bar('2026-11-19', 555, 24000, 23900), bar('2026-11-19', 560, 23900, 24100)];
    const next = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      bars,
      '2026-11-19',
      9 * 60 + 24,
      '2026-11-19T03:54:00.000Z',
      23900,
      { bid: 120, ask: 121, last: 120 },
      pick('PE'),
    );
    expect(next.side).toBe('flat');
    expect(next.reason).toMatch(/missed/);
  });

  it('stops out when net P/L hits −₹100 after Kite charges', () => {
    const cfg = sniperCfg('nifty');
    const opened = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('PE'),
    );
    expect(opened.side).toBe('long');
    const dead = tickSniperBook(
      opened,
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 21,
      '2026-11-19T03:51:00.000Z',
      24010,
      { bid: opened.sl, ask: opened.sl, last: opened.sl },
      pick('PE'),
    );
    expect(dead.side).toBe('flat');
    expect(dead.fills[0].reason).toBe('sl');
    expect(dead.fills[0].netRs).toBeGreaterThanOrEqual(-110);
    expect(dead.fills[0].netRs).toBeLessThanOrEqual(-90);
    expect(dead.capital).toBeLessThan(SNIPER_CAPITAL_RS);
    const later = tickSniperBook(
      dead,
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 22,
      '2026-11-19T03:52:00.000Z',
      24010,
      { bid: 90, ask: 91, last: 90 },
      pick('PE'),
    );
    expect(later.fills).toHaveLength(1);
    expect(later.fills[0].netRs).toBe(dead.fills[0].netRs);
  });

  it('exits at the end of the 5-minute slot', () => {
    const cfg = sniperCfg('nifty');
    const opened = tickSniperBook(
      emptySniperBook(cfg),
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 20,
      '2026-11-19T03:50:00.000Z',
      24020,
      { bid: 100, ask: 101, last: 100.5 },
      pick('PE'),
    );
    const timed = tickSniperBook(
      opened,
      cfg,
      [bar('2026-11-19', 555, 24000, 24020)],
      '2026-11-19',
      9 * 60 + 25,
      '2026-11-19T03:55:00.000Z',
      24040,
      { bid: 110, ask: 111, last: 110 },
      pick('PE'),
    );
    expect(timed.fills[0].reason).toBe('time');
    expect(timed.side).toBe('flat');
    expect(timed.fills[0].netRs).toBeCloseTo(sniperNetRs(101, 110, opened.qty, 'NSE'), 0);
  });

  it('skips when one lot cannot fit the ₹100 risk after charges', () => {
    const size = sniperSize(10, 400, 65, 'NSE');
    expect(size.lots).toBe(0);
    expect(size.skip).toMatch(/capital|stop|charges/i);
    const ok = sniperSize(SNIPER_CAPITAL_RS, 101, 65, 'NSE');
    expect(ok.lots).toBeGreaterThan(0);
    expect(ok.sl).toBeLessThan(101);
    expect(ok.sl).toBeGreaterThan(0);
  });

  it('keeps ticked books when summarizing a tick', () => {
    const idle = emptySniperSession('2026-11-20');
    const ticked = idle.books.map((b, i) => (i === 0 ? { ...b, side: 'long' as const, reason: 'green fade PE 25000', qty: 65 } : b));
    const out = summarizeSniper(idle, { books: ticked, source: 'kite', running: true });
    expect(out.books[0].side).toBe('long');
    expect(out.books[0].reason).toMatch(/green fade PE/);
    expect(out.source).toBe('kite');
    expect(out.running).toBe(true);
  });

  it('breaks Kite charges into brokerage, STT, exchange, GST and stamp', () => {
    const ch = sniperCharges(100, 120, 65, 'NSE');
    const raw = optionChargeBreakdown(100, 120, 65, 'NSE');
    expect(ch.brokerage).toBe(40);
    expect(ch.stt).toBeCloseTo(raw.sttCtt, 2);
    expect(ch.entryTurnover).toBe(6500);
    expect(ch.exitTurnover).toBe(7800);
    expect(ch.total).toBeCloseTo(raw.total, 2);
    expect(ch.brokerage + ch.stt + ch.exchange + ch.sebi + ch.stamp + ch.ipft + ch.gst).toBeCloseTo(ch.total, 6);
  });
});
