import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Paper14kComponent } from './paper-14k.component';
import { PAPER_HUNT_CAP, PAPER_HUNT_METHODS } from '../../../core/paper-desk/paper-hunt.methods';
import { emptyHunt } from '../../../core/paper-desk/paper-hunt.engine';

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

  it('refresh loads the latest tick only while watching', async () => {
    const paper = fixture.componentInstance['paper'];
    const refresh = vi.spyOn(paper, 'refresh').mockResolvedValue();
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-refresh"]') as HTMLButtonElement).click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('puts Start and Stop at the top and enables only one at a time', () => {
    const start = fixture.nativeElement.querySelector('[data-testid="start-live-paper"]') as HTMLButtonElement;
    const stop = fixture.nativeElement.querySelector('[data-testid="stop-live-paper"]') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
    const paper = fixture.componentInstance['paper'];
    paper.session.set({ ...paper.session(), running: true, kiteError: null });
    fixture.detectChanges();
    expect(start.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
  });

  it('shows only the method hunt: one Start, summary, four tabs, no old desk', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(new RegExp(`${PAPER_HUNT_METHODS.length} methods`));
    expect(text).toMatch(/algo/);
    expect(text).toMatch(new RegExp(`${PAPER_HUNT_CAP.toLocaleString('en-IN')} paper tickets`));
    expect(text).toMatch(/max profit reached/i);
    expect(text).toMatch(/max loss reached/i);
    expect(text).toMatch(/Lowest peak/);
    expect(text).toMatch(/not a guaranteed next move/i);
    expect(text).toMatch(/Live Kite never sees the hunt/);
    expect(text).toMatch(/One Start runs all four/);
    expect(text).toMatch(/Hit Start/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/Crude Mini/);
    expect(text).toMatch(/Last entry/);
    expect(text).toMatch(/Entry price/);
    expect(text).toMatch(/Exit price/);
    expect(text).toMatch(/option premium, not the index/);
    expect(text).toMatch(/Open now/);
    expect(text).toMatch(/Status/);
    expect(text).toMatch(/Profit\/loss/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/Max capital used/);
    expect(text).toMatch(/Win %/);
    expect(text).toMatch(/Leaders/);
    expect(text).toMatch(/mix \+ Supertrend/);
    expect(text).toMatch(/algo EMA 9\/21 CE only/);
    expect(text).toMatch(/open5 zone −0\.4011%/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-leaders"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-leaders-empty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-leaders-copy-all"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-leader-copy"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-view-traded"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-view-green"]')).toBeTruthy();
    expect((fixture.nativeElement.querySelector('[data-testid="paper-hunt-count"]') as HTMLElement).textContent).toMatch(
      new RegExp(`${PAPER_HUNT_METHODS.length} × 4`),
    );
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-refresh"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary-bank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary-sensex"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tabs"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-nifty"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-bank"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-sensex"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-crude"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="start-live-paper"]').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-method"]').length).toBe(
      PAPER_HUNT_METHODS.length,
    );
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-kite"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-live-radio-on"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-card"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="book-nifty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-fills"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="copy-night-log"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-review"]')).toBeNull();
    expect(text).not.toMatch(/Place real Kite order and SL/);
    expect(text).not.toMatch(/Closed today/);
    expect(text).not.toMatch(/A banks ₹370/);
    expect(text).not.toMatch(/Copy night log/);
    expect(text).not.toMatch(/Scout/);
    expect(text).not.toMatch(/Critic/);
    expect(text).not.toMatch(/Judge/);
    expect(text).not.toMatch(/Opening range/);
    expect(text).not.toMatch(/Prev-day break/);
    expect(text).not.toMatch(/VWAP fade/);
    expect(text).not.toMatch(/Failed break/);
    expect(fixture.componentInstance['paper'].liveArmed()).toBe(false);
    expect(fixture.componentInstance['paper'].session().liveOrders).toBe(false);
    expect(fixture.componentInstance['paper'].session().guaranteed).toBe(false);
  });

  it('says Start watches all four names on paper', () => {
    const paper = fixture.componentInstance['paper'];
    const cur = paper.session();
    paper.session.set({
      ...cur,
      running: true,
      kiteError: null,
      asOf: new Date().toISOString(),
    });
    fixture.detectChanges();
    const title = (fixture.nativeElement.querySelector('[data-testid="paper-now-title"]') as HTMLElement).textContent || '';
    expect(title).toMatch(/Nifty, Bank Nifty, Sensex and Crude Mini from 09:00/);
    expect(title).toMatch(new RegExp(`${PAPER_HUNT_METHODS.length} methods`));
    expect(title).not.toMatch(/watch-only/);
  });

  it('asks for Token when Start is hit without a Kite session', async () => {
    await fixture.componentInstance['startPaper']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/Connect Kite on Token first/);
    expect(fixture.componentInstance['paper'].session().running).toBe(false);
    expect(fixture.componentInstance['paper'].session().liveOrders).toBe(false);
    expect(fixture.componentInstance['paper'].liveArmed()).toBe(false);
  });

  it('shows all methods high profit first and a four-name summary', async () => {
    const paper = fixture.componentInstance['paper'];
    const cur = paper.session();
    const hunt = emptyHunt('2026-11-16');
    const nifty = hunt.books.find((b) => b.id === 'nifty-mom-08')!;
    const bank = hunt.books.find((b) => b.id === 'bank-mom-08')!;
    nifty.fills = [
      {
        day: '2026-11-16',
        book: nifty.id,
        label: nifty.label,
        side: 'long',
        entry: 162,
        exit: 141,
        sl: 156,
        tp: 170,
        pts: -21,
        rs: -370,
        reason: 'sl',
        mode: 'momentum',
        optionType: 'CE',
        strike: 25250,
        expiry: '2026-11-17',
        optionSymbol: 'NIFTY26N1725250CE',
        lot: 65,
        entryAt: '2026-11-16T04:00:00.000Z',
        exitAt: '2026-11-16T04:10:00.000Z',
        mfeRs: 80,
        maeRs: -370,
      },
      {
        day: '2026-11-16',
        book: nifty.id,
        label: nifty.label,
        side: 'long',
        entry: 160,
        exit: 168,
        sl: 154,
        tp: 168,
        pts: 8,
        rs: 1977,
        reason: 'tp',
        mode: 'momentum',
        optionType: 'CE',
        strike: 25250,
        expiry: '2026-11-17',
        optionSymbol: 'NIFTY26N1725250CE',
        lot: 65,
        entryAt: '2026-11-16T05:00:00.000Z',
        exitAt: '2026-11-16T05:00:10.000Z',
        mfeRs: 2400,
        maeRs: -90,
      },
    ];
    bank.fills = [
      {
        day: '2026-11-16',
        book: bank.id,
        label: bank.label,
        side: 'long',
        entry: 400,
        exit: 420,
        sl: 380,
        tp: 420,
        pts: 20,
        rs: 1110,
        reason: 'tp',
        mode: 'momentum',
        optionType: 'CE',
        strike: 58000,
        expiry: '2026-11-17',
        optionSymbol: 'BANKNIFTY26N1758000CE',
        lot: 30,
        entryAt: '2026-11-16T04:30:00.000Z',
        exitAt: '2026-11-16T04:31:00.000Z',
        mfeRs: 1110,
        maeRs: -40,
      },
    ];
    paper.session.set({ ...cur, hunt });
    fixture.detectChanges();
    const niftyRows = fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-method"]') as NodeListOf<HTMLElement>;
    expect(niftyRows.length).toBe(PAPER_HUNT_METHODS.length);
    expect(niftyRows[0].getAttribute('data-method')).toBe('mom-08');
    expect(niftyRows[0].textContent).toMatch(/1,607/);
    expect(niftyRows[0].textContent).toMatch(/2,400/);
    expect(niftyRows[0].querySelector('[data-testid="paper-hunt-method-entry-px"]')?.textContent).toMatch(/160/);
    expect(niftyRows[0].querySelector('[data-testid="paper-hunt-method-exit-px"]')?.textContent).toMatch(/168/);
    expect(niftyRows[0].querySelector('[data-testid="paper-hunt-floor"]')?.textContent).toMatch(/80/);
    expect(niftyRows[0].textContent).toMatch(/50/);
    const niftyTickets = fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-ticket"]') as NodeListOf<HTMLElement>;
    expect(niftyTickets.length).toBe(2);
    expect(niftyTickets[0].querySelector('[data-testid="paper-hunt-entry-px"]')?.textContent).toMatch(/160/);
    expect(niftyTickets[0].querySelector('[data-testid="paper-hunt-exit-px"]')?.textContent).toMatch(/168/);
    expect(niftyTickets[0].textContent).toMatch(/1,977/);
    expect(niftyTickets[1].querySelector('[data-testid="paper-hunt-entry-px"]')?.textContent).toMatch(/162/);
    expect(niftyTickets[1].querySelector('[data-testid="paper-hunt-exit-px"]')?.textContent).toMatch(/141/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-leaders-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-leader"]').length).toBeGreaterThanOrEqual(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const copyOne = fixture.nativeElement.querySelector('[data-testid="paper-hunt-leader-copy"]') as HTMLButtonElement;
    expect(copyOne?.textContent).toMatch(/Copy/);
    copyOne.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('Nifty 50 · mom 0.8× both · ₹1,607');
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-leaders-copy-all"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('Bank Nifty · mom 0.8× both · ₹1,110');
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-view-traded"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-method"]').length).toBe(1);
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-view-all"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-method"]').length).toBe(
      PAPER_HUNT_METHODS.length,
    );
    const niftySum = fixture.nativeElement.querySelector('[data-testid="paper-hunt-summary-nifty"]') as HTMLElement;
    expect(niftySum.textContent).toMatch(/mom 0\.8× both/);
    expect(niftySum.textContent).toMatch(/1,977/);
    expect(niftySum.textContent).toMatch(/-370/);
    const bankTab = fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-bank"]') as HTMLButtonElement;
    bankTab.click();
    fixture.detectChanges();
    const bankRows = fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-method"]') as NodeListOf<HTMLElement>;
    expect(bankRows.length).toBe(PAPER_HUNT_METHODS.length);
    expect(bankRows[0].textContent).toMatch(/1,110/);
    expect(bankRows[0].textContent).not.toMatch(/1,607/);
    expect(bankRows[0].querySelector('[data-testid="paper-hunt-method-entry-px"]')?.textContent).toMatch(/400/);
    expect(bankRows[0].querySelector('[data-testid="paper-hunt-method-exit-px"]')?.textContent).toMatch(/420/);
    const bankTickets = fixture.nativeElement.querySelectorAll('[data-testid="paper-hunt-ticket"]') as NodeListOf<HTMLElement>;
    expect(bankTickets.length).toBe(1);
    expect(bankTickets[0].querySelector('[data-testid="paper-hunt-entry-px"]')?.textContent).toMatch(/400/);
    expect(bankTickets[0].querySelector('[data-testid="paper-hunt-exit-px"]')?.textContent).toMatch(/420/);
    expect(bankTickets[0].textContent).not.toMatch(/160\.00/);
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-sensex"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-empty"]')?.textContent).toMatch(/Sensex/);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-tickets"]')).toBeNull();
    (fixture.nativeElement.querySelector('[data-testid="paper-hunt-tab-crude"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="paper-hunt-empty"]')?.textContent).toMatch(/Crude Mini/);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="start-live-paper"]').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid="paper-review"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="live-paper-fills"]')).toBeNull();
  });
});
