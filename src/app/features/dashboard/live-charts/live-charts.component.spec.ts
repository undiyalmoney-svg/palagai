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
    const held = (trend: 'bullish' | 'bearish' | 'sideways') => ({
      snapshot: { trend, ltfTrend: trend, htfTrend: trend === 'sideways' ? null : trend, lastChoch: null },
      trendAt: Array.from({ length: 45 }, () => trend),
      htfTrendAt: Array.from({ length: 45 }, () => (trend === 'sideways' ? null : trend)),
      structure: [] as unknown[],
      htfAvailable: trend !== 'sideways',
    });
    byId['nifty'] = { ...byId['nifty'], loading: false, smc: held('bullish') as never };
    byId['bank'] = {
      ...byId['bank'],
      loading: false,
      smc: {
        ...held('bearish'),
        snapshot: { trend: 'bearish', ltfTrend: 'bullish', htfTrend: 'bearish', lastChoch: 'Bullish' },
      } as never,
    };
    byId['sensex'] = { ...byId['sensex'], loading: false, smc: held('bullish') as never };
    byId['crude'] = { ...byId['crude'], loading: false, smc: held('sideways') as never };
    fixture.componentInstance['panes'].set([byId['nifty'], byId['bank'], byId['sensex'], byId['crude']]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nifty 50');
    expect(text).toContain('Uptrend');
    expect(text).toContain('Bank Nifty');
    expect(text).toContain('Downtrend');
    expect(text).toContain('Sensex');
    expect(text).toContain('Crude Oil Mini');
    expect(text).toContain('Sideways');
    expect(text).toContain('Trend continues for next 45 minutes');
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
    expect(nifty).toContain('Trend continues for next 45 minutes');
    expect(bank).toContain('Wait, it may change');
    expect(crude).toContain('Wait, it may change');
  });
});
