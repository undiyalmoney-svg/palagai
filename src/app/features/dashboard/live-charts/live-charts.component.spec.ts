import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideRouter } from '@angular/router';
import { LiveChartsComponent } from './live-charts.component';
import { LiveChartDataService } from '../../../core/charts/live-chart-data.service';
import { AtmOrderService } from '../../../core/orders/atm-order.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { ChartsProtectApiService } from '../../../core/charts/charts-protect-api.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';

describe('LiveChartsComponent trends', () => {
  let fixture: ComponentFixture<LiveChartsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiveChartsComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: LiveChartDataService, useValue: {} },
        { provide: AtmOrderService, useValue: {} },
        { provide: KiteFundsService, useValue: {} },
        { provide: ChartsProtectApiService, useValue: {} },
        { provide: CapitalPreferenceService, useValue: {} },
        { provide: UiDialogService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiveChartsComponent);
  });

  it('shows Sensex with a continue or wait line, a corner dot and a 15s refresh', () => {
    const panes = fixture.componentInstance['panes']();
    const byId = Object.fromEntries(panes.map((pane) => [pane.def.id, pane]));
    const stretch = (parts: Array<['bullish' | 'bearish' | 'sideways', number]>) => {
      const trendAt: string[] = [];
      for (const [trend, count] of parts) {
        for (let i = 0; i < count; i += 1) trendAt.push(trend);
      }
      const trend = parts[parts.length - 1]?.[0] ?? 'sideways';
      return {
        snapshot: { trend, ltfTrend: trend, htfTrend: trend === 'sideways' ? null : trend, lastChoch: null },
        trendAt,
        htfTrendAt: trendAt.map((bar) => (bar === 'sideways' ? null : bar)),
        structure: [] as unknown[],
        htfAvailable: trend !== 'sideways',
      };
    };
    byId['nifty'] = {
      ...byId['nifty'],
      loading: false,
      smc: stretch([
        ['bullish', 40],
        ['sideways', 5],
        ['bullish', 60],
        ['sideways', 5],
        ['bullish', 20],
      ]) as never,
    };
    const bankBook = stretch([
      ['bearish', 40],
      ['sideways', 5],
      ['bearish', 60],
      ['sideways', 5],
      ['bearish', 20],
    ]);
    for (let i = bankBook.trendAt.length - 15; i < bankBook.trendAt.length; i += 1) {
      bankBook.trendAt[i] = 'bullish';
    }
    byId['bank'] = {
      ...byId['bank'],
      loading: false,
      smc: {
        ...bankBook,
        snapshot: { trend: 'bearish', ltfTrend: 'bullish', htfTrend: 'bearish', lastChoch: 'Bullish' },
      } as never,
    };
    byId['sensex'] = {
      ...byId['sensex'],
      loading: false,
      smc: stretch([
        ['bullish', 80],
        ['sideways', 5],
        ['bullish', 90],
        ['sideways', 5],
        ['bullish', 100],
        ['sideways', 5],
        ['bullish', 30],
      ]) as never,
    };
    byId['crude'] = { ...byId['crude'], loading: false, smc: stretch([['sideways', 20]]) as never };
    fixture.componentInstance['panes'].set([byId['nifty'], byId['bank'], byId['sensex'], byId['crude']]);
    fixture.componentInstance['clock'].set(Date.parse('2026-10-07T06:30:00Z'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nifty 50');
    expect(text).toContain('Uptrend');
    expect(text).toContain('Bank Nifty');
    expect(text).toContain('Downtrend');
    expect(text).toContain('Sensex');
    expect(text).toContain('Crude Oil Mini');
    expect(text).toContain('Sideways');
    expect(text).toContain('Trend continues for next 20 minutes');
    expect(text).toContain('Trend continues for next 60 minutes');
    expect(text).toContain('Wait, it may change');
    expect(text).toContain('Auto refresh every 15 secs');
    expect(text).toContain('Refresh');
    expect(text).not.toContain('Protect');
    expect(text).not.toContain('Buy');
    expect(text).not.toContain('Sell');

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="trend-nifty"]')?.getAttribute('data-lamp')).toBe('up');
    expect(root.querySelector('[data-testid="trend-bank"]')?.getAttribute('data-lamp')).toBe('down');
    expect(root.querySelector('[data-testid="trend-sensex"]')?.getAttribute('data-lamp')).toBe('up');
    expect(root.querySelector('[data-testid="trend-crude"]')?.getAttribute('data-lamp')).toBe('side');
    expect(root.querySelectorAll('.trend-dot').length).toBe(4);
    expect(root.querySelector('[data-testid="trend-refresh"]')).toBeTruthy();
    expect(root.querySelector('.lamp')).toBeNull();
    expect(root.querySelector('canvas')).toBeNull();

    const nifty = root.querySelector('[data-testid="trend-nifty"]')?.textContent ?? '';
    const bank = root.querySelector('[data-testid="trend-bank"]')?.textContent ?? '';
    const crude = root.querySelector('[data-testid="trend-crude"]')?.textContent ?? '';
    expect(nifty).toContain('Trend continues for next 20 minutes');
    const sensex = root.querySelector('[data-testid="trend-sensex"]')?.textContent ?? '';
    expect(sensex).toContain('Trend continues for next 60 minutes');
    expect(bank).toContain('Wait, it may change');
    expect(crude).toContain('Wait, it may change');
  });

  it('counts down a 60 minute continuation instead of switching to wait', () => {
    const panes = fixture.componentInstance['panes']();
    const nifty = panes.find((pane) => pane.def.id === 'nifty');
    if (!nifty) throw new Error('missing nifty');
    const trendAt = Array.from({ length: 90 }, () => 'bullish');
    const snapshot = { trend: 'bullish', ltfTrend: 'bullish', htfTrend: 'bullish', lastChoch: null };
    nifty.smc = {
      snapshot,
      trendAt,
      htfTrendAt: [...trendAt],
      structure: [],
      htfAvailable: true,
    } as never;
    fixture.componentInstance['panes'].set([...panes]);
    const start = Date.parse('2026-10-07T06:30:00Z');
    fixture.componentInstance['clock'].set(start);
    fixture.detectChanges();

    const card = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="trend-nifty"]')?.textContent ?? '';
    expect(card()).toContain('Trend continues for next 90 minutes');

    for (let i = trendAt.length - 15; i < trendAt.length; i += 1) trendAt[i] = 'bearish';
    nifty.smc = {
      snapshot: { ...snapshot, ltfTrend: 'bearish' },
      trendAt: [...trendAt],
      htfTrendAt: Array.from({ length: 90 }, () => 'bullish'),
      structure: [],
      htfAvailable: true,
    } as never;
    fixture.componentInstance['panes'].set(fixture.componentInstance['panes']().map((pane) => (pane.def.id === 'nifty' ? nifty : pane)));
    fixture.componentInstance['clock'].set(start + 20 * 60_000);
    fixture.detectChanges();

    expect(card()).toContain('Trend continues for next 70 minutes');
    expect(card()).not.toContain('Wait, it may change');
  });

  it('drops the live trend after that market has closed', () => {
    const panes = fixture.componentInstance['panes']();
    const trendAt = Array.from({ length: 90 }, () => 'bullish');
    const withTrend = (id: string) => {
      const pane = panes.find((item) => item.def.id === id);
      if (!pane) throw new Error(`missing ${id}`);
      pane.smc = {
        snapshot: { trend: 'bullish', ltfTrend: 'bullish', htfTrend: 'bullish', lastChoch: null },
        trendAt: [...trendAt],
        htfTrendAt: [...trendAt],
        structure: [],
        htfAvailable: true,
      } as never;
      return pane;
    };
    fixture.componentInstance['panes'].set([
      withTrend('nifty'),
      withTrend('bank'),
      withTrend('sensex'),
      withTrend('crude'),
    ]);
    fixture.componentInstance['clock'].set(Date.parse('2026-10-07T12:15:00Z'));
    fixture.detectChanges();

    const card = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="trend-${id}"]`);
    for (const id of ['nifty', 'bank', 'sensex']) {
      const text = card(id)?.textContent ?? '';
      expect(text).toContain('Market closed');
      expect(text).not.toContain('Uptrend');
      expect(text).not.toContain('Trend continues');
      expect(text).not.toContain('Wait, it may change');
      expect(card(id)?.getAttribute('data-lamp')).toBe('wait');
    }
    const crude = card('crude')?.textContent ?? '';
    expect(crude).toContain('Uptrend');
    expect(crude).toContain('Trend continues for next');
    expect(crude).not.toContain('Market closed');
  });
});
