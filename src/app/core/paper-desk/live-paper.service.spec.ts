import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { LivePaperService } from './live-paper.service';

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
});
