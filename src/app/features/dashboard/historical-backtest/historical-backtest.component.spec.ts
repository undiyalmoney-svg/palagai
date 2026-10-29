import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { HistoricalBacktestApiService } from './historical-backtest-api.service';
import { HistoricalBacktestComponent } from './historical-backtest.component';

describe('HistoricalBacktestComponent', () => {
  let fixture: ComponentFixture<HistoricalBacktestComponent>;
  const startMock = vi.fn(() => Promise.resolve({ id: 'job-1', status: 'running' }));
  const startLiveMock = vi.fn(() => Promise.resolve({ id: 'live-1', status: 'running', liveOrders: false }));
  const idleMoney = {
    enabled: false,
    liveOrders: false,
    date: '2026-10-29',
    crowd: null as string | null,
    capital: 0,
    fundsRs: 0,
    doneToday: false,
    fills: [] as unknown[],
    lastTick: null as string | null,
    lastError: null as string | null,
    lastMessage: null as string | null,
    sessionOk: false,
    guaranteed: false,
  };
  let moneyState = { ...idleMoney };
  const liveMoneyStatusMock = vi.fn(() =>
    Promise.resolve({ status: 'ok', liveOrders: moneyState.enabled, money: { ...moneyState } }),
  );
  const startLiveMoneyMock = vi.fn(() => {
    moneyState = {
      ...idleMoney,
      enabled: true,
      liveOrders: true,
      capital: 670,
      fundsRs: 670,
      lastMessage:
        'Live money armed. Scanning every Nifty 500 closed 5-minute bar from 09:45 to 14:30 — not a 09:50 one-shot.',
      sessionOk: true,
    };
    return Promise.resolve({ status: 'ok', liveOrders: true, money: { ...moneyState } });
  });
  const stopLiveMoneyMock = vi.fn(() => {
    moneyState = { ...idleMoney, lastMessage: 'Live money stopped. Flat.' };
    return Promise.resolve({ status: 'ok', liveOrders: false, money: { ...moneyState } });
  });

  beforeEach(async () => {
    startMock.mockClear();
    startLiveMock.mockClear();
    liveMoneyStatusMock.mockClear();
    startLiveMoneyMock.mockClear();
    stopLiveMoneyMock.mockClear();
    moneyState = { ...idleMoney };
    await TestBed.configureTestingModule({
      imports: [HistoricalBacktestComponent],
      providers: [
        provideRouter([]),
        {
          provide: HistoricalBacktestApiService,
          useValue: {
            start: startMock,
            startLiveToday: startLiveMock,
            liveMoneyStatus: liveMoneyStatusMock,
            startLiveMoney: startLiveMoneyMock,
            stopLiveMoney: stopLiveMoneyMock,
            job: () => new Promise(() => undefined),
            startDiscover: () => Promise.resolve({ id: 'disc-1', status: 'running' }),
            discoverJob: () => new Promise(() => undefined),
            discoverSpace: () => Promise.resolve({ liveOrders: false, count: 1, baselineId: 'pdh-follow-crowd', candidates: [] }),
            listDiscoveries: () => Promise.resolve({ experiments: [] }),
            discoverCandidate: () => Promise.resolve({ simulated: true, liveOrders: false, candidate: {}, trades: [] }),
            startDailyProfit: () => Promise.resolve({ id: 'profit-1', status: 'running' }),
            dailyProfitJob: () => new Promise(() => undefined),
            dailyProfitSpace: () => Promise.resolve({ liveOrders: false, count: 1, families: ['pdh_break'] }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HistoricalBacktestComponent);
    fixture.detectChanges();
  });

  it('states the prior-day follow desk is simulated and never live', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Simulated prior-day break book/i);
    expect(text).toMatch(/No live orders are placed/i);
    expect(text).toMatch(/Nifty 500/i);
    expect(text).toMatch(/Starting capital/i);
    expect(text).toMatch(/follow the 09:45 crowd/i);
    expect(text).not.toMatch(/Entry and exit/i);
    expect(text).not.toMatch(/Daily profit/i);
    expect(text).not.toMatch(/Automated discovery/i);
    expect(text).not.toMatch(/₹10k winner desk/i);
  });

  it('auto-picks 5 names on ₹10k and 8 names on ₹40k', () => {
    const cmp = fixture.componentInstance;
    expect(cmp['capital']).toBe(10000);
    expect(cmp['autoNames']()).toBe(5);
    cmp['capital'] = 40000;
    fixture.detectChanges();
    expect(cmp['autoNames']()).toBe(8);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Auto-trades 8 names/i);
  });

  it('posts only capital so the server auto-trades the prior-day follow book', async () => {
    const cmp = fixture.componentInstance;
    cmp['capital'] = 10000;
    await cmp['run']();
    expect(startMock).toHaveBeenCalledWith({
      from: expect.any(String),
      to: expect.any(String),
      capital: 10000,
    });
  });

  it('loads live today from Kite cash with a 1R lock and never posts the backtest capital', async () => {
    const cmp = fixture.componentInstance;
    cmp['setMode']('live');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Live today uses your Kite cash/i);
    expect(text).toMatch(/not a guaranteed profit/i);
    expect(text).toMatch(/Load live today/i);
    expect(text).toMatch(/size the 1R book from Kite cash/i);
    expect(text).toMatch(/Start live money/i);
    expect(text).toMatch(/Stop flatten/i);
    expect(text).toMatch(/09:45 to 14:30/i);
    expect(text).not.toMatch(/Starting capital/i);
    expect(text).not.toMatch(/Enter capital and run/i);
    await cmp['run']();
    expect(startLiveMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('arms real-money scanning only after START LIVE MONEY', async () => {
    const cmp = fixture.componentInstance;
    cmp['livePhrase'] = 'START LIVE MONEY';
    cmp['setMode']('live');
    fixture.detectChanges();
    expect(cmp['livePhraseOk']()).toBe(true);
    const startBtn = fixture.nativeElement.querySelector('[data-testid="start-live-money"]') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);
    await cmp['startLiveMoney']();
    expect(startLiveMoneyMock).toHaveBeenCalledWith('START LIVE MONEY');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Real money is on/i);
    expect(text).toMatch(/not a 09:50 one-shot/i);
  });

  it('lists prior-day breaks from the result', () => {
    fixture.componentInstance['result'].set({
      simulated: true,
      liveOrders: false,
      family: 'pdh_break',
      config: {
        capital: 10000,
        maxStocksPerDay: 5,
        orEnd: '09:30',
        entryEnd: '14:30',
        timeExit: '15:15',
        crowdFilter: 'follow',
        rankBy: 'stopPct',
      },
      assumptions: [],
      rawTrades: 1,
      summary: {
        trades: 1,
        wins: 1,
        losses: 0,
        winRate: 1,
        netPnl: 90,
        returnPct: 0.009,
        maxDrawdown: 0,
        capitalUtilized: 4120,
        capitalUtilizedPct: 0.41,
        avgWin: 90,
        avgLoss: 0,
        equityCurve: [],
        stocks: [{ symbol: 'RELIANCE', trades: 1, wins: 1, netRs: 90, winRate: 1 }],
        days: 1,
        orbCrossed: 1,
        orbCrossedTaken: 1,
        slHits: 0,
        eodExits: 1,
        maxWentRs: 120,
      },
      trades: [
        {
          symbol: 'RELIANCE',
          day: '2026-10-16',
          side: 'L',
          entryT: '09:55',
          exitT: '15:15',
          exitReason: 'EOD',
          entryPx: 103,
          exitPx: 104.7,
          stopPx: 101,
          qty: 40,
          grossRs: 68,
          chargesRs: 8,
          netRs: 60,
          notionalRs: 4120,
          maxWentRs: 120,
        },
      ],
      lastBook: {
        day: '2026-10-16',
        capital: 10000,
        stocks: [
          {
            symbol: 'RELIANCE',
            side: 'L',
            entryT: '09:55',
            exitT: '15:15',
            exitReason: 'EOD',
            entryPx: 103,
            qty: 40,
            allocatedRs: 4120,
            netRs: 60,
            chargesRs: 8,
          },
        ],
        trades: 1,
        winners: 1,
        losers: 0,
        grossPnl: 68,
        costs: 8,
        netPnl: 60,
        allocatedRs: 4120,
      },
      crosses: [
        {
          symbol: 'RELIANCE',
          day: '2026-10-16',
          side: 'L',
          t: '09:50',
          close: 103,
          orh: 103,
          orl: 101,
          orWPct: 1.9,
          qualified: true,
          taken: true,
        },
      ],
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Prior-day breaks/i);
    expect(text).toMatch(/RELIANCE/);
    expect(text).toMatch(/Auto-traded/);
    expect(text).toMatch(/Last session book/i);
    expect(text).toMatch(/Live orders: no/i);
  });

  it('prints the 1R promised lock against actual open P/L', () => {
    fixture.componentInstance['result'].set({
      simulated: true,
      liveOrders: false,
      family: 'pdh_break',
      config: {
        capital: 670,
        maxStocksPerDay: 1,
        entryEnd: '14:30',
        timeExit: '15:15',
        crowdFilter: 'follow',
        rankBy: 'stopPct',
        targetR: 1,
      },
      assumptions: [],
      rawTrades: 1,
      promised: {
        targetR: 1,
        fundsRs: 670,
        capitalRs: 670,
        names: 1,
        promisedRs: 5,
        lockedRs: 0,
        openRs: 1.2,
        stoppedRs: 0,
        actualRs: 1.2,
        riskRs: 5,
        liveOrders: false,
        guaranteed: false,
      },
      summary: {
        trades: 1,
        wins: 1,
        losses: 0,
        winRate: 1,
        netPnl: 1.2,
        returnPct: 0.0018,
        maxDrawdown: 0,
        capitalUtilized: 400,
        capitalUtilizedPct: 0.6,
        avgWin: 1.2,
        avgLoss: 0,
        equityCurve: [],
        stocks: [],
        days: 1,
        orbCrossed: 1,
        orbCrossedTaken: 1,
        slHits: 0,
        eodExits: 0,
      },
      trades: [],
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Promised lock \(1R\)/i);
    expect(text).toMatch(/Not a guarantee/i);
    expect(text).toMatch(/Kite funds/i);
    expect(text).toMatch(/Open — 1R not reached/);
  });
});
