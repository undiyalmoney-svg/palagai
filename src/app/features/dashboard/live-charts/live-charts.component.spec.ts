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
import { MarketDeskApiService } from '../../../core/market-desk/market-desk-api.service';

describe('LiveChartsComponent intelligence tab', () => {
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
        {
          provide: MarketDeskApiService,
          useValue: {
            snapshot: () => Promise.resolve(null),
            candles: () => Promise.resolve({ candles: [] }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiveChartsComponent);
    fixture.detectChanges();
  });

  it('hosts the market intelligence board and keeps order buttons off the Charts tab', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="market-heat-board"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="chart-trends"]')).toBeTruthy();
    expect(root.textContent).toContain('Market Intelligence');
    expect(root.textContent).not.toContain('Buy');
    expect(root.textContent).not.toContain('Sell');
    expect(root.textContent).not.toContain('Protect');
    expect(root.querySelector('[data-testid="trend-nifty"]')).toBeNull();
  });
});
