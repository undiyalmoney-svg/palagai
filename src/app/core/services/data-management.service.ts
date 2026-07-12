import { Injectable, inject } from '@angular/core';
import { CandleCacheService } from './candle-cache.service';
import { InstrumentStoreService } from './instrument-store.service';
import { ResultsStoreService } from './results-store.service';
import { StrategyStoreService } from './strategy-store.service';
import { KiteCredentialsService } from '../kite/kite-credentials.service';
import { KiteSessionService } from '../kite/kite-session.service';

@Injectable({ providedIn: 'root' })
export class DataManagementService {
  private readonly resultsStore = inject(ResultsStoreService);
  private readonly candleCache = inject(CandleCacheService);
  private readonly instrumentStore = inject(InstrumentStoreService);
  private readonly strategyStore = inject(StrategyStoreService);
  private readonly credentialsService = inject(KiteCredentialsService);
  private readonly kiteSession = inject(KiteSessionService);

  async refreshInstruments(): Promise<void> {
    await this.instrumentStore.refresh(true);
  }

  clearHistoricalResults(): void {
    this.resultsStore.clearAll();
  }

  clearTradeHistory(): void {
    this.resultsStore.clearTradesOnly();
  }

  clearCandleCache(): void {
    this.candleCache.clearAll();
  }

  clearInstrumentCache(): void {
    this.instrumentStore.clear();
  }

  clearAllData(factoryReset = false): void {
    this.clearHistoricalResults();
    this.clearCandleCache();
    this.clearInstrumentCache();
    this.strategyStore.clearAll();
    this.strategyStore.ensureDefaults();
    if (factoryReset) {
      this.credentialsService.clearCredentials();
      this.kiteSession.clearSession();
    }
  }
}
