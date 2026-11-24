import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptySniperSession } from '../../../core/sniper/sniper-engine';
import { SNIPER_EVENT_STEPS, SNIPER_STOP_RS, SNIPER_TARGET_RS } from '../../../core/sniper/sniper.models';
import { SniperComponent } from './sniper.component';

describe('SniperComponent', () => {
  let fixture: ComponentFixture<SniperComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SniperComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(SniperComponent);
    fixture.detectChanges();
  });

  it('is a Bank Nifty PE desk with ₹750 SL, ₹750 sell, and a live tape', () => {
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent as string;
    expect(el.querySelector('[data-testid="sniper-page"]')).toBeTruthy();
    expect(text).toMatch(/Bank Nifty/);
    expect(text).not.toMatch(/Nifty 50/);
    expect(text).not.toMatch(/Sensex/);
    expect(text).not.toMatch(/Crude Mini/);
    expect(el.querySelector('[data-testid="sniper-paper"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-live"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-bank"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-nifty"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="sniper-book-sensex"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="sniper-instrument"]')?.textContent).toMatch(/Bank Nifty/);
    expect(el.querySelector('[data-testid="sniper-live-tape"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-sl"]')?.textContent).toMatch(String(SNIPER_STOP_RS));
    expect(el.querySelector('[data-testid="sniper-tp"]')?.textContent).toMatch(String(SNIPER_TARGET_RS));
    expect(el.querySelector('[data-testid="sniper-events"]')).toBeTruthy();
    for (const step of SNIPER_EVENT_STEPS) {
      expect(text).toContain(step.label);
    }
    expect(fixture.componentInstance['sniper'].session().stopRs).toBe(750);
    expect(fixture.componentInstance['sniper'].session().targetRs).toBe(750);
    expect(fixture.componentInstance['sniper'].session().books).toHaveLength(1);
    expect(fixture.componentInstance['sniper'].session().books[0].id).toBe('bank');
    expect(fixture.componentInstance['sniper'].session().liveArmed).toBe(false);
  });

  it('shows the chosen ATM PE and live pulse', () => {
    const sniper = fixture.componentInstance['sniper'];
    const s = emptySniperSession('2026-11-23');
    s.selected = 'bank';
    s.asOf = '2026-11-23T04:11:00.000Z';
    s.books = s.books.map((b) => ({
      ...b,
      event: 'trade_taken' as const,
      cut: 'down' as const,
      cutMin: 570,
      redHigh: 52030,
      side: 'long' as const,
      optionType: 'PE' as const,
      optionSymbol: 'BANKNIFTY26NOV52000PE',
      sl: 76,
      tp: 126.5,
      lots: 1,
      qty: 30,
      entry: 101,
      last: 108,
      spot: 52030,
      peBid: 107,
      peAsk: 108.5,
      peLast: 108,
      minute: { day: '2026-11-23', min: 571, open: 52010, high: 52040, low: 52000, close: 52030 },
      pulse: [{ min: 571, at: s.asOf, spot: 52030, peLast: 108, text: '09:31 Bank 52030 · BANKNIFTY26NOV52000PE ask 108.5 · live ₹210' }],
      reason: 'open PE · SL ₹76 · sell ₹126.5',
    }));
    sniper.session.set(s);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bank = el.querySelector('[data-testid="sniper-book-bank"]') as HTMLElement;
    expect(bank.getAttribute('data-event')).toBe('trade_taken');
    expect(el.querySelector('[data-testid="sniper-pe-symbol"]')?.textContent).toMatch(/BANKNIFTY26NOV52000PE/);
    expect(el.querySelector('[data-testid="sniper-spot"]')?.textContent).toMatch(/52,030/);
    expect(el.querySelector('[data-testid="sniper-pulse"]')?.textContent).toMatch(/Bank 52030/);
    expect(el.querySelector('[data-testid="sniper-events"] .sniper-chip.now[data-event="trade_taken"]')).toBeTruthy();
    expect(el.textContent).toMatch(/SL ₹/);
    expect(el.textContent).toMatch(/750/);
    expect(el.textContent).toMatch(/Sell ₹/);
  });
});
