import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, expect, it, beforeEach } from 'vitest';
import { LiveAssumeService } from './live-assume.service';
import { PAPER_LIVE_ASSUME } from './paper-live-assume.fixture';

describe('LiveAssumeService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });
  });

  it('uses the last closed cache and does not place a Kite order when Token is missing', async () => {
    const svc = TestBed.inject(LiveAssumeService);
    const snap = await svc.runFromKite();
    expect(snap.assumed).toBe(true);
    expect(snap.liveOrders).toBe(false);
    expect(snap.guaranteed).toBe(false);
    expect(snap.armedOnCrudeBest).toBe(false);
    expect(snap.source).toBe('cache');
    expect(snap.totalRs).toBe(PAPER_LIVE_ASSUME.totalRs);
    expect(snap.kiteError).toMatch(/Connect Kite/);
    expect(snap.books).toHaveLength(4);
    expect(svc.error()).toMatch(/Connect Kite/);
  });
});
