import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { HistoricalBacktestApiService } from './historical-backtest-api.service';
import { HistoricalBacktestComponent } from './historical-backtest.component';

describe('HistoricalBacktestComponent', () => {
  let fixture: ComponentFixture<HistoricalBacktestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoricalBacktestComponent],
      providers: [
        provideRouter([]),
        {
          provide: HistoricalBacktestApiService,
          useValue: {
            start: () => Promise.resolve({ id: 'job-1', status: 'running' }),
            job: () => new Promise(() => undefined),
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
});
