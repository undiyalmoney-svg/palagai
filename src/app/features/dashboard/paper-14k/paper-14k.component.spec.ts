import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Paper14kComponent } from './paper-14k.component';

describe('Paper14kComponent', () => {
  let fixture: ComponentFixture<Paper14kComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Paper14kComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Paper14kComponent);
    fixture.detectChanges();
  });

  it('is a dummy 14k desk that does not place Kite orders', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Dummy ₹14,000 desk/);
    expect(text).toMatch(/does not talk to Kite/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/Play next session/);
    expect(text).toMatch(/Reset to ₹14,000/);
    expect(text).toMatch(/Paper only/);
    expect(text).toMatch(/Crude Mini FUT/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_000);
    expect(fixture.componentInstance['snap']().liveOrders).toBe(false);
    expect(fixture.componentInstance['snap']().guaranteed).toBe(false);
  });

  it('plays a dummy day, marks the fund, then resets', () => {
    fixture.componentInstance['playNext']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_050);
    expect(fixture.componentInstance['snap']().played).toBe(1);
    expect(fixture.nativeElement.textContent).toMatch(/2026-07-22/);
    fixture.componentInstance['resetFund']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_000);
    expect(fixture.componentInstance['snap']().played).toBe(0);
  });

  it('plays the full dummy tape and keeps the fund above zero', () => {
    fixture.componentInstance['playAll']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(52_031);
    expect(fixture.componentInstance['snap']().done).toBe(true);
    expect(fixture.componentInstance['snap']().skipped).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toMatch(/Tape finished/);
    expect(fixture.nativeElement.textContent).toMatch(/Overall amount/);
    const crude = fixture.componentInstance['snap']().bookScores.find((b) => b.id === 'crude');
    expect(crude?.netRs).toBe(7040);
    expect(fixture.nativeElement.textContent).toMatch(/Crude Mini FUT/);
  });
});
