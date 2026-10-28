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
    expect(text).toMatch(/Simulated historical ORB book/i);
    expect(text).toMatch(/No live orders are placed/i);
    expect(text).toMatch(/Nifty 500/i);
    expect(text).toMatch(/Starting capital/i);
    expect(text).toMatch(/Max stocks/);
    expect(text).toMatch(/Entry and exit/i);
    expect(text).toMatch(/closes through ORH/i);
    expect(text).toMatch(/Stop is 1R/i);
    expect(text).toMatch(/Time exit is the 14:50 close/i);
  });

  it('lists ORB-crossed names from the result', () => {
    fixture.componentInstance['result'].set({
      simulated: true,
      liveOrders: false,
      config: {
        capital: 40000,
        maxStocksPerDay: 3,
        targetR: 2,
        orEnd: '09:45',
        entryStart: '09:50',
        entryEnd: '14:30',
        timeExit: '14:50',
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
    expect(text).toMatch(/ORB crossed/i);
    expect(text).toMatch(/RELIANCE/);
    expect(text).toMatch(/Crossed only/);
  });
});
