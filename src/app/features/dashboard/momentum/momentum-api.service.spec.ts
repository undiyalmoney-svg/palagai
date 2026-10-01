import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MomentumApiService } from './momentum-api.service';

describe('MomentumApiService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MomentumApiService],
    });
    return {
      api: TestBed.inject(MomentumApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('asks the server for advice with only the fields the caller passed', async () => {
    const { api, http } = setup();
    const pending = api.advice({ capital: 100000 });
    const req = http.expectOne('/api/momentum/advice');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ capital: 100000 });
    req.flush({ status: 'ok', answer: 'WAIT', decisions: [] });
    await pending;
    http.verify();
  });

  it('sends paper dates and capital to the desk replay', async () => {
    const { api, http } = setup();
    const pending = api.deskPaper({ capital: 200000, from: '2024-01-01', to: '2024-12-31' });
    const req = http.expectOne('/api/momentum/desk/paper');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ capital: 200000, from: '2024-01-01', to: '2024-12-31' });
    req.flush({ status: 'ok', closed: [], open: [], totalProfit: 0 });
    await pending;
    http.verify();
  });

  it('runs a saved decision against the chosen book', async () => {
    const { api, http } = setup();
    const pending = api.runDecision('PAPER', true);
    const req = http.expectOne('/api/momentum/decisions/run');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ mode: 'PAPER', forceReview: true });
    req.flush({ status: 'ok', persisted: true, decisions: [] });
    await pending;
    http.verify();
  });
});
