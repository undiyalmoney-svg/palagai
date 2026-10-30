import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrudeOilApiService } from './crude-oil-api.service';
import { CrudeOilComponent } from './crude-oil.component';

describe('CrudeOilComponent', () => {
  let fixture: ComponentFixture<CrudeOilComponent>;
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
        profileId: 'weekly-bank-sc8',
        entryStart: '10:00',
        entryEnd: '23:00',
        flatten: '23:10',
        stopPts: 20,
        targetPts: 30,
        dayLockPts: 20,
        dayLossPts: 40,
        maxTrades: 2,
        weekLockPts: 40,
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
      imports: [CrudeOilComponent],
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
    fixture = TestBed.createComponent(CrudeOilComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the next-month contract on expiry day and the 10:00–23:00 window', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/CRUDEOILM26NOVFUT/);
    expect(text).toMatch(/Expiry day · next month/);
    expect(text).toMatch(/10:00–23:00/);
    expect(text).toMatch(/flatten 23:10/);
    expect(text).toMatch(/week lock \+40/);
    expect(text).toMatch(/Scratch 8/);
    expect(text).toMatch(/TP 30/);
    expect(text).toMatch(/Start live money/i);
    expect(text).toMatch(/Not a guaranteed profit/);
    expect(text).toMatch(/₹14,000 capital/);
    expect(text).toMatch(/Nifty 50/);
    expect(text).toMatch(/Bank Nifty/);
    expect(text).toMatch(/Sensex/);
    expect(text).toMatch(/blocked/);
    expect(text).toMatch(/Crude Mini futures ×1/);
    expect(text).toMatch(/next listed future/i);
    expect(text).toMatch(/never the dying week/i);
  });

  it('arms real-money scanning only after the confirm checkbox', async () => {
    const cmp = fixture.componentInstance;
    const startBtn = fixture.nativeElement.querySelector('[data-testid="start-live-money"]') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    const box = fixture.nativeElement.querySelector('[data-testid="live-money-confirm"]') as HTMLInputElement;
    box.click();
    fixture.detectChanges();
    expect(cmp['liveConfirmOk']()).toBe(true);
    expect((fixture.nativeElement.querySelector('[data-testid="start-live-money"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
    await cmp['startLiveMoney']();
    expect(startLiveMoneyMock).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/Real money is on/);
    expect(text).toMatch(/rolled to the next month/);
  });
});
