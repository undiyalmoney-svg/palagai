import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CrudeOilComponent } from './crude-oil.component';

describe('CrudeOilComponent', () => {
  let fixture: ComponentFixture<CrudeOilComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [CrudeOilComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(CrudeOilComponent);
    fixture.detectChanges();
  });

  it('is the Arise desk: mom 0.8× skip range on four option names and five cash stocks', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('[data-testid="crude-oil-page"]')).toBeTruthy();
    expect(text).toMatch(/Arise/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/mom 0\.8× skip range/);
    expect(text).not.toMatch(/algo OR retest/);
    expect(text).not.toMatch(/mix \+ MACD/);
    expect(text).not.toMatch(/algo RSI 14 bounce/);
    expect(text).not.toMatch(/algo EMA 21 pullback/);
    expect(text).not.toMatch(/algo Bollinger mean/);
    expect(text).not.toMatch(/vwap stretch/);
    expect(text).toMatch(/cancels the SL and sells MARKET/);
    expect(text).toMatch(/Paper only/);
    expect(text).toMatch(/Live Kite/);
    expect(text).toMatch(/Place real Kite order and SL/);
    expect(text).toMatch(/Closed today/);
    expect(text).toMatch(/Copy night log/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/Hunt stays paper-only on the four index names/);
    expect(text).toMatch(/09:45 IST/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-kite"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-radio-on"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-bank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-sensex"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-hdfcbank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-book-tcs"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-bank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-sensex"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-reliance"]')).toBeTruthy();
    expect(text).toMatch(/1% day is ₹370/);
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-fills"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="start-live-paper"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="stop-live-paper"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="start-live-money"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt"]')).toBeNull();
    expect(text).not.toMatch(/Start live money/i);
    expect(text).not.toMatch(/CRUDEOILM FUT/);
    expect(fixture.componentInstance['paper'].liveArmed()).toBe(false);
    expect(fixture.componentInstance['paper'].liveBooks().nifty).toBe(false);
    expect(fixture.componentInstance['paper'].liveBooks().crude).toBe(false);
  });

  it('arms Live Kite only after Live is on and a book is ticked', () => {
    const paper = fixture.componentInstance['paper'];
    expect(paper.liveArmed()).toBe(false);
    (fixture.nativeElement.querySelector('[data-testid="paper-live-radio-on"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(paper.liveToggle()).toBe(true);
    expect(paper.liveArmed()).toBe(false);
    (fixture.nativeElement.querySelector('[data-testid="paper-live-book-bank"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(paper.liveBooks().bank).toBe(true);
    expect(paper.liveArmed()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-warn"]')).toBeTruthy();
    expect((fixture.nativeElement.querySelector('[data-testid="paper-live-badge"]') as HTMLElement).textContent).toMatch(
      /Real Kite on/,
    );
    (fixture.nativeElement.querySelector('[data-testid="paper-live-radio-off"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(paper.liveArmed()).toBe(false);
  });
});
