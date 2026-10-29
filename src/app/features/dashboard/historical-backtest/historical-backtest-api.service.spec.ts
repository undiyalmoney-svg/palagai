import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { HistoricalBacktestApiService } from './historical-backtest-api.service';

describe('HistoricalBacktestApiService', () => {
  function setup(auth = 'token key:secret') {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HistoricalBacktestApiService,
        { provide: KiteSessionService, useValue: { getAuthorizationHeader: () => auth } },
      ],
    });
    return {
      api: TestBed.inject(HistoricalBacktestApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('posts the ₹10k winner desk on a single-book run', async () => {
    const { api, http } = setup();
    const pending = api.start({
      from: '2026-10-16',
      to: '2026-10-16',
      capital: 10000,
      maxStocksPerDay: 5,
      rankBy: 'stopPct',
      crowdFilter: 'skipShort',
      preset: 'winner',
    });
    const req = http.expectOne('/api/orb-backtest/run');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    expect(req.request.body).toEqual({
      from: '2026-10-16',
      to: '2026-10-16',
      capital: 10000,
      maxStocksPerDay: 5,
      rankBy: 'stopPct',
      crowdFilter: 'skipShort',
      preset: 'winner',
    });
    req.flush({ id: 'job-1', status: 'running', liveOrders: false, input: { preset: 'winner', capital: 10000 } });
    await expect(pending).resolves.toMatchObject({ id: 'job-1', liveOrders: false });
    http.verify();
  });

  it('posts a daily-profit search and never marks it live', async () => {
    const { api, http } = setup();
    const pending = api.startDailyProfit({
      from: '2026-09-01',
      to: '2026-10-27',
      capital: 10000,
      budget: 20,
    });
    const req = http.expectOne('/api/daily-profit/run');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    expect(req.request.body).toEqual({
      from: '2026-09-01',
      to: '2026-10-27',
      capital: 10000,
      budget: 20,
    });
    req.flush({ id: 'profit-1', status: 'running', liveOrders: false });
    await expect(pending).resolves.toMatchObject({ id: 'profit-1', liveOrders: false });
    http.verify();
  });

  it('posts a discovery job and polls it with the Kite session header', async () => {
    const { api, http } = setup();
    const pending = api.startDiscover({
      from: '2026-09-22',
      to: '2026-10-27',
      capital: 40000,
      budget: 24,
    });
    const req = http.expectOne('/api/orb-backtest/discover');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    expect(req.request.body).toEqual({
      from: '2026-09-22',
      to: '2026-10-27',
      capital: 40000,
      budget: 24,
    });
    req.flush({ id: 'disc-1', status: 'running', liveOrders: false });
    await expect(pending).resolves.toMatchObject({ id: 'disc-1', liveOrders: false });

    const poll = api.discoverJob('disc-1');
    const get = http.expectOne('/api/orb-backtest/discover/disc-1');
    expect(get.request.method).toBe('GET');
    get.flush({ id: 'disc-1', status: 'done', liveOrders: false, result: { recommended: null, noRobust: 'No sufficiently robust profitable strategy found in this search.' } });
    const body = await poll;
    expect(body.result?.noRobust).toMatch(/No sufficiently robust profitable strategy found/i);
    http.verify();
  });

  it('loads the inspectable search space without enabling live orders', async () => {
    const { api, http } = setup();
    const pending = api.discoverSpace();
    const req = http.expectOne('/api/orb-backtest/discover/space');
    req.flush({
      status: 'ok',
      liveOrders: false,
      count: 12,
      baselineId: 'baseline-first15-twored-sl-eod-ms3-risk',
      candidates: [],
    });
    const body = await pending;
    expect(body.liveOrders).toBe(false);
    expect(body.baselineId).toMatch(/baseline/);
    http.verify();
  });
});
