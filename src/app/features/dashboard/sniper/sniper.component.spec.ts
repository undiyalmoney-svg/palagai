import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptySniperSession } from '../../../core/sniper/sniper-engine';
import { SNIPER_EVENT_STEPS, SNIPER_STOP_RS } from '../../../core/sniper/sniper.models';
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

  it('is a three-index ORB desk with ₹750 SL and event colors', () => {
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent as string;
    expect(el.querySelector('[data-testid="sniper-page"]')).toBeTruthy();
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).not.toMatch(/Crude Mini/);
    expect(text).not.toMatch(/mom 0\.8× skip range/);
    expect(el.querySelector('[data-testid="sniper-paper"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-live"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-nifty"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-bank"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-sensex"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-book-crude"]')).toBeFalsy();
    const sl = el.querySelector('[data-testid="sniper-sl"]') as HTMLInputElement;
    expect(sl.value).toBe(String(SNIPER_STOP_RS));
    expect(el.querySelector('[data-testid="sniper-events"]')).toBeTruthy();
    for (const step of SNIPER_EVENT_STEPS) {
      expect(text).toContain(step.label);
    }
    expect(fixture.componentInstance['sniper'].session().stopRs).toBe(750);
    expect(fixture.componentInstance['sniper'].session().books).toHaveLength(3);
    expect(fixture.componentInstance['sniper'].session().liveArmed).toBe(false);
  });

  it('paints the five events and parks the two unused books', () => {
    const sniper = fixture.componentInstance['sniper'];
    const s = emptySniperSession('2026-11-23');
    s.selected = 'nifty';
    s.stopRs = 750;
    s.books = s.books.map((b) => {
      if (b.id === 'nifty') {
        return {
          ...b,
          event: 'trade_taken',
          cut: 'up',
          cutMin: 570,
          redHigh: 24130,
          side: 'long',
          optionType: 'CE',
          optionSymbol: 'NIFTY26NOV25000CE',
          sl: 89.5,
          tp: 117,
          lots: 1,
          qty: 65,
          entry: 101,
          last: 103,
          reason: 'open CE · SL ₹89.5',
        };
      }
      return { ...b, event: 'parked' as const, reason: 'idle · Nifty 50 first' };
    });
    sniper.session.set(s);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const nifty = el.querySelector('[data-testid="sniper-book-nifty"]') as HTMLElement;
    const bank = el.querySelector('[data-testid="sniper-book-bank"]') as HTMLElement;
    const sensex = el.querySelector('[data-testid="sniper-book-sensex"]') as HTMLElement;
    expect(nifty.getAttribute('data-event')).toBe('trade_taken');
    expect(bank.getAttribute('data-event')).toBe('parked');
    expect(sensex.getAttribute('data-event')).toBe('parked');
    expect(bank.classList.contains('sniper-parked')).toBe(true);
    expect(sensex.classList.contains('sniper-parked')).toBe(true);
    expect(bank.textContent).toMatch(/idle/);
    expect(el.querySelector('[data-testid="sniper-events"] .sniper-chip.now[data-event="trade_taken"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sniper-events"] .sniper-chip.on[data-event="orb_break"]')).toBeTruthy();
    expect(el.textContent).toMatch(/SL ₹/);
    expect(el.textContent).toMatch(/750/);
  });
});
