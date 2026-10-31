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

  it('puts Crude Mini on the Test tab so overall amount includes it', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/overall amount/i);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/Dummy ₹14,000/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/Why losers failed/);
    expect(text).toMatch(/Wrong direction/);
    expect(text).toMatch(/The pattern/);
    expect(text).toMatch(/against VWAP/);
    expect(text).toMatch(/2-year tape/);
    expect(text).toMatch(/morning structure switch/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-overall"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-14k-page"]')).toBeTruthy();
    expect(text).toMatch(/RELIANCE/);
  });
});
