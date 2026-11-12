import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { realisticFill } from '../../../core/paper-desk/execution-model.util';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PaperTrade } from '../../../core/paper-desk/paper-analytics.models';
import { computeMetrics } from '../../../core/paper-desk/paper-analytics.util';
import { PaperAnalyticsComponent } from './paper-analytics.component';
import { Paper14kComponent } from './paper-14k.component';

function trade(over: Partial<PaperTrade>): PaperTrade {
  return {
    id: String(Math.random()),
    day: '2026-11-03',
    book: 'sensex',
    label: 'Sensex',
    optionSymbol: 'SENSEX2661077000CE',
    optionType: 'CE',
    strike: 77000,
    expiry: '2026-11-06',
    qty: 20,
    structure: 'trend',
    mode: 'pdhl',
    reason: 'tp',
    entry: 172.55,
    exit: 204.55,
    sl: 156.55,
    tp: 204.55,
    paperNetRs: 590,
    entryBid: 172,
    entryAsk: 173,
    exitBid: null,
    exitAsk: null,
    entryAt: '2026-11-03T05:40:00.000Z',
    exitAt: '2026-11-03T06:10:00.000Z',
    signal: null,
    ...over,
  };
}

const TRADES: PaperTrade[] = [
  trade({ id: 'a' }),
  trade({
    id: 'b',
    book: 'nifty',
    label: 'Nifty 50',
    qty: 65,
    entry: 100,
    exit: 80,
    reason: 'sl',
    paperNetRs: -1350,
    entryBid: null,
    entryAsk: null,
    exitAt: '2026-11-03T07:00:00.000Z',
  }),
  trade({
    id: 'c',
    book: 'bank',
    label: 'Bank Nifty',
    structure: 'range',
    qty: 30,
    entry: 100,
    exit: 90,
    reason: 'scratch',
    paperNetRs: -350,
    entryBid: 99,
    entryAsk: 101,
    exitBid: 89,
    exitAsk: 91,
    exitAt: '2026-11-03T08:00:00.000Z',
  }),
];

describe('PaperAnalyticsComponent', () => {
  let fixture: ComponentFixture<PaperAnalyticsComponent>;

  function seed(trades: PaperTrade[]): void {
    localStorage.setItem(
      'palagai_paper_ledger_v1',
      JSON.stringify({ version: 1, trades, observedDays: ['2026-11-03'] }),
    );
  }

  async function mount(view: string, trades: PaperTrade[] = TRADES): Promise<void> {
    localStorage.clear();
    seed(trades);
    await TestBed.configureTestingModule({
      imports: [PaperAnalyticsComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(PaperAnalyticsComponent);
    fixture.componentRef.setInput('view', view);
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const q = (id: string) => (fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.textContent?.trim();

  beforeEach(() => TestBed.resetTestingModule());

  it('shows every trade including losers, with counts that add up', async () => {
    await mount('performance');
    expect(q('kpi-trades')).toBe('3');
    expect(q('kpi-wins')).toBe('1');
    expect(q('kpi-losses')).toBe('2');
    expect(q('kpi-winrate')).toBe('33.3%');
    const nets = TRADES.map((t) => realisticFill(t).netRs);
    const m = computeMetrics(nets);
    expect(q('kpi-net')).toContain(Math.abs(Math.round(m.netRs)).toLocaleString('en-IN'));
    expect(q('kpi-net')).toContain('−');
    expect(text()).toMatch(/Max drawdown/);
    expect(text()).toMatch(/Profit factor/);
    expect(text()).toMatch(/Simulation · not broker-verified/);
  });

  it('switches to the existing paper engine figures on request', async () => {
    await mount('performance');
    (fixture.nativeElement.querySelector('[data-testid="basis-paper"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('kpi-net')).toContain('1,110');
    expect(q('kpi-net')).toContain('−');
  });

  it('refuses to project profit from three trades', async () => {
    await mount('performance');
    expect(q('scenario-insufficient')).toMatch(/Projections are switched off/);
    expect(fixture.nativeElement.querySelector('[data-testid="scenario-table"]')).toBeNull();
    expect(text()).toMatch(/not guaranteed profits/);
  });

  it('compares paper with execution-adjusted P&L and flags unverified fills', async () => {
    await mount('compare');
    const paper = TRADES.reduce((s, t) => s + t.paperNetRs, 0);
    expect(q('cmp-paper')).toContain(Math.abs(paper).toLocaleString('en-IN'));
    const real = TRADES.reduce((s, t) => s + realisticFill(t).netRs, 0);
    expect(q('cmp-real')).toContain(Math.abs(Math.round(real)).toLocaleString('en-IN'));
    expect(text()).toMatch(/modelled \(unverified\)/);
    expect(text()).toMatch(/unverified simulation/i);
  });

  it('says not enough data for live and never calls a small sample ready', async () => {
    await mount('validation');
    expect(q('verdict')).toMatch(/not enough data/);
    expect(text()).toMatch(/no statistically validated edge/);
    expect(text()).toMatch(/modelled premiums/);
  });

  it('shows skipped signals instead of hiding a priced-out book', async () => {
    await mount('signals');
    expect(q('skipped-empty')).toMatch(/No skipped signals/);
    const paper = (fixture.componentInstance as unknown as { paper: LivePaperService }).paper;
    const cur = paper.session();
    paper.session.set({
      ...cur,
      books: cur.books.map((b, i) =>
        i === 0
          ? {
              ...b,
              skips: [
                {
                  at: '2026-11-03T04:00:00.000Z',
                  day: '2026-11-03',
                  book: 'bank',
                  side: 'CE',
                  mode: 'pdhl',
                  structure: 'trend',
                  contract: 'BANKNIFTY 57000 CE',
                  premium: 700,
                  lot: 30,
                  costRs: 21000,
                  budgetRs: 3500,
                  reason: 'premium-over-budget',
                },
              ],
            }
          : b,
      ),
    });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="skipped-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('21,000');
    expect(rows[0].textContent).toContain('3,500');
  });

  it('lists the full trade history', async () => {
    await mount('trades');
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="history-table"] tbody tr');
    expect(rows.length).toBe(3);
    expect(fixture.nativeElement.textContent).toMatch(/Grade/);
    const grades = [...fixture.nativeElement.querySelectorAll('[data-testid="history-grade"]')].map(
      (el) => (el.textContent || '').trim(),
    );
    expect(grades).toContain('A');
    expect(grades).toContain('F');
    expect(grades).toContain('C');
  });
});

describe('Paper14kComponent views', () => {
  it('keeps four instrument cards and Closed today, with liveOrders false', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Paper14kComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    const f = TestBed.createComponent(Paper14kComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="live-paper-card"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="book-nifty"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="book-bank"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="book-sensex"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="book-crude"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="desk-orb"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="desk-scalp"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="desk-watch"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="live-paper-fills"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="view-performance"]')).toBeNull();
    expect(f.componentInstance['paper'].session().liveOrders).toBe(false);
  });

  it('never claims profit is guaranteed', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Paper14kComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    const f = TestBed.createComponent(Paper14kComponent);
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-testid="paper-now"]') as HTMLElement).textContent).toMatch(
      /Not a guaranteed profit/,
    );
    expect(f.componentInstance['paper'].session().liveOrders).toBe(false);
    expect(f.componentInstance['paper'].session().guaranteed).toBe(false);
  });
});
