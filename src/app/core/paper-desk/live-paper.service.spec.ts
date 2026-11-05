import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import { pickCheapOtm } from '../utils/pick-cheap-otm.util';
import { emptyBook, LIVE_PAPER_BOOKS } from './live-paper.engine';
import { LivePaperService, bestBidAsk, needsOption, nextExpiryAsOf } from './live-paper.service';

describe('LivePaperService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });
  });

  it('refuses to start without Token and never places an order', async () => {
    const svc = TestBed.inject(LivePaperService);
    await svc.start();
    const snap = svc.session();
    expect(snap.running).toBe(false);
    expect(snap.liveOrders).toBe(false);
    expect(snap.guaranteed).toBe(false);
    expect(snap.kiteError).toMatch(/Connect Kite/);
    expect(snap.books).toHaveLength(20);
  });

  it('reads best bid and ask from quote depth and returns null when the book is empty', () => {
    expect(
      bestBidAsk({ depth: { buy: [{ price: 171.9 }], sell: [{ price: 172.3 }] } }),
    ).toEqual({ bid: 171.9, ask: 172.3 });
    expect(bestBidAsk({ depth: { buy: [{ price: 0 }], sell: [] } })).toEqual({ bid: null, ask: null });
    expect(bestBidAsk(null)).toEqual({ bid: null, ask: null });
  });

  it('binds any open book that has no option — even one re-opened on the tick it closed', () => {
    const book = emptyBook(LIVE_PAPER_BOOKS[0]);
    expect(needsOption(book)).toBe(false);
    const reopened = { ...book, side: 'long' as const, entry: 9158, status: 'open' as const };
    expect(needsOption(reopened)).toBe(true);
    expect(needsOption({ ...reopened, optionSymbol: 'CRUDEOILM26NOV9250CE' })).toBe(false);
  });

  it('skips an expiry with 1 day or less left and takes the next one', () => {
    const opt = (sym: string, expiry: string): Instrument => ({
      instrumentToken: 7,
      exchangeToken: 0,
      tradingSymbol: sym,
      name: 'SENSEX',
      exchange: 'BFO',
      segment: 'BFO-OPT',
      instrumentType: 'CE',
      expiry,
      strike: 77500,
      tickSize: 0.05,
      lotSize: 20,
      lastPrice: 100,
    });
    const chain = [opt('SENSEX2611577500CE', '2026-11-05'), opt('SENSEX26N1277500CE', '2026-11-12')];
    const asOf = new Date('2026-11-04T05:00:00Z');
    const pick = (at: Date) =>
      pickCheapOtm({ instruments: chain, book: 'sensex', direction: 'BUY', spot: 77300, asOf: at, premiumBudgetRs: 1e7 });
    expect(pick(asOf).expiry).toBe('2026-11-05');
    expect(pick(nextExpiryAsOf(asOf)).expiry).toBe('2026-11-12');
  });
});
