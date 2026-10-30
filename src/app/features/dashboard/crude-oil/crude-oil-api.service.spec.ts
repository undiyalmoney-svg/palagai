import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { CrudeOilApiService } from './crude-oil-api.service';

describe('CrudeOilApiService', () => {
  function setup(auth = 'token key:secret') {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CrudeOilApiService,
        { provide: KiteSessionService, useValue: { getAuthorizationHeader: () => auth } },
      ],
    });
    return {
      api: TestBed.inject(CrudeOilApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('starts live money with the confirm checkbox and stops flatten', async () => {
    const { api, http } = setup();
    const pending = api.startLiveMoney();
    const req = http.expectOne('/api/crude-live/start');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    expect(req.request.body).toEqual({ confirm: true });
    req.flush({
      status: 'ok',
      liveOrders: true,
      money: { enabled: true, liveOrders: true, fills: [], guaranteed: false },
    });
    await expect(pending).resolves.toMatchObject({ liveOrders: true });

    const stop = api.stopLiveMoney();
    const stopReq = http.expectOne('/api/crude-live/stop');
    expect(stopReq.request.method).toBe('POST');
    stopReq.flush({ status: 'ok', liveOrders: false, money: { enabled: false, liveOrders: false, fills: [] } });
    await expect(stop).resolves.toMatchObject({ liveOrders: false });

    const status = api.status();
    const statusReq = http.expectOne('/api/crude-live/status');
    expect(statusReq.request.method).toBe('GET');
    statusReq.flush({
      status: 'ok',
      liveOrders: false,
      money: {
        enabled: false,
        contract: { tradingSymbol: 'CRUDEOILM26NOVFUT', expiry: '2026-11-17', expiryDay: true },
      },
    });
    await expect(status).resolves.toMatchObject({
      money: { contract: { tradingSymbol: 'CRUDEOILM26NOVFUT' } },
    });
    http.verify();
  });
});
