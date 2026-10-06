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

  it('shows only a traffic light for Nifty, Bank Nifty and Crude', () => {
    const panes = fixture.componentInstance['panes']();
    const byId = Object.fromEntries(panes.map((pane) => [pane.def.id, pane]));
    byId['nifty'] = { ...byId['nifty'], loading: false, smc: { snapshot: { trend: 'bullish' } } as never };
    byId['bank'] = { ...byId['bank'], loading: false, smc: { snapshot: { trend: 'bearish' } } as never };
    byId['crude'] = { ...byId['crude'], loading: false, smc: { snapshot: { trend: 'sideways' } } as never };
    fixture.componentInstance['panes'].set([byId['nifty'], byId['bank'], byId['crude']]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nifty 50');
    expect(text).toContain('Uptrend');
    expect(text).toContain('Bank Nifty');
    expect(text).toContain('Downtrend');
    expect(text).toContain('Crude Oil Mini');
    expect(text).toContain('Sideways');
    expect(text).not.toContain('Protect');
    expect(text).not.toContain('Buy');
    expect(text).not.toContain('Sell');

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="trend-nifty"]')?.getAttribute('data-lamp')).toBe('up');
    expect(root.querySelector('[data-testid="trend-bank"] .lamp.red')?.classList.contains('on')).toBe(true);
    expect(root.querySelector('[data-testid="trend-crude"] .lamp.amber')?.classList.contains('on')).toBe(true);
    expect(root.querySelector('[data-testid="trend-nifty"] .lamp.green')?.classList.contains('on')).toBe(true);
    expect(root.querySelector('canvas')).toBeNull();
  });
});
