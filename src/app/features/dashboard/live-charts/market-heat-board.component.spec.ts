import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { MarketDeskApiService } from '../../../core/market-desk/market-desk-api.service';
import { MarketDeskSnapshot } from '../../../core/market-desk/market-desk.models';
import { MarketHeatBoardComponent } from './market-heat-board.component';

function snap(): MarketDeskSnapshot {
  return {
    private: true,
    demo: true,
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
      lastTickAt: null,
      lastConfirmedCandleAt: null,
      connection: 'demo',
      freshness: 'missing',
      timeframe: '15minute',
      message: 'DEMO MODE — Kite is not connected.',
    },
    indices: [
      {
        id: 'NIFTY50',
        name: 'NIFTY 50',
        symbol: 'NIFTY50',
        ltp: 22640,
        change: -90,
        changePct: -0.4,
        bias: 'mild-bear',
        biasLabel: 'Mild bearish bias',
        confirmed: false,
        score: -2,
        strength: 'moderate',
        strengthLabel: 'Moderate',
        breakout15: { status: 'none', direction: null, level: null, close: null, closeTime: null, support: null, resistance: null },
        breakout60: { status: 'none', direction: null, level: null, close: null, closeTime: null, support: null, resistance: null },
        agreement: 'mixed',
        m15Trend: 'mixed',
        h1Trend: 'mixed',
        dayTrend: 'mixed',
      },
      {
        id: 'CRUDEOILM',
        name: 'Crude Oil Mini',
        symbol: 'CRUDEOILM',
        ltp: 5452,
        change: 30,
        changePct: 0.55,
        bias: 'mild-bull',
        biasLabel: 'Mild bullish bias',
        confirmed: false,
        score: 2,
        strength: 'moderate',
        strengthLabel: 'Moderate',
        breakout15: { status: 'none', direction: null, level: null, close: null, closeTime: null, support: null, resistance: null },
        breakout60: { status: 'none', direction: null, level: null, close: null, closeTime: null, support: null, resistance: null },
        agreement: 'mixed',
        m15Trend: 'mixed',
        h1Trend: 'mixed',
        dayTrend: 'bullish',
      },
    ],
    stocks: [
      {
        symbol: 'HDFCBANK',
        name: 'HDFC Bank',
        sector: 'BANK',
        ltp: 1650,
        changePct: 1.2,
        bias: 'bullish',
        biasLabel: 'Bullish',
        confirmed: true,
        score: 5,
        strength: 'strong',
        m15Trend: 'bullish',
        h1Trend: 'bullish',
        breakout15: { status: 'confirmed', direction: 'bull', level: 1640, close: 1650, closeTime: null, support: null, resistance: null },
        breakout60: { status: 'none', direction: null, level: null, close: null, closeTime: null, support: null, resistance: null },
        breakoutAgree: false,
        aboveEma20: true,
        aboveEma50: true,
      },
    ],
    breadth: {
      advances: 1,
      declines: 0,
      unchanged: 0,
      adRatio: null,
      adRatioLabel: '∞',
      pctAboveEma20: 100,
      pctAboveEma50: 100,
      strongest: [{ symbol: 'HDFCBANK', changePct: 1.2 }],
      weakest: [{ symbol: 'HDFCBANK', changePct: 1.2 }],
      sectors: [],
      divergence: null,
    },
    setups: [],
    alerts: [],
    warning: 'DEMO MODE. Not live market data.',
  };
}

describe('MarketHeatBoardComponent', () => {
  it('renders the private heat map title, demo banner and a Nifty card', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketHeatBoardComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: MarketDeskApiService, useValue: { snapshot: () => Promise.resolve(snap()), candles: () => Promise.resolve({ candles: [] }) } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<MarketHeatBoardComponent> = TestBed.createComponent(MarketHeatBoardComponent);
    fixture.componentInstance['snap'].set(snap());
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Indian Market Heat Map');
    expect(text).toContain('DEMO MODE');
    expect(text).toContain('NIFTY 50');
    expect(text).toContain('Crude Oil Mini');
    expect(text).toContain('Start');
    expect(text).toContain('Stop');
    expect(text).toContain('Mild bearish bias');
    expect(text).toContain('Nifty 50 stocks');
    expect(text).toContain('HDFCBANK');
    expect(text).toContain('Bullish');
    expect(text).toContain('UP');
    expect(text).toContain('DOWN');
    expect(text).toContain('15m UP');
    expect(text).toContain('1h UP');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="desk-stock-grid"] .tile').length).toBe(1);
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    expect(text).not.toContain('Buy');
    expect(text).not.toContain('Sell');
    expect(fixture.nativeElement.querySelector('[data-testid="desk-start"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="crude-stop"]')).toBeTruthy();
  });

  it('stops live updates from the white Start/Stop controls', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketHeatBoardComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: MarketDeskApiService, useValue: { snapshot: () => Promise.resolve(snap()), candles: () => Promise.resolve({ candles: [] }) } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<MarketHeatBoardComponent> = TestBed.createComponent(MarketHeatBoardComponent);
    fixture.componentInstance['snap'].set(snap());
    fixture.detectChanges();
    fixture.componentInstance['stopDesk']();
    fixture.detectChanges();
    expect(fixture.componentInstance['running']()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Stopped');
  });

  it('shows an empty Nifty 50 board instead of a blank grid', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketHeatBoardComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: MarketDeskApiService, useValue: { snapshot: () => Promise.resolve(null), candles: () => Promise.resolve({ candles: [] }) } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<MarketHeatBoardComponent> = TestBed.createComponent(MarketHeatBoardComponent);
    fixture.componentInstance['snap'].set({ ...snap(), stocks: [] });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nifty 50 stocks');
    expect(text).toContain('Waiting for Nifty 50 quotes');
    expect(fixture.nativeElement.querySelectorAll('.tile').length).toBe(0);
  });
});
