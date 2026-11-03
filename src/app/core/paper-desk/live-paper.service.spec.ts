import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { LivePaperService, bestBidAsk } from './live-paper.service';

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
    expect(snap.books).toHaveLength(4);
  });

  it('reads best bid and ask from quote depth and returns null when the book is empty', () => {
    expect(
      bestBidAsk({ depth: { buy: [{ price: 171.9 }], sell: [{ price: 172.3 }] } }),
    ).toEqual({ bid: 171.9, ask: 172.3 });
    expect(bestBidAsk({ depth: { buy: [{ price: 0 }], sell: [] } })).toEqual({ bid: null, ask: null });
    expect(bestBidAsk(null)).toEqual({ bid: null, ask: null });
  });
});
