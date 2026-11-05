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
    expect(text).toMatch(/Evening from 17:15/);
    expect(text).toMatch(/Opening range/);
    expect(text).toMatch(/Prev-day break/);
    expect(text).toMatch(/VWAP fade/);
    expect(text).toMatch(/Failed break/);
    expect(text).toMatch(/Scalp/);
    expect(text).toMatch(/Capital/);
    expect(text).toMatch(/Closed today/);
    expect(text).toMatch(/Copy night log/);
    expect(text).toMatch(/no Kite order/);
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
    expect(fixture.componentInstance['paper'].session().books).toHaveLength(24);
    expect(fixture.componentInstance['booksFund']()).toBe(336_000);
    expect(fixture.nativeElement.querySelector('[data-testid="desk-scalp"]')).toBeTruthy();
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
    expect(title).toMatch(/Nifty, Bank Nifty, Sensex and evening Crude Mini momentum/);
    expect(title).toMatch(/watch-only/);
  });

  it('asks for Token when Start is hit without a Kite session', async () => {
    await fixture.componentInstance['startPaper']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/Connect Kite on Token first/);
    expect(fixture.componentInstance['paper'].session().running).toBe(false);
    expect(fixture.componentInstance['paper'].session().liveOrders).toBe(false);
  });
});
