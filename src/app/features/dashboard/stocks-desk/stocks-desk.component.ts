import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { StocksPaperDeskService } from '../../../core/paper-desk/stocks-paper-desk.service';
import { StocksWatchlistService } from '../../../core/services/stocks-watchlist.service';
import { StocksMoversService } from '../../../core/services/stocks-movers.service';
import { InstrumentStoreService } from '../../../core/services/instrument-store.service';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { resolveNseEquitySymbol } from '../../../core/services/stocks-equity-resolve';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import {
  STOCKS_CAPITAL_RS,
  STOCKS_DAY_LOSS_RS,
  STOCKS_MAX_LEGS,
  STOCKS_STRATEGY_OPTIONS,
  StocksStrategyId,
} from '../../../core/strategy-engine/strategies/stocks-equity/stocks-equity.evaluator';
import { formatUnknownError } from '../../../core/utils/kite-error.util';

const DESK_STRATEGY_KEY = 'palagai_stocks_desk_strategy_v1';

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
  protected strategyId: StocksStrategyId = readDeskStrategy();
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
  protected readonly strategyOptions = STOCKS_STRATEGY_OPTIONS;
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
    this.strategyId = 'GAP_FADE_500';
    persistDeskStrategy(this.strategyId);
    this.resolveHint.set('Restored treasure watchlist · strategy GAP_FADE_500.');
  }

  protected onStrategyChange(id: StocksStrategyId): void {
    this.strategyId = id;
    persistDeskStrategy(id);
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
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      this.error.set('Connect Kite token first (Get Token), then add the stock.');
      return;
    }
    try {
      const resolved = await resolveNseEquitySymbol({
        symbol: q,
        authorization,
        kiteApi: this.kiteApi,
        instruments: this.instruments,
      });
      if (!resolved) {
        this.error.set(
          `Could not resolve “${q}”. Confirm the NSE symbol, then Get Token → refresh, and try again.`,
        );
        return;
      }
      this.watch.upsertCustom({
        symbol: resolved.tradingSymbol.toUpperCase(),
        name: resolved.name || resolved.tradingSymbol,
        instrumentToken: resolved.instrumentToken,
        enabled: true,
      });
      this.resolveHint.set(
        `Added ${resolved.tradingSymbol} · token ${resolved.instrumentToken} · ${resolved.name} (${resolved.source})`,
      );
      this.customSymbol = '';
    } catch (e) {
      this.error.set(formatUnknownError(e));
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

  protected hasOpenBrokerLegs(): boolean {
    const note = this.snapshot().brokerNote ?? '';
    return this.snapshot().livePhase === 'in_trade' || (note.length > 0 && !note.includes('no open'));
  }

  protected fmtTime(ts: string | null | undefined): string {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(ts));
    } catch {
      return '—';
    }
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

function readDeskStrategy(): StocksStrategyId {
  try {
    const raw = localStorage.getItem(DESK_STRATEGY_KEY);
    if (raw && STOCKS_STRATEGY_OPTIONS.some((o) => o.id === raw)) {
      return raw as StocksStrategyId;
    }
  } catch {
    /* ignore */
  }
  return 'GAP_FADE_500';
}

function persistDeskStrategy(id: StocksStrategyId): void {
  try {
    localStorage.setItem(DESK_STRATEGY_KEY, id);
  } catch {
    /* ignore */
  }
}
