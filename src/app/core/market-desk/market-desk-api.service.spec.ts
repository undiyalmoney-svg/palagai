import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { KiteSessionService } from '../kite/kite-session.service';
import { MarketDeskApiService } from './market-desk-api.service';
import { MarketDeskSnapshot } from './market-desk.models';

function snapshot(): MarketDeskSnapshot {
  return {
    private: true,
    demo: false,
    needsReauth: false,
    settings: {
      emaFast: 20,
      emaSlow: 50,
      adxPeriod: 14,
      adxWeak: 18,
      adxStrong: 25,
      pivotStrength: 2,
      srLookback: 20,
      breakoutBufferPct: 0.08,
      volumeFilter: false,
      retestRequired: false,
      cooldownBars: 4,
      uiRefreshMs: 5000,
      alertCooldownMs: 120000,
    },
    session: {
      status: 'open',
      label: 'Session open',
      open: true,
      day: '2026-10-14',
      istNow: '14:02:11 IST',
      lastUpdateAt: '2026-10-14T08:32:00Z',
      lastTickAt: '2026-10-14T08:32:00Z',
      lastConfirmedCandleAt: '2026-10-14T08:15:00Z',
      connection: 'live',
      freshness: 'fresh',
      timeframe: '15minute',
    },
    indices: [],
    stocks: [],
    breadth: {
      advances: 1,
      declines: 0,
      unchanged: 0,
      adRatio: null,
      adRatioLabel: '∞',
      pctAboveEma20: 50,
      pctAboveEma50: 40,
      strongest: [],
      weakest: [],
      sectors: [],
      divergence: null,
    },
    setups: [],
    alerts: [],
    warning: null,
  };
}

describe('MarketDeskApiService', () => {
  it('loads the private desk with the site session and Kite header', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MarketDeskApiService,
        { provide: KiteSessionService, useValue: { getAuthorizationHeader: () => 'token key:secret' } },
      ],
    });
    const api = TestBed.inject(MarketDeskApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = api.snapshot();
    const req = http.expectOne((r) => r.url === '/api/market-desk');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    req.flush({ status: 'ok', ...snapshot() });
    const body = await pending;
    expect(body.private).toBe(true);
    expect(body.demo).toBe(false);
    http.verify();
  });
});
