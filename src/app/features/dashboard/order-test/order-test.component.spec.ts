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

  it('is IP smoke only — paper hunt is gone', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/RELIANCE/);
    expect(text).toMatch(/IP smoke/);
    expect(text).not.toMatch(/Hit Start/);
    expect(text).not.toMatch(/Paper test/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="start-live-paper"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-14k-page"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="order-test-ip-hero"]')).toBeTruthy();
  });
});
