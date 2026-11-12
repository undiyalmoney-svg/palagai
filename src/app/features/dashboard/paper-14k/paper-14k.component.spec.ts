import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Paper14kComponent } from './paper-14k.component';

describe('Paper14kComponent', () => {
  let fixture: ComponentFixture<Paper14kComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Paper14kComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Paper14kComponent);
    fixture.detectChanges();
  });

  it('is a live paper desk: Start, four instrument cards, no Kite order', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Paper only/);
    expect(text).toMatch(/buy CE\/PE/);
    expect(text).toMatch(/Hit Start/);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/From 09:00 MCX open/);
    expect(text).toMatch(/own fill/);
    expect(text).toMatch(/target nets ₹370/);
    expect(text).toMatch(/Live Kite/);
    expect(text).toMatch(/Place real Kite orders and resting SLs/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-toggle"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-confirm"]')).toBeTruthy();
    expect((fixture.nativeElement.querySelector('[data-testid="paper-live-badge"]') as HTMLElement).textContent).toMatch(
      /Paper only/,
    );
    expect(text).not.toMatch(/Opening range/);
    expect(text).not.toMatch(/Prev-day break/);
    expect(text).not.toMatch(/VWAP fade/);
    expect(text).not.toMatch(/Failed break/);
    expect(text).not.toMatch(/Watch-only desks/);
    expect(text).toMatch(/Closed today/);
    expect(text).toMatch(/Copy night log/);
    expect(text).toMatch(/Paper only until Live Kite/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).not.toMatch(/Play next day/);
    expect(text).not.toMatch(/2-year tape/);
    expect(text).not.toMatch(/Why losers failed/);
    expect(text).not.toMatch(/More daily profit/);
    expect(text).not.toMatch(/Run live assumption/);
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-card"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-bank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-sensex"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="book-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="start-live-paper"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="copy-night-log"]')).toBeTruthy();
    expect(fixture.componentInstance['paper'].session().liveOrders).toBe(false);
    expect(fixture.componentInstance['paper'].session().guaranteed).toBe(false);
    expect(fixture.componentInstance['paper'].session().books).toHaveLength(4);
    expect(fixture.componentInstance['booksFund']()).toBe(56_000);
    expect(fixture.nativeElement.querySelector('[data-testid="desk-scalp"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="desk-watch"]')).toBeNull();
  });

  it('says the Now card is watching Nifty, Bank and Sensex momentum', () => {
    const paper = fixture.componentInstance['paper'];
    const cur = paper.session();
    paper.session.set({
      ...cur,
      running: true,
      kiteError: null,
      asOf: new Date().toISOString(),
      books: cur.books.map((b) => ({ ...b, last: 24000 })),
    });
    fixture.detectChanges();
    const title = (fixture.nativeElement.querySelector('[data-testid="paper-now-title"]') as HTMLElement).textContent || '';
    expect(title).toMatch(/Nifty, Bank Nifty, Sensex and Crude Mini from 09:00/);
    expect(title).not.toMatch(/watch-only/);
  });

  it('arms live Kite only after the toggle and the checkbox are both on', () => {
    const paper = fixture.componentInstance['paper'];
    const toggle = fixture.nativeElement.querySelector('[data-testid="paper-live-toggle"]') as HTMLButtonElement;
    const box = fixture.nativeElement.querySelector('[data-testid="paper-live-confirm"]') as HTMLInputElement;
    toggle.click();
    fixture.detectChanges();
    expect(paper.liveArmed()).toBe(false);
    expect((fixture.nativeElement.querySelector('[data-testid="paper-live-badge"]') as HTMLElement).textContent).toMatch(
      /Paper only/,
    );
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(paper.liveArmed()).toBe(true);
    expect(paper.session().liveOrders).toBe(true);
    expect((fixture.nativeElement.querySelector('[data-testid="paper-live-badge"]') as HTMLElement).textContent).toMatch(
      /Real Kite on/,
    );
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-warn"]')).toBeTruthy();
  });

  it('asks for Token when Start is hit without a Kite session', async () => {
    await fixture.componentInstance['startPaper']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/Connect Kite on Token first/);
    expect(fixture.componentInstance['paper'].session().running).toBe(false);
    expect(fixture.componentInstance['paper'].session().liveOrders).toBe(false);
  });
});
