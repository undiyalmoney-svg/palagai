import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrudeOilApiService } from '../crude-oil/crude-oil-api.service';
import { CrudeBestComponent } from './crude-best.component';

describe('CrudeBestComponent', () => {
  let fixture: ComponentFixture<CrudeBestComponent>;
  const idleMoney = {
    enabled: false,
    liveOrders: false,
    date: '2026-10-16',
    weekNetPts: 0,
    dayNetPts: 0,
    tradesToday: 0,
    contract: {
      tradingSymbol: 'CRUDEOILM26NOVFUT',
      instrumentToken: 222,
      expiry: '2026-11-17',
      lotSize: 1,
      tickSize: 1,
      expiryDay: true,
    },
    fills: [] as unknown[],
    lastTick: null as string | null,
    lastError: null as string | null,
    lastMessage: null as string | null,
    sessionOk: false,
    guaranteed: false,
  };
  let moneyState = { ...idleMoney };
  const statusMock = vi.fn(() =>
    Promise.resolve({
      status: 'ok',
      liveOrders: moneyState.enabled,
      dna: {
        profileId: 'daily-min-sc10',
        entryStart: '10:00',
        entryEnd: '23:00',
        flatten: '23:10',
        stopPts: 20,
        targetPts: 25,
        dayLockPts: 20,
        dayLossPts: 40,
        maxTrades: 2,
        weekLockPts: 0,
        rupeesPerPoint: 10,
        chargeRs: 50,
        qty: 1,
      },
      money: { ...moneyState },
    }),
  );
  const startLiveMoneyMock = vi.fn(() => {
    moneyState = {
      ...idleMoney,
      enabled: true,
      liveOrders: true,
      lastMessage: 'Live Crude Mini armed. 1 lot CRUDEOILM FUT. Entries 10:00–23:00 IST.',
      sessionOk: true,
    };
    return Promise.resolve({ status: 'ok', liveOrders: true, money: { ...moneyState } });
  });
  const stopLiveMoneyMock = vi.fn(() => {
    moneyState = { ...idleMoney, lastMessage: 'Live Crude Mini stopped. Flat.' };
    return Promise.resolve({ status: 'ok', liveOrders: false, money: { ...moneyState } });
  });

  beforeEach(async () => {
    statusMock.mockClear();
    startLiveMoneyMock.mockClear();
    stopLiveMoneyMock.mockClear();
    moneyState = { ...idleMoney };
    await TestBed.configureTestingModule({
      imports: [CrudeBestComponent],
      providers: [
        provideRouter([]),
        {
          provide: CrudeOilApiService,
          useValue: {
            status: statusMock,
            startLiveMoney: startLiveMoneyMock,
            stopLiveMoney: stopLiveMoneyMock,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CrudeBestComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('is a Token-then-Start desk for the daily-min Crude Mini book', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Your job/);
    expect(text).toMatch(/Start trading/i);
    expect(text).toMatch(/Get a Kite access token/);
    expect(text).toMatch(/any time on the day/i);
    expect(text).toMatch(/System takes care/);
    expect(text).toMatch(/next listed CRUDEOILM FUT/);
    expect(text).toMatch(/1 lot only/);
    expect(text).toMatch(/hard SL-M 20/);
    expect(text).toMatch(/TP 25/);
    expect(text).toMatch(/₹200/);
    expect(text).toMatch(/CRUDEOILM26NOVFUT/);
    expect(text).toMatch(/Expiry day · next month/);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/guaranteed-profit test/);
    expect(text).toMatch(/0 passed/);
    expect(text).toMatch(/Historical 5-minute candles/);
    expect(text).toMatch(/does not create a guaranteed profit/);
    expect(text).toMatch(/Every-day green: fail/);
    expect(text).toMatch(/guaranteed: false/);
    expect(text).not.toMatch(/guaranteed:\s*true/i);
    expect(fixture.componentInstance['liveMoney']()?.guaranteed).toBe(false);
    expect(fixture.componentInstance['tape'].guaranteed).toBe(false);
    expect(fixture.componentInstance['tape'].everyDayGreen).toBe(false);
  });

  it('arms the shared 1-lot worker only after the confirm checkbox', async () => {
    const cmp = fixture.componentInstance;
    const startBtn = fixture.nativeElement.querySelector('[data-testid="start-trading"]') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    const box = fixture.nativeElement.querySelector('[data-testid="start-trading-confirm"]') as HTMLInputElement;
    box.click();
    fixture.detectChanges();
    expect(cmp['liveConfirmOk']()).toBe(true);
    expect((fixture.nativeElement.querySelector('[data-testid="start-trading"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
    await cmp['startLiveMoney']();
    expect(startLiveMoneyMock).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Real money is on/);
    expect(text).toMatch(/cannot double the lot/);
  });
});
