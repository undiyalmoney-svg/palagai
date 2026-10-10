import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ResearchApiService } from './research-api.service';
import { ResearchPageComponent } from './research-page.component';

describe('ResearchApiService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ResearchApiService],
    });
    return {
      api: TestBed.inject(ResearchApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('loads experiment status from the research API', async () => {
    const { api, http } = setup();
    const pending = api.status();
    const req = http.expectOne('/api/research/status');
    expect(req.request.method).toBe('GET');
    req.flush({
      status: 'ok',
      experiment: { status: 'draft', configuration: {}, tradingDays: 0 },
      accounts: [],
      combined: { equity: 0, cash: 0, realized: 0, unrealized: 0, netPnl: 0, note: '' },
      feed: { configured: false, connected: false, stale: true, lastTickAt: null, mode: 'waiting', message: 'waiting' },
      paperOnly: true,
      dataMode: 'waiting',
      disclaimer: 'Simulated results are not a guarantee.',
    });
    const body = await pending;
    expect(body.paperOnly).toBe(true);
    expect(body.dataMode).toBe('waiting');
    http.verify();
  });

  it('starts paper mode only with the typed confirmation', async () => {
    const { api, http } = setup();
    const pending = api.start('START PAPER EXPERIMENT');
    const req = http.expectOne('/api/research/start');
    expect(req.request.body).toEqual({ confirm: 'START PAPER EXPERIMENT', mode: 'PAPER' });
    req.flush({ status: 'ok', experiment: { status: 'running' } });
    await pending;
    http.verify();
  });
});

describe('ResearchPageComponent', () => {
  it('shows the paper disclaimer and the waiting state from the API', async () => {
    TestBed.configureTestingModule({
      imports: [ResearchPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(ResearchPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/research/status').flush({
      status: 'ok',
      experiment: {
        status: 'draft',
        tradingDays: 0,
        name: '10-week intraday paper experiment',
        configuration: {
          startingCapital: 20000,
          riskPerTrade: 0.005,
          maxDailyLoss: 0.02,
          maxTradesPerDay: 5,
          maxOpenPositions: 3,
          maxNotionalPct: 0.95,
          minRewardRisk: 1.5,
          slippageBps: 5,
          openingRangeMinutes: 15,
        },
      },
      accounts: [],
      combined: { equity: 100000, cash: 100000, realized: 0, unrealized: 0, netPnl: 0, note: 'not one pool' },
      feed: { configured: false, connected: false, stale: true, lastTickAt: null, mode: 'waiting', message: 'Set KITE_API_KEY.' },
      paperOnly: true,
      dataMode: 'waiting',
      disclaimer: 'Simulated results are not a guarantee of future real-money profitability.',
    });
    http.expectOne('/api/research/readiness').flush({ status: 'ok', ready: false, checks: [], paperOnly: true });
    http.expectOne('/api/research/strategies').flush({ status: 'ok', strategies: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    http.expectOne('/api/research/events').flush({ status: 'ok', events: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Paper only');
    expect(text).toContain('Waiting for market data');
    expect(text).toContain('draft');
    fixture.destroy();
    http.verify();
  });
});
