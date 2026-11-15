import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { OrderTestComponent } from './order-test.component';

describe('OrderTestComponent', () => {
  let fixture: ComponentFixture<OrderTestComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [OrderTestComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: KiteApiService,
          useValue: {
            pingOrderBackend: () => of({ ok: true }),
            placeRegularOrder: () => of({}),
            getOrders: () => of({}),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OrderTestComponent);
    fixture.detectChanges();
  });

  it('is a Start-only paper hunt for four instrument tabs', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Hit Start/);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/No order is placed/);
    expect(text).toMatch(/methods/);
    expect(text).toMatch(/algo/);
    expect(text).not.toMatch(/2-year tape/);
    expect(text).not.toMatch(/Why losers failed/);
    expect(text).not.toMatch(/More daily profit/);
    expect(text).not.toMatch(/Play next day/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="start-live-paper"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-14k-page"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-card"]')).toBeNull();
    expect(text).toMatch(/RELIANCE/);
  });

  it('leads with the hunt and never claims a guaranteed profit', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="paper-hunt"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="paper-now-badge"]')?.textContent).toMatch(/not watching/);
    expect(el.querySelector('[data-testid="capital-plan-card"]')).toBeNull();
    expect(el.textContent).toMatch(/Not a guaranteed profit/);
  });
});
