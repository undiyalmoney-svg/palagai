import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { HeatmapApiService } from './heatmap-api.service';
import { HeatmapPageComponent } from './heatmap-page.component';
import { HeatmapSnapshot } from './heatmap.models';

function snapshot(): HeatmapSnapshot {
  return {
    public: true,
    index: { id: 'NIFTY50', name: 'NIFTY 50', ltp: 22634.5, change: -87.45, changePct: -0.38 },
    session: { ok: true, dailiesReady: true },
    buckets: [
      { id: 'above-3', label: 'above 3%', tone: 'up-strong' },
      { id: '3-to-1', label: '3% to 1%', tone: 'up' },
      { id: 'below--3', label: 'below -3%', tone: 'down-strong' },
    ],
    trends: [
      { id: 'strong-up', label: 'Strong up' },
      { id: 'strong-down', label: 'Strong down' },
    ],
    advances: 19,
    declines: 30,
    unchanged: 0,
    trendCounts: { 'strong-up': 1, 'strong-down': 1 },
    companies: [
      {
        symbol: 'NESTLEIND',
        name: 'Nestle India',
        sector: 'FMCG',
        mcapRank: 32,
        ltp: 1200,
        change: 27,
        changePct: 2.3,
        high52: 1400,
        low52: 900,
        ema20: 1180,
        ema50: 1100,
        adx: 28,
        trend: 'strong-up',
        trendLabel: 'Strong up',
        score: 2.5,
        bucket: '3-to-1',
      },
      {
        symbol: 'SHRIRAMFIN',
        name: 'Shriram Finance',
        sector: 'FINANCE',
        mcapRank: 41,
        ltp: 700,
        change: -28,
        changePct: -3.94,
        high52: 900,
        low52: 500,
        ema20: 740,
        ema50: 780,
        adx: 26,
        trend: 'strong-down',
        trendLabel: 'Strong down',
        score: -2.5,
        bucket: 'below--3',
      },
      {
        symbol: 'MARUTI',
        name: 'Maruti Suzuki',
        sector: 'AUTO',
        mcapRank: 16,
        ltp: 11272,
        change: 27,
        changePct: 0.24,
        high52: 17370,
        low52: 10725,
        ema20: 11200,
        ema50: 11100,
        adx: 18,
        trend: 'up',
        trendLabel: 'Up',
        score: 1,
        bucket: '1-to--1',
      },
    ],
    lastUpdatedAt: '2026-10-14T07:32:00.000Z',
  };
}

describe('HeatmapApiService', () => {
  it('loads the public heatmap without a site token', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HeatmapApiService],
    });
    const api = TestBed.inject(HeatmapApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = api.snapshot();
    const req = http.expectOne('/api/heatmap');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ status: 'ok', ...snapshot() });
    const body = await pending;
    expect(body.public).toBe(true);
    expect(body.companies).toHaveLength(3);
    http.verify();
  });
});

describe('HeatmapPageComponent', () => {
  it('keeps the company table while a percent chip filters tiles', async () => {
    TestBed.configureTestingModule({
      imports: [HeatmapPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(HeatmapPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/heatmap').flush({ status: 'ok', ...snapshot() });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Index Heatmap');
    expect(el.textContent).toContain('NESTLEIND');
    expect(el.textContent).toContain('Strong up');
    expect(el.textContent).toContain('MARUTI');
    const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('.hm-chip')).find((b) =>
      b.textContent?.includes('below -3%'),
    );
    expect(chip).toBeTruthy();
    chip!.click();
    fixture.detectChanges();
    const tiles = el.querySelectorAll('.hm-tile');
    expect(tiles.length).toBe(1);
    expect(tiles[0]?.textContent).toContain('SHRIRAMFIN');
    expect(el.querySelectorAll('.hm-table tbody tr').length).toBe(3);
  });
});
