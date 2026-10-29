import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { HistoricalBacktestApiService } from './historical-backtest-api.service';
import { HistoricalBacktestComponent } from './historical-backtest.component';
import { DiscoverResult } from './historical-backtest.models';

describe('HistoricalBacktestComponent', () => {
  let fixture: ComponentFixture<HistoricalBacktestComponent>;
  const startMock = vi.fn(() => Promise.resolve({ id: 'job-1', status: 'running' }));

  beforeEach(async () => {
    startMock.mockClear();
    await TestBed.configureTestingModule({
      imports: [HistoricalBacktestComponent],
      providers: [
        provideRouter([]),
        {
          provide: HistoricalBacktestApiService,
          useValue: {
            start: startMock,
            job: () => new Promise(() => undefined),
            startDiscover: () => Promise.resolve({ id: 'disc-1', status: 'running' }),
            discoverJob: () => new Promise(() => undefined),
            discoverSpace: () =>
              Promise.resolve({
                liveOrders: false,
                count: 12,
                baselineId: 'baseline-first15-twored-sl-eod-ms3-risk',
                candidates: [],
              }),
            listDiscoveries: () => Promise.resolve({ experiments: [] }),
            discoverCandidate: () => Promise.resolve({ simulated: true, liveOrders: false, candidate: {}, trades: [] }),
            startDailyProfit: () => Promise.resolve({ id: 'profit-1', status: 'running' }),
            dailyProfitJob: () => new Promise(() => undefined),
            dailyProfitSpace: () => Promise.resolve({ liveOrders: false, count: 20, families: ['or30_break', 'gap_continue'] }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HistoricalBacktestComponent);
    fixture.detectChanges();
  });

  it('states that the book is simulated and never live', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Simulated historical first-15 book/i);
    expect(text).toMatch(/No live orders are placed/i);
    expect(text).toMatch(/Nifty 500/i);
    expect(text).toMatch(/Starting capital/i);
    expect(text).toMatch(/Max stocks/);
    expect(text).toMatch(/Entry and exit/i);
    expect(text).toMatch(/fully close/i);
    expect(text).toMatch(/two red 5-minute candles/i);
    expect(text).toMatch(/15:15 close/i);
    expect(text).toMatch(/Max amount went/i);
    expect(text).toMatch(/₹10k winner desk/i);
    expect(text).toMatch(/skip 09:45 short-crowd/i);
    expect(text).toMatch(/5 widest signal-candle stops/i);
    expect(text).toMatch(/Daily profit/i);
  });

  it('keeps daily profit idle until a research job finishes', async () => {
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="profit-tab"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = el.textContent as string;
    expect(text).toMatch(/Daily profit portfolio discovery/i);
    expect(text).toMatch(/not guaranteed/i);
    expect(text).toMatch(/No daily-profit numbers are shown until a completed research job exists/i);
    expect(el.querySelector('[data-testid="profit-idle"]')).toBeTruthy();
  });

  it('posts the ₹10k winner desk when Run backtest is clicked', async () => {
    const cmp = fixture.componentInstance;
    expect(cmp['capital']).toBe(10000);
    expect(cmp['maxStocksPerDay']).toBe(5);
    expect(cmp['rankBy']).toBe('stopPct');
    expect(cmp['crowdFilter']).toBe('skipShort');
    await cmp['run']();
    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capital: 10000,
        maxStocksPerDay: 5,
        rankBy: 'stopPct',
        crowdFilter: 'skipShort',
        preset: 'winner',
      }),
    );
  });

  it('lists ORB-crossed names from the result', () => {
    fixture.componentInstance['result'].set({
      simulated: true,
      liveOrders: false,
      config: {
        capital: 40000,
        maxStocksPerDay: 3,
        orEnd: '09:30',
        entryEnd: '14:30',
        timeExit: '15:15',
      },
      assumptions: [],
      rawTrades: 0,
      summary: {
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        netPnl: 0,
        returnPct: 0,
        maxDrawdown: 0,
        capitalUtilized: 0,
        capitalUtilizedPct: 0,
        avgWin: 0,
        avgLoss: 0,
        equityCurve: [],
        stocks: [],
        days: 1,
        orbCrossed: 1,
        orbCrossedTaken: 0,
        slHits: 0,
        eodExits: 0,
        maxWentRs: 120,
        snapshots: [
          {
            day: '2026-10-16',
            t: '10:30',
            label: '10:30',
            netRs: 40,
            slHits: 0,
            open: 1,
            taken: 1,
            maxWentRs: 80,
          },
          {
            day: '2026-10-16',
            t: '15:15',
            label: 'EOD',
            netRs: 90,
            slHits: 0,
            open: 0,
            taken: 1,
            maxWentRs: 120,
          },
        ],
      },
      trades: [],
      crosses: [
        {
          symbol: 'RELIANCE',
          day: '2026-10-16',
          side: 'L',
          t: '10:10',
          close: 103,
          orh: 102,
          orl: 99.8,
          orWPct: 2.2,
          qualified: false,
          taken: false,
        },
      ],
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/15-minute crossed/i);
    expect(text).toMatch(/RELIANCE/);
    expect(text).toMatch(/Crossed only/);
    expect(text).toMatch(/Every 30 minutes/i);
    expect(text).toMatch(/EOD/);
    expect(text).toMatch(/Max went/i);
  });

  it('keeps automated discovery off the main nav and idle until a job finishes', async () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="discover-tab"]')?.textContent).toMatch(/Automated discovery/i);
    expect(el.textContent).not.toMatch(/Best validated candidate/i);
    (el.querySelector('[data-testid="discover-tab"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = el.textContent as string;
    expect(text).toMatch(/Automated ORB strategy discovery/i);
    expect(text).toMatch(/No performance numbers are shown until a completed research job exists/i);
    expect(text).not.toMatch(/Best validated candidate/i);
    expect(text).not.toMatch(/₹40,000/);
    expect(el.querySelector('[data-testid="discover-idle"]')).toBeTruthy();
  });

  it('states that no robust strategy was found instead of labelling a loser profitable', async () => {
    const cmp = fixture.componentInstance;
    await cmp['setPage']('discover');
    cmp['discoverResult'].set({
      simulated: true,
      liveOrders: false,
      capital: 40000,
      candidatesEvaluated: 12,
      minTrades: 8,
      noRobust: 'No sufficiently robust profitable strategy found in this search.',
      recommended: null,
      rankings: { bestBalancedRobust: null, highestNet: 'loser-1' },
      leaderboard: [
        {
          rank: 1,
          id: 'loser-1',
          name: 'Last entry 11:00',
          entryRule: 'first-15',
          cutoff: '11:00',
          exitRule: 'EOD',
          stopLoss: 'signal low',
          target: 'None',
          stockCount: 3,
          sizing: 'risk',
          netPnl: -1200,
          returnPct: -0.03,
          maxDrawdown: 1800,
          profitFactor: 0.4,
          expectancy: -40,
          trades: 10,
          weeks: 2,
          profitableWeekPct: 0,
          validationStatus: 'oos_reported',
          profitable: false,
          oosNet: -1200,
        },
      ],
      dailyWinners: [
        {
          day: '2026-10-16',
          bestId: 'loser-1',
          bestName: 'Last entry 11:00',
          netPnl: -80,
          trades: 1,
          stocks: ['AAA'],
          entries: [{ symbol: 'AAA', side: 'L', in: '10:05', out: '15:15', qty: 10, netRs: -80 }],
          runnerUpId: null,
          runnerUpNet: 0,
          gap: 0,
          prospectiveId: null,
          prospectiveNet: null,
          selection: 'retrospective',
          note: 'Best configuration for this day is chosen after seeing the day’s simulated P/L. It was not knowable before the open.',
        },
      ],
      weeklyWinners: [],
      assumptions: ['Simulated MIS research. No live orders are placed.'],
    } as DiscoverResult);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/No sufficiently robust profitable strategy found in this search/);
    expect(text).not.toMatch(/Best validated candidate/i);
    expect(text).toMatch(/Not profitable/);
    expect(text).toMatch(/Retrospective/);
    expect(text).toMatch(/not knowable before the open/i);
    expect(text).toMatch(/Live orders: no/i);
  });

  it('shows the validated candidate first when the engine recommends one', async () => {
    const cmp = fixture.componentInstance;
    await cmp['setPage']('discover');
    cmp['discoverResult'].set({
      simulated: true,
      liveOrders: false,
      capital: 40000,
      candidatesEvaluated: 12,
      minTrades: 4,
      noRobust: null,
      recommended: {
        id: 'baseline-first15-twored-sl-eod-ms3-risk',
        name: 'Original first-15 two-low SL/EOD',
        rules: {
          entry: 'Mark 09:15–09:30 high/low. A later 15-minute candle must fully close beyond that range.',
          cutoff: 'No new entries after 14:30 IST',
          exit: 'Stop is the signal-candle low. Leftover positions exit at 15:15 IST (EOD).',
          stopLoss: 'Signal-candle low (long) or high (short)',
          target: 'None — decide from 30-minute marks / EOD',
          stockCount: '3 names / day, first eligible by entry time',
          sizing: 'Risk-based: ~0.75% of capital per signal-candle range',
        },
        config: { maxStocksPerDay: 3, sizing: 'risk' },
        oos: {
          netPnl: 2400,
          returnPct: 0.06,
          maxDrawdown: 400,
          profitFactor: 1.8,
          expectancy: 80,
          trades: 12,
          weeks: 3,
          profitableWeekPct: 0.66,
          capitalUtilized: 18000,
        },
        why: ['Chosen on training days, compared on validation, reported on out-of-sample.'],
        risks: ['Past simulated P/L is not a live-trading guarantee.'],
        trades: [
          {
            symbol: 'AAA',
            day: '2026-10-16',
            side: 'L',
            entryT: '10:05',
            exitT: '15:15',
            exitReason: 'EOD',
            entryPx: 103,
            exitPx: 104.7,
            stopPx: 101.85,
            qty: 40,
            grossRs: 68,
            chargesRs: 8,
            netRs: 60,
            notionalRs: 4120,
          },
        ],
        stocks: [{ symbol: 'AAA', trades: 4, netRs: 2400 }],
        equityCurve: [
          { day: 'start', equity: 40000 },
          { day: '2026-10-16', equity: 42400 },
        ],
      },
      rankings: { bestBalancedRobust: 'baseline-first15-twored-sl-eod-ms3-risk' },
      leaderboard: [
        {
          rank: 1,
          id: 'baseline-first15-twored-sl-eod-ms3-risk',
          name: 'Original first-15 two-low SL/EOD',
          isBaseline: true,
          experimental: false,
          entryRule: 'first-15 two-low',
          cutoff: '14:30',
          exitRule: 'EOD 15:15',
          stopLoss: 'signal low',
          target: 'None',
          stockCount: 3,
          sizing: 'risk',
          netPnl: 2400,
          returnPct: 0.06,
          maxDrawdown: 400,
          profitFactor: 1.8,
          expectancy: 80,
          trades: 12,
          weeks: 3,
          profitableWeekPct: 0.66,
          validationStatus: 'oos_positive',
          profitable: true,
          oosNet: 2400,
        },
      ],
      dailyWinners: [],
      weeklyWinners: [],
      capitalSensitivity: [{ capital: 40000, netPnl: 2400, returnPct: 0.06, maxDrawdown: 400, trades: 12, capitalUtilized: 18000 }],
      costSensitivity: [{ slippage: 0.0005, netPnl: 2400, trades: 12, maxDrawdown: 400 }],
    } as DiscoverResult);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Best validated candidate/i);
    expect(text).toMatch(/Original first-15 two-low SL\/EOD/);
    expect(text).toMatch(/fully close beyond that range/);
    expect(text).toMatch(/Capital sensitivity/i);
    expect(text).toMatch(/Cutoff and exit lab/i);
  });
});
