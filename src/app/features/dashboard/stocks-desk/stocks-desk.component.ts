import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { StocksPaperDeskService } from '../../../core/paper-desk/stocks-paper-desk.service';
import { StocksWatchlistService } from '../../../core/services/stocks-watchlist.service';
import { StocksMoversService } from '../../../core/services/stocks-movers.service';
import { InstrumentStoreService } from '../../../core/services/instrument-store.service';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import {
  STOCKS_CAPITAL_RS,
  STOCKS_DAY_LOSS_RS,
  STOCKS_MAX_LEGS,
  StocksStrategyId,
} from '../../../core/strategy-engine/strategies/stocks-equity/stocks-equity.evaluator';
import { formatUnknownError } from '../../../core/utils/kite-error.util';

@Component({
  selector: 'app-stocks-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, PercentPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './stocks-desk.component.html',
  styleUrl: './stocks-desk.component.css',
})
export class StocksDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(StocksPaperDeskService);
  private readonly watch = inject(StocksWatchlistService);
  private readonly moversSvc = inject(StocksMoversService);
  private readonly instruments = inject(InstrumentStoreService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly kiteApi = inject(KiteApiService);

  protected readonly mode = signal<PaperDeskMode>('testing');
  protected fromDate = shiftDays(-60);
  protected toDate = todayIso();
  protected realOrders = false;
  protected realOrdersAck = false;
  protected strategyId: StocksStrategyId = 'ALMOST_GREEN_MIX';
  protected includeTopGainers = true;
  protected maxLegs = 3;
  protected customSymbol = '';
  protected readonly error = signal('');
  protected readonly resolveHint = signal('');
  protected readonly moversBusy = signal(false);

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly watchlist = this.watch.watchlist;
  protected readonly movers = this.moversSvc.snapshot;
  protected readonly strategyOptions = this.desk.strategyOptions();
  protected readonly capitalRs = STOCKS_CAPITAL_RS;
  protected readonly dayLossRs = STOCKS_DAY_LOSS_RS;
  protected readonly maxLegsCap = STOCKS_MAX_LEGS;

  async ngOnInit(): Promise<void> {
    try {
      await this.instruments.refreshBestEffort(false);
    } catch {
      /* watchlist tokens still work */
    }
  }

  protected resetTreasure(): void {
    this.watch.resetToTreasure();
    this.resolveHint.set('Restored research treasure watchlist (customs kept).');
  }

  ngOnDestroy(): void {
    this.desk.stopLive();
  }

  protected setMode(mode: PaperDeskMode): void {
    if (this.busy()) {
      this.desk.cancelRun();
    } else if (this.snapshot().running) {
      this.desk.stopLive();
    }
    this.mode.set(mode);
    this.error.set('');
    if (mode === 'testing') {
      this.realOrders = false;
      this.realOrdersAck = false;
    }
  }

  protected toggleStock(symbol: string, enabled: boolean): void {
    this.watch.setEnabled(symbol, enabled);
  }

  protected removeStock(symbol: string): void {
    this.watch.remove(symbol);
  }

  protected async addCustomStock(): Promise<void> {
    this.error.set('');
    this.resolveHint.set('');
    const q = this.customSymbol.trim().toUpperCase();
    if (!q) {
      this.error.set('Enter a stock symbol (e.g. RELIANCE, CANBK, HDFCBANK).');
      return;
    }
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('Connect Kite token first (Get Token), then add the stock.');
      return;
    }
    try {
      // Force refresh if empty / stale so new names resolve
      await this.instruments.refreshBestEffort(this.instruments.allInstruments().length < 100);
      let exact: {
        tradingSymbol: string;
        name: string;
        instrumentToken: number;
      } | null = (() => {
        const hit = this.instruments.findNseEquityExact(q);
        return hit
          ? {
              tradingSymbol: hit.tradingSymbol,
              name: hit.name || hit.tradingSymbol,
              instrumentToken: hit.instrumentToken,
            }
          : null;
      })();

      // Quote fallback — works even if CSV search missed the EQ row
      if (!exact) {
        exact = await this.resolveViaQuote(q);
      }

      if (!exact) {
        this.error.set(
          `No NSE equity found for “${q}”. Try Get Token → refresh instruments, then add again.`,
        );
        return;
      }
      this.watch.upsertCustom({
        symbol: exact.tradingSymbol.toUpperCase(),
        name: exact.name || exact.tradingSymbol,
        instrumentToken: exact.instrumentToken,
        enabled: true,
      });
      this.resolveHint.set(
        `Added ${exact.tradingSymbol} · token ${exact.instrumentToken} · ${exact.name}`,
      );
      this.customSymbol = '';
    } catch (e) {
      this.error.set(formatUnknownError(e));
    }
  }

  /** Resolve NSE:SYMBOL via Kite quote when instrument dump search fails. */
  private async resolveViaQuote(symbol: string): Promise<{
    tradingSymbol: string;
    name: string;
    instrumentToken: number;
  } | null> {
    const auth = this.kiteSession.getAuthorizationHeader();
    if (!auth) return null;
    const key = `NSE:${symbol}`;
    try {
      const body = (await firstValueFrom(this.kiteApi.getQuotes(auth, [key]))) as {
        status?: string;
        data?: Record<string, { instrument_token?: number; last_price?: number }>;
        message?: string;
      };
      if (body.status === 'error' || !body.data?.[key]) {
        return null;
      }
      const token = Number(body.data[key]!.instrument_token ?? 0);
      if (!token) return null;
      // Prefer dump row if token known
      const fromDump = this.instruments.getByToken(token);
      if (fromDump) {
        return {
          tradingSymbol: fromDump.tradingSymbol,
          name: fromDump.name || fromDump.tradingSymbol,
          instrumentToken: fromDump.instrumentToken,
        };
      }
      return {
        tradingSymbol: symbol,
        name: symbol,
        instrumentToken: token,
      };
    } catch {
      return null;
    }
  }

  protected async addMoverToWatch(symbol: string): Promise<void> {
    this.customSymbol = symbol;
    await this.addCustomStock();
  }

  protected async refreshMovers(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('Connect Kite token first (Get Token).');
      return;
    }
    this.moversBusy.set(true);
    try {
      await this.instruments.ensureLoaded();
      await this.moversSvc.refreshMovers({ topN: 10 });
    } catch (e) {
      this.error.set(formatUnknownError(e));
    } finally {
      this.moversBusy.set(false);
    }
  }

  protected async runTesting(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('Connect Kite token first (Get Token).');
      return;
    }
    try {
      await this.desk.runTesting(this.fromDate, this.toDate, this.strategyId);
    } catch (e) {
      this.error.set(formatUnknownError(e));
    }
  }

  protected async startLive(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('Connect Kite token first (Get Token).');
      return;
    }
    if (this.realOrders && !this.realOrdersAck) {
      this.error.set('Confirm Live money acknowledgment.');
      return;
    }
    try {
      await this.desk.startLive({
        realOrders: this.realOrders,
        strategyId: this.strategyId,
        includeTopGainers: this.includeTopGainers,
        maxLegs: this.maxLegs,
      });
    } catch (e) {
      this.error.set(formatUnknownError(e));
    }
  }

  protected stop(): void {
    if (this.busy()) {
      this.desk.cancelRun();
    } else {
      this.desk.stopLive();
    }
  }

  protected capitalPerLeg(): number {
    const n = Math.max(1, Math.min(this.maxLegsCap, this.maxLegs));
    return Math.round(this.capitalRs / n);
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
