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
    expect(text).toMatch(/Dummy ₹14,000/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/Play next day/);
    expect(text).toMatch(/Reset to ₹14,000/);
    expect(text).toMatch(/Paper only/);
    expect(text).toMatch(/Crude Mini FUT/);
    expect(text).toMatch(/Overall amount/);
    expect(text).toMatch(/Why losers failed/);
    expect(text).toMatch(/Wrong direction/);
    expect(text).toMatch(/Live flip/);
    expect(text).toMatch(/The pattern/);
    expect(text).toMatch(/trend PDHL \+ against VWAP/);
    expect(text).toMatch(/Not armed on Crude Best/);
    expect(text).toMatch(/2-year tape/);
    expect(text).toMatch(/morning structure switch, do not flip/);
    expect(text).toMatch(/not a salary/i);
    expect(text).toMatch(/not a job/i);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hist-card"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="reverse-wrong-dir"]')?.textContent).toBe(
      '34',
    );
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_000);
    expect(fixture.componentInstance['snap']().liveOrders).toBe(false);
    expect(fixture.componentInstance['snap']().guaranteed).toBe(false);
  });

  it('stands down a loss-shaped day, then resets', () => {
    fixture.componentInstance['playNext']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_000);
    expect(fixture.componentInstance['snap']().played).toBe(1);
    expect(fixture.nativeElement.textContent).toMatch(/2026-05-27/);
    expect(fixture.nativeElement.textContent).toMatch(/flat/);
    fixture.componentInstance['resetFund']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(14_000);
    expect(fixture.componentInstance['snap']().played).toBe(0);
  });

  it('plays the full dummy tape with Crude in the overall amount', () => {
    fixture.componentInstance['playAll']();
    fixture.detectChanges();
    expect(fixture.componentInstance['snap']().fundRs).toBe(50_749.5);
    expect(fixture.componentInstance['snap']().done).toBe(true);
    expect(fixture.componentInstance['snap']().redDays).toBe(0);
    expect(fixture.nativeElement.textContent).toMatch(/Tape finished/);
    expect(fixture.nativeElement.textContent).toMatch(/Overall amount/);
    const crude = fixture.componentInstance['snap']().bookScores.find((b) => b.id === 'crude');
    expect(crude?.netRs).toBe(6000);
    expect(fixture.nativeElement.textContent).toMatch(/Crude Mini FUT/);
  });
});
