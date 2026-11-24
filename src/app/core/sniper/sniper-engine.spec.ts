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
  sniperPulseLine,
  sniperStrongRed,
  sniperWantType,
  summarizeSniper,
  tickSniperDesk,
} from './sniper-engine';
import { SNIPER_BOOKS, SNIPER_STOP_RS, SNIPER_STRONG_RED, SNIPER_TARGET_RS, SniperBar, SniperPick, SniperSession } from './sniper.models';
import { sniperSize } from './sniper-size';

const DAY = '2026-11-23';

const pick = (): SniperPick => ({
  optionType: 'PE',
  strike: 52000,
  expiry: '2026-11-24',
  optionSymbol: 'BANKNIFTY26NOV52000PE',
  optionToken: 11,
  lotSize: 30,
  listed: true,
});

function bar(min: number, open: number, high: number, low: number, close: number): SniperBar {
  return { day: DAY, min, open, high, low, close };
}

function orBars(): SniperBar[] {
  return [
    bar(555, 52000, 52040, 51980, 52020),
    bar(560, 52020, 52050, 52000, 52030),
    bar(565, 52030, 52060, 52010, 52040),
  ];
}

function feed(ask = 101) {
  return {
    bank: { opt: { bid: 100, ask, last: 100.5 }, pick: pick() },
  };
}

function desk(patch: Partial<SniperSession> = {}): SniperSession {
  return { ...emptySniperSession(DAY), paperOn: true, ...patch };
}

function downCut(): SniperBar {
  return bar(570, 52000, 52020, 51880, 51900);
}

describe('Sniper Bank PE desk', () => {
  it('watches Bank Nifty only, SL ₹750, sell ₹750, one lot', () => {
    expect(SNIPER_BOOKS.map((b) => b.id)).toEqual(['bank']);
    expect(SNIPER_STOP_RS).toBe(750);
    expect(SNIPER_TARGET_RS).toBe(750);
    expect(SNIPER_STRONG_RED).toBe(0.4);
    const s = emptySniperSession(DAY);
    expect(s.books).toHaveLength(1);
    expect(s.books[0].id).toBe('bank');
    expect(s.books[0].label).toBe('Bank Nifty');
    expect(s.lots).toBe(1);
    expect(s.stopRs).toBe(750);
    expect(s.targetRs).toBe(750);
    expect(s.paperOn).toBe(true);
    expect(s.liveArmed).toBe(false);
  });

  it('builds ORB from 09:15–09:30 and ignores a wick-only poke', () => {
    expect(sniperOrbReady(9 * 60 + 29)).toBe(false);
    expect(sniperOrbReady(9 * 60 + 30)).toBe(true);
    const or = sniperOrbLevels(orBars(), DAY)!;
    expect(or.high).toBe(52060);
    expect(or.low).toBe(51980);
    const wick = bar(570, 52050, 52080, 52040, 52055);
    expect(sniperClearCut(wick, or)).toBe('');
    const up = bar(570, 52050, 52100, 52040, 52090);
    expect(sniperClearCut(up, or)).toBe('up');
    const down = bar(570, 52000, 52020, 51880, 51940);
    expect(sniperClearCut(down, or)).toBe('down');
  });

  it('needs a 40% red body, never CE', () => {
    expect(candleDir(bar(575, 52100, 52110, 52000, 52020))).toBe('red');
    expect(sniperStrongRed(bar(575, 52100, 52100, 52000, 52060))).toBe(true);
    expect(sniperStrongRed(bar(575, 52100, 52100, 52000, 52061))).toBe(false);
    expect(sniperStrongRed(bar(575, 52100, 52120, 52080, 52090))).toBe(false);
    expect(sniperWantType('up')).toBeNull();
    expect(sniperWantType('down')).toBe('PE');
  });

  it('skips the day on an up ORB — no CE ticket', () => {
    const bank = [...orBars(), bar(570, 52050, 52140, 52040, 52110)];
    const next = tickSniperDesk(desk(), { bank }, { bank: 52110 }, feed(), DAY, 9 * 60 + 35, `${DAY}T04:05:00.000Z`);
    expect(next.selected).toBe('bank');
    expect(next.books[0].cut).toBe('up');
    expect(next.books[0].side).toBe('flat');
    expect(next.books[0].event).toBe('parked');
    expect(next.books[0].reason).toMatch(/skip CE/);
    expect(next.books[0].optionType === 'PE' || next.books[0].optionType === '').toBe(true);
    const later = tickSniperDesk(
      next,
      { bank: [...bank, bar(580, 51900, 51920, 51800, 51820)] },
      { bank: 51820 },
      feed(),
      DAY,
      9 * 60 + 45,
      `${DAY}T04:15:00.000Z`,
    );
    expect(later.books[0].side).toBe('flat');
    expect(later.books[0].fills).toHaveLength(0);
  });

  it('waits for a later 5m to tag the 40% red high, then buys PE', () => {
    const cut = bar(570, 51970, 52000, 51940, 51950);
    expect(sniperClearCut(cut, sniperOrbLevels(orBars(), DAY)!)).toBe('down');
    expect(sniperStrongRed(cut)).toBe(false);
    const red = bar(575, 51950, 51970, 51820, 51840);
    expect(sniperStrongRed(red)).toBe(true);
    const bank = [...orBars(), cut, red];
    const waiting = tickSniperDesk(desk(), { bank }, { bank: 51920 }, feed(), DAY, 9 * 60 + 40, `${DAY}T04:10:00.000Z`);
    expect(waiting.selected).toBe('bank');
    expect(waiting.books[0].side).toBe('flat');
    expect(waiting.books[0].event).toBe('breakout_candle');
    expect(waiting.books[0].reason).toMatch(/wait tag 51970/);
    const opened = tickSniperDesk(waiting, { bank }, { bank: 51970 }, feed(), DAY, 9 * 60 + 41, `${DAY}T04:11:00.000Z`);
    expect(opened.books[0].side).toBe('long');
    expect(opened.books[0].event).toBe('trade_taken');
    expect(opened.books[0].optionType).toBe('PE');
    expect(opened.books[0].optionSymbol).toBe('BANKNIFTY26NOV52000PE');
    expect(opened.books[0].lots).toBe(1);
    expect(opened.books[0].qty).toBe(30);
    expect(opened.books[0].entry).toBe(101);
    expect(opened.books[0].sl).toBeLessThan(101);
    expect(opened.books[0].tp).toBeGreaterThan(101);
  });

  it('enters PE when the down-cut bar itself is the 40% red and spot tags that high', () => {
    const cut = downCut();
    expect(sniperStrongRed(cut)).toBe(true);
    const bank = [...orBars(), cut];
    const opened = tickSniperDesk(desk(), { bank }, { bank: 52020 }, feed(), DAY, 9 * 60 + 35, `${DAY}T04:05:00.000Z`);
    expect(opened.selected).toBe('bank');
    expect(opened.books[0].cut).toBe('down');
    expect(opened.books[0].side).toBe('long');
    expect(opened.books[0].optionType).toBe('PE');
    const green = sniperHighGreen(bank, cut.min);
    expect(opened.books[0].indexSl).toBe(green?.low);
  });

  it('does not take a second ticket the same day', () => {
    const cut = downCut();
    const bank = [...orBars(), cut];
    const opened = tickSniperDesk(desk(), { bank }, { bank: 52020 }, feed(), DAY, 9 * 60 + 35, `${DAY}T04:05:00.000Z`);
    const closed = tickSniperDesk(
      opened,
      { bank },
      { bank: 52020 },
      { bank: { opt: { bid: opened.books[0].sl, ask: opened.books[0].sl, last: opened.books[0].sl }, pick: pick() } },
      DAY,
      9 * 60 + 36,
      `${DAY}T04:06:00.000Z`,
    );
    expect(closed.books[0].fills).toHaveLength(1);
    expect(closed.books[0].fills[0].reason).toBe('sl');
    expect(closed.books[0].event).toBe('trade_closed');
    const later = tickSniperDesk(
      closed,
      { bank: [...bank, bar(580, 51800, 51820, 51700, 51740)] },
      { bank: 51820 },
      feed(),
      DAY,
      9 * 60 + 45,
      `${DAY}T04:15:00.000Z`,
    );
    expect(later.books[0].side).toBe('flat');
    expect(later.books.flatMap((b) => b.fills)).toHaveLength(1);
  });

  it('fills the stop at the written SL, not a dumped bid', () => {
    const opened = tickSniperDesk(
      desk(),
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      feed(),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    const sl = opened.books[0].sl!;
    const dead = tickSniperDesk(
      opened,
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      { bank: { opt: { bid: 40, ask: 41, last: 40 }, pick: pick() } },
      DAY,
      9 * 60 + 36,
      `${DAY}T04:06:00.000Z`,
    );
    expect(dead.books[0].fills[0].reason).toBe('sl');
    expect(dead.books[0].fills[0].exit).toBe(sl);
    expect(dead.books[0].fills[0].netRs).toBeGreaterThan(-800);
    expect(dead.books[0].fills[0].netRs).toBeLessThan(0);
  });

  it('takes profit at the written ₹750 sell', () => {
    const opened = tickSniperDesk(
      desk(),
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      feed(),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    const tp = opened.books[0].tp!;
    const won = tickSniperDesk(
      opened,
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      { bank: { opt: { bid: tp, ask: tp + 1, last: tp }, pick: pick() } },
      DAY,
      9 * 60 + 40,
      `${DAY}T04:10:00.000Z`,
    );
    expect(won.books[0].fills[0].reason).toBe('tp');
    expect(won.books[0].fills[0].netRs).toBeGreaterThan(700);
  });

  it('uses the lots the user typed', () => {
    const opened = tickSniperDesk(
      desk({ lots: 2 }),
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      feed(),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
    );
    expect(opened.books[0].lots).toBe(2);
    expect(opened.books[0].qty).toBe(60);
  });

  it('marks found entry when the red high is tagged but the PE is not listed', () => {
    const cut = bar(570, 51970, 52000, 51940, 51950);
    const red = bar(575, 51950, 51970, 51820, 51840);
    const bank = [...orBars(), cut, red];
    const next = tickSniperDesk(
      desk(),
      { bank },
      { bank: 51970 },
      { bank: { opt: { bid: 100, ask: 101, last: 100.5 }, pick: { ...pick(), listed: false } } },
      DAY,
      9 * 60 + 41,
      `${DAY}T04:11:00.000Z`,
    );
    expect(next.selected).toBe('bank');
    expect(next.books[0].side).toBe('flat');
    expect(next.books[0].event).toBe('found_entry');
    expect(next.books[0].redHigh).toBe(51970);
  });

  it('sizes a ₹750 stop and a ₹750 target on Bank lot 30', () => {
    const size = sniperSize(1, 30, 101, 'NSE', 750, 750);
    expect(size.lots).toBe(1);
    expect(size.qty).toBe(30);
    expect(size.sl).toBeLessThan(101);
    expect(sniperNetRs(101, size.sl, 30, 'NSE')).toBeGreaterThanOrEqual(-750);
    expect(size.tp).toBeGreaterThan(101);
    expect(sniperNetRs(101, size.tp, 30, 'NSE')).toBeGreaterThanOrEqual(750);
  });

  it('prints a live minute pulse with Bank spot and the PE', () => {
    const minutes = [bar(574, 51910, 51940, 51900, 51920), bar(575, 51920, 52030, 51910, 52020)];
    const next = tickSniperDesk(
      desk(),
      { bank: [...orBars(), downCut()] },
      { bank: 52020 },
      feed(),
      DAY,
      9 * 60 + 35,
      `${DAY}T04:05:00.000Z`,
      { bank: minutes },
    );
    expect(next.books[0].spot).toBe(52020);
    expect(next.books[0].optionSymbol).toBe('BANKNIFTY26NOV52000PE');
    expect(next.books[0].pulse.length).toBeGreaterThan(0);
    expect(sniperPulseLine(next.books[0], 9 * 60 + 35)).toMatch(/Bank 52020/);
    expect(sniperPulseLine(next.books[0], 9 * 60 + 35)).toMatch(/BANKNIFTY26NOV52000PE/);
  });

  it('keeps the selected book when summarizing a tick', () => {
    const idle = emptySniperSession(DAY);
    const ticked = idle.books.map((b) => ({ ...b, side: 'long' as const, reason: 'open PE · SL ₹90', qty: 30 }));
    const out = summarizeSniper(idle, { books: ticked, selected: 'bank', source: 'kite', running: true });
    expect(out.books[0].side).toBe('long');
    expect(out.selected).toBe('bank');
    expect(out.running).toBe(true);
    expect(out.stopRs).toBe(750);
    expect(out.targetRs).toBe(750);
  });

  it('breaks Kite charges into brokerage, STT, exchange, GST and stamp', () => {
    const ch = sniperCharges(100, 120, 30, 'NSE');
    const raw = optionChargeBreakdown(100, 120, 30, 'NSE');
    expect(ch.brokerage).toBe(40);
    expect(ch.stt).toBeCloseTo(raw.sttCtt, 2);
    expect(ch.total).toBeCloseTo(raw.total, 2);
  });
});
