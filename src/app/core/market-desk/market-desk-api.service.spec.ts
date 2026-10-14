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

  it('falls back to live public heatmap quotes when /market-desk is 404', async () => {
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
    http.expectOne((r) => r.url === '/api/market-desk').flush(
      { status: 'error', message: 'Route not found: GET /market-desk' },
      { status: 404, statusText: 'Not Found' },
    );
    await Promise.resolve();
    const nifty = http.expectOne('/api/heatmap?index=NIFTY50');
    nifty.flush({
      public: true,
      index: { id: 'NIFTY50', name: 'NIFTY 50', ltp: 22640, change: -90, changePct: -0.4 },
      session: { ok: true, source: 'yahoo' },
      buckets: [],
      trends: [],
      advances: 1,
      declines: 0,
      unchanged: 0,
      trendCounts: {},
      companies: [
        {
          symbol: 'INFY',
          name: 'Infosys',
          sector: 'IT',
          mcapRank: 4,
          ltp: 1500,
          change: 10,
          changePct: 0.7,
          high52: 1600,
          low52: 1200,
          ema20: 1480,
          ema50: 1400,
          adx: 22,
          trend: 'up',
          trendLabel: 'Up',
          score: 1,
          bucket: '1-to--1',
        },
      ],
      lastUpdatedAt: '2026-10-14T09:00:00Z',
    });
    http.expectOne('/api/heatmap?index=BANKNIFTY').flush({
      public: true,
      index: { id: 'BANKNIFTY', name: 'NIFTY BANK', ltp: 55100, change: 80, changePct: 0.15 },
      session: { ok: true },
      buckets: [],
      trends: [],
      advances: 0,
      declines: 0,
      unchanged: 0,
      trendCounts: {},
      companies: [],
      lastUpdatedAt: '2026-10-14T09:00:00Z',
    });
    http.expectOne('/api/heatmap?index=SENSEX').flush({
      public: true,
      index: { id: 'SENSEX', name: 'SENSEX', ltp: 74200, change: -40, changePct: -0.05 },
      session: { ok: true },
      buckets: [],
      trends: [],
      advances: 0,
      declines: 0,
      unchanged: 0,
      trendCounts: {},
      companies: [],
      lastUpdatedAt: '2026-10-14T09:00:00Z',
    });
    const body = await pending;
    expect(body.indices[0].ltp).toBe(22640);
    expect(body.stocks[0].symbol).toBe('INFY');
    expect(body.stocks[0].biasLabel).toBe('Mild bullish bias');
    expect(body.warning).toMatch(/droplet/);
    http.verify();
  });
});
