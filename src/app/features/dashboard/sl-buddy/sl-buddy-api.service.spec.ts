import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { SlBuddyApiService } from './sl-buddy-api.service';
import { SlBuddyPageComponent } from './sl-buddy-page.component';

describe('SlBuddyApiService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SlBuddyApiService,
        {
          provide: KiteSessionService,
          useValue: { getAuthorizationHeader: () => 'token key:secret' },
        },
      ],
    });
    return {
      api: TestBed.inject(SlBuddyApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('loads pending, live and SL lists from the backend', async () => {
    const { api, http } = setup();
    const pending = api.get();
    const req = http.expectOne('/api/sl-buddy');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    req.flush({
      status: 'ok',
      buddy: { watching: false, pending: [{ instrument: 'NIFTY25CE', qty: 65 }], live: [], sl: [] },
      rules: [{ book: 'nifty', label: 'Nifty 50', offset: 25, rule: 'Nifty 50 entry minus 25' }],
    });
    const body = await pending;
    expect(body.buddy.pending[0].qty).toBe(65);
    http.verify();
  });

  it('sends Watch my orders as enabled true with the Kite session', async () => {
    const { api, http } = setup();
    const pending = api.setWatching(true);
    const req = http.expectOne('/api/sl-buddy');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ enabled: true });
    expect(req.request.headers.get('X-Kite-Authorization')).toBe('token key:secret');
    req.flush({ status: 'ok', buddy: { watching: true, pending: [], live: [], sl: [] }, rules: [] });
    await pending;
    http.verify();
  });
});

describe('SlBuddyPageComponent', () => {
  it('shows Watch my orders and the three lists from the API', async () => {
    TestBed.configureTestingModule({
      imports: [SlBuddyPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: KiteSessionService,
          useValue: { getAuthorizationHeader: () => 'token key:secret' },
        },
      ],
    });
    const fixture = TestBed.createComponent(SlBuddyPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/sl-buddy').flush({
      status: 'ok',
      buddy: {
        watching: false,
        pending: [{ orderId: '1', instrument: 'NIFTY25CE', bookLabel: 'Nifty 50', qty: 65, price: 180, status: 'OPEN' }],
        live: [
          {
            instrument: 'BANKNIFTY25PE',
            bookLabel: 'Bank Nifty',
            qty: 15,
            entry: 320,
            stop: 265,
            slQty: 15,
            uncoveredQty: 0,
          },
        ],
        sl: [{ orderId: '2', instrument: 'BANKNIFTY25PE', bookLabel: 'Bank Nifty', qty: 15, trigger: 265, status: 'TRIGGER PENDING' }],
      },
      rules: [{ book: 'nifty', label: 'Nifty 50', offset: 25, rule: 'Nifty 50 entry minus 25' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Watch my orders');
    expect(text).toContain('Pending orders');
    expect(text).toContain('Live orders');
    expect(text).toContain('NIFTY25CE');
    expect(text).toContain('BANKNIFTY25PE');
    expect(text).toContain('Nifty 50 entry minus 25');
    http.verify();
    fixture.destroy();
  });
});
