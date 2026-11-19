import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
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

  it('is a separate 5-Minute Sniper desk, not Arise', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('[data-testid="sniper-page"]')).toBeTruthy();
    expect(text).toMatch(/5-Minute Sniper/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/₹50,000/);
    expect(text).toMatch(/Live Paper/);
    expect(text).not.toMatch(/mom 0\.8× skip range/);
    expect(text).not.toMatch(/Daily ₹370/);
    expect(fixture.nativeElement.querySelector('[data-testid="sniper-mode-paper"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="sniper-book-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="sniper-book-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="sniper-net"]')).toBeTruthy();
    expect(fixture.componentInstance['sniper'].session().mode).toBe('paper');
    expect(fixture.componentInstance['sniper'].session().liveArmed).toBe(false);
  });
});
