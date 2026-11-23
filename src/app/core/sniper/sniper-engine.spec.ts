import { describe, expect, it } from 'vitest';
import { optionChargeBreakdown } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperNetRs } from './sniper-charges';
import { sniperOrbReady } from './sniper-clock';
import {
  candleDir,
  emptySniperSession,
  sniperClearCut,
  sniperHighGreen,
  sniperOrbLevels,
  sniperStrongRed,
  sniperWantType,
  summarizeSniper,
  tickSniperDesk,
} from './sniper-engine';
import { SNIPER_BOOKS, SNIPER_STOP_RS, SNIPER_TARGET_RS, SniperBar, SniperPick, SniperSession, SniperUnder } from './sniper.models';
import { sniperSize } from './sniper-size';

const DAY = '2026-11-23';

const pick = (type: 'CE' | 'PE' = 'CE'): SniperPick => ({
  optionType: type,
  strike: 25000,
  expiry: '2026-11-24',
  optionSymbol: type === 'CE' ? 'NIFTY26NOV25000CE' : 'NIFTY26NOV25000PE',
  optionToken: 11,
  lotSize: 65,
  listed: true,
});

function bar(min: number, open: number, high: number, low: number, close: number): SniperBar {
  return { day: DAY, min, open, high, low, close };
}

function orBars(): SniperBar[] {
  return [
    bar(555, 24000, 24040, 23980, 24020),
    bar(560, 24020, 24050, 24000, 24030),
    bar(565, 24030, 24060, 24010, 24040),
  ];
}

function emptyBars(): Record<SniperUnder, SniperBar[]> {
  return { nifty: [], bank: [], sensex: [] };
}

function feed(type: 'CE' | 'PE' = 'CE', ask = 101) {
  return {
    nifty: { opt: { bid: 100, ask, last: 100.5 }, pick: pick(type) },
    bank: { opt: { bid: 100, ask, last: 100.5 }, pick: { ...pick(type), lotSize: 30, optionSymbol: type === 'CE' ? 'BANKCE' : 'BANKPE' } },
    sensex: { opt: { bid: 100, ask, last: 100.5 }, pick: { ...pick(type), lotSize: 20, optionSymbol: type === 'CE' ? 'SXCE' : 'SXPE' } },
  };
}

function desk(patch: Partial<SniperSession> = {}): SniperSession {
  return { ...emptySniperSession(DAY), paperOn: true, ...patch };
}

describe('Sniper ORB desk', () => {
  it('watches Nifty 50, Bank Nifty and Sensex only, default SL ₹750, one lot', () => {
    expect(SNIPER_BOOKS.map((b) => b.id)).toEqual(['nifty', 'bank', 'sensex']);
    expect(SNIPER_STOP_RS).toBe(750);
    expect(SNIPER_TARGET_RS).toBe(1000);
    const s = emptySniperSession(DAY);
    expect(s.books).toHaveLength(3);
    expect(s.lots).toBe(1);
    expect(s.stopRs).toBe(750);
    expect(s.paperOn).toBe(true);
    expect(s.liveArmed).toBe(false);
  });

  it('builds ORB from 09:15–09:30 and ignores a wick-only poke', () => {
    expect(sniperOrbReady(9 * 60 + 29)).toBe(false);
    expect(sniperOrbReady(9 * 60 + 30)).toBe(true);
    const or = sniperOrbLevels(orBars(), DAY)!;
    expect(or.high).toBe(24060);
    expect(or.low).toBe(23980);
    const wick = bar(570, 24050, 24080, 24040, 24055);
    expect(sniperClearCut(wick, or)).toBe('');
    const cut = bar(570, 24050, 24100, 24040, 24090);
    expect(sniperClearCut(cut, or)).toBe('up');
    const down = bar(570, 24000, 24020, 23900, 23940);
    expect(sniperClearCut(down, or)).toBe('down');
  });

  it('needs a strong red, not a doji dip', () => {
    expect(candleDir(bar(575, 24100, 24110, 24000, 24020))).toBe('red');
    expect(sniperStrongRed(bar(575, 24100, 24110, 24000, 24020))).toBe(true);
    expect(sniperStrongRed(bar(575, 24100, 24120, 24080, 24090))).toBe(false);
    expect(sniperWantType('up')).toBe('CE');
    expect(sniperWantType('down')).toBe('PE');
  });

  it('picks the first instrument whose 5m close cuts the OR', () => {
    const nifty = [...orBars(), bar(575, 24050, 24120, 24040, 24100)];
    const bank = [...orBars().map((b) => ({ ...b, high: b.high + 200, low: b.low + 200, open: b.open + 200, close: b.close + 200 })), bar(570, 24300, 24400, 24200, 24380)];
    const next = tickSniperDesk(
      desk(),
      { nifty, bank, sensex: orBars() },
      { nifty: 24100, bank: 24380, sensex: 24040 },
      feed('CE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    expect(next.selected).toBe('bank');
    expect(next.books.find((b) => b.id === 'bank')?.cut).toBe('up');
    expect(next.books.find((b) => b.id === 'bank')?.event).toBe('orb_break');
    expect(next.books.find((b) => b.id === 'nifty')?.cut).toBe('');
    expect(next.books.find((b) => b.id === 'nifty')?.event).toBe('parked');
    expect(next.books.find((b) => b.id === 'sensex')?.event).toBe('parked');
  });

  it('enters CE after an up cut, a strong red, and price back at that high', () => {
    const red = bar(575, 24120, 24130, 23980, 24010);
    expect(sniperStrongRed(red)).toBe(true);
    const nifty = [...orBars(), bar(570, 24050, 24140, 24040, 24110), red];
    const waiting = tickSniperDesk(
      desk(),
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24020, bank: 24030, sensex: 24040 },
      feed('CE'),
      DAY,
      9 * 60 + 40,
      `${DAY}T04:10:00.000Z`,
    );
    expect(waiting.selected).toBe('nifty');
    expect(waiting.books[0].side).toBe('flat');
    expect(waiting.books[0].event).toBe('breakout_candle');
    expect(waiting.books[0].reason).toMatch(/wait 24130/);
    expect(waiting.books.find((b) => b.id === 'bank')?.event).toBe('parked');
    expect(waiting.books.find((b) => b.id === 'sensex')?.event).toBe('parked');
    const opened = tickSniperDesk(
      waiting,
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24130, bank: 24030, sensex: 24040 },
      feed('CE'),
      DAY,
      9 * 60 + 41,
      `${DAY}T04:11:00.000Z`,
    );
    expect(opened.books[0].side).toBe('long');
    expect(opened.books[0].event).toBe('trade_taken');
    expect(opened.books[0].optionType).toBe('CE');
    expect(opened.books[0].lots).toBe(1);
    expect(opened.books[0].qty).toBe(65);
    expect(opened.books[0].entry).toBe(101);
    expect(opened.books[0].sl).toBeLessThan(101);
    expect(opened.books.find((b) => b.id === 'bank')?.side).toBe('flat');
    expect(opened.books.find((b) => b.id === 'bank')?.event).toBe('parked');
  });

  it('enters PE on a down cut when the strong red high is tagged', () => {
    const cut = bar(570, 24000, 24020, 23880, 23900);
    expect(sniperStrongRed(cut)).toBe(true);
    const nifty = [...orBars(), cut];
    const opened = tickSniperDesk(
      desk(),
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24020, bank: 24030, sensex: 24040 },
      feed('PE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    expect(opened.selected).toBe('nifty');
    expect(opened.books[0].cut).toBe('down');
    expect(opened.books[0].side).toBe('long');
    expect(opened.books[0].optionType).toBe('PE');
    const green = sniperHighGreen(nifty, cut.min);
    expect(opened.books[0].indexSl).toBe(green?.low);
  });

  it('does not take a second ticket the same day', () => {
    const cut = bar(570, 24000, 24020, 23880, 23900);
    const nifty = [...orBars(), cut];
    const opened = tickSniperDesk(
      desk(),
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24020 },
      feed('PE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    const closed = tickSniperDesk(
      opened,
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24020 },
      {
        nifty: { opt: { bid: opened.books[0].sl, ask: opened.books[0].sl, last: opened.books[0].sl }, pick: pick('PE') },
        bank: feed('PE').bank,
        sensex: feed('PE').sensex,
      },
      DAY,
      9 * 60 + 36,
      `${DAY}T04:06:00.000Z`,
    );
    expect(closed.books[0].fills).toHaveLength(1);
    expect(closed.books[0].fills[0].reason).toBe('sl');
    expect(closed.books[0].event).toBe('trade_closed');
    expect(closed.books.find((b) => b.id === 'bank')?.event).toBe('parked');
    expect(closed.books.find((b) => b.id === 'sensex')?.event).toBe('parked');
    const bankCut = [
      ...orBars().map((b) => ({ ...b, high: b.high + 400, low: b.low + 400, open: b.open + 400, close: b.close + 400 })),
      bar(580, 24500, 24520, 24300, 24340),
    ];
    const later = tickSniperDesk(
      closed,
      { nifty, bank: bankCut, sensex: orBars() },
      { nifty: 23920, bank: 24520 },
      feed('PE'),
      DAY,
      9 * 60 + 45,
      `${DAY}T04:15:00.000Z`,
    );
    expect(later.books.find((b) => b.id === 'bank')?.side).toBe('flat');
    expect(later.books.flatMap((b) => b.fills)).toHaveLength(1);
  });

  it('fills the stop at the written SL, not a dumped bid', () => {
    const cut = bar(570, 24000, 24020, 23880, 23900);
    const opened = tickSniperDesk(
      desk(),
      { nifty: [...orBars(), cut], bank: orBars(), sensex: orBars() },
      { nifty: 24020 },
      feed('PE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    const sl = opened.books[0].sl!;
    const dead = tickSniperDesk(
      opened,
      { nifty: [...orBars(), cut], bank: orBars(), sensex: orBars() },
      { nifty: 24020 },
      {
        nifty: { opt: { bid: 40, ask: 41, last: 40 }, pick: pick('PE') },
        bank: feed('PE').bank,
        sensex: feed('PE').sensex,
      },
      DAY,
      9 * 60 + 36,
      `${DAY}T04:06:00.000Z`,
    );
    expect(dead.books[0].fills[0].reason).toBe('sl');
    expect(dead.books[0].fills[0].exit).toBe(sl);
    expect(dead.books[0].fills[0].netRs).toBeGreaterThan(-800);
    expect(dead.books[0].fills[0].netRs).toBeLessThan(0);
  });

  it('uses the lots the user typed', () => {
    const cut = bar(570, 24000, 24020, 23880, 23900);
    const opened = tickSniperDesk(
      desk({ lots: 2 }),
      { nifty: [...orBars(), cut], bank: orBars(), sensex: orBars() },
      { nifty: 24020 },
      feed('PE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    expect(opened.books[0].lots).toBe(2);
    expect(opened.books[0].qty).toBe(130);
  });

  it('skips an instrument that is unchecked', () => {
    const s = desk();
    s.books = s.books.map((b) => (b.id === 'nifty' ? { ...b, watch: false } : b));
    const nifty = [...orBars(), bar(570, 24050, 24140, 24040, 24110)];
    const next = tickSniperDesk(
      s,
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24110 },
      feed('CE'),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    expect(next.selected).toBe('');
    expect(next.books[0].cut).toBe('');
  });

  it('marks found entry when the red high is tagged but the option is not filled', () => {
    const red = bar(575, 24120, 24130, 23980, 24010);
    const nifty = [...orBars(), bar(570, 24050, 24140, 24040, 24110), red];
    const next = tickSniperDesk(
      desk(),
      { nifty, bank: orBars(), sensex: orBars() },
      { nifty: 24130, bank: 24030, sensex: 24040 },
      {
        nifty: { opt: { bid: 100, ask: 101, last: 100.5 }, pick: { ...pick('CE'), listed: false } },
        bank: feed('CE').bank,
        sensex: feed('CE').sensex,
      },
      DAY,
      9 * 60 + 41,
      `${DAY}T04:11:00.000Z`,
    );
    expect(next.selected).toBe('nifty');
    expect(next.books[0].side).toBe('flat');
    expect(next.books[0].event).toBe('found_entry');
    expect(next.books[0].redHigh).toBe(24130);
    expect(next.books.find((b) => b.id === 'bank')?.event).toBe('parked');
  });

  it('sizes a ₹750 stop and a ₹1000 target on user lots', () => {
    const size = sniperSize(1, 65, 101, 'NSE', 750, 1000);
    expect(size.lots).toBe(1);
    expect(size.qty).toBe(65);
    expect(size.sl).toBeLessThan(101);
    expect(sniperNetRs(101, size.sl, 65, 'NSE')).toBeGreaterThanOrEqual(-750);
    expect(size.tp).toBeGreaterThan(101);
    expect(sniperNetRs(101, size.tp, 65, 'NSE')).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the selected book when summarizing a tick', () => {
    const idle = emptySniperSession(DAY);
    const ticked = idle.books.map((b, i) => (i === 0 ? { ...b, side: 'long' as const, reason: 'open CE · SL ₹90', qty: 65 } : b));
    const out = summarizeSniper(idle, { books: ticked, selected: 'nifty', source: 'kite', running: true });
    expect(out.books[0].side).toBe('long');
    expect(out.selected).toBe('nifty');
    expect(out.running).toBe(true);
  });

  it('breaks Kite charges into brokerage, STT, exchange, GST and stamp', () => {
    const ch = sniperCharges(100, 120, 65, 'NSE');
    const raw = optionChargeBreakdown(100, 120, 65, 'NSE');
    expect(ch.brokerage).toBe(40);
    expect(ch.stt).toBeCloseTo(raw.sttCtt, 2);
    expect(ch.total).toBeCloseTo(raw.total, 2);
  });
});
