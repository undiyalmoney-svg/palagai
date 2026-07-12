import { Injectable, inject } from '@angular/core';
import { TradingStrategy } from '../interfaces/trading-strategy.interface';
import { StrategyEngineService } from '../../strategies/registry/strategy-engine.service';
import { FirstHourBreakoutStrategy } from '../strategies/first-hour-breakout/first-hour-breakout.strategy';
import { IntradayReversalStrategy } from '../strategies/intraday-reversal/intraday-reversal.strategy';

// --- Legacy strategies (commented out — research platform removed) ---
// import { StrategyTwo } from '../strategies/strategy-two.strategy';
// import { StrategyThree } from '../strategies/strategy-three.strategy';
// import { StrategyFive } from '../strategies/strategy-five.strategy';
// import { PriceActionEngineStrategy } from '../strategies/price-action-engine.strategy';
// import { SmartPriceActionReversalStrategy } from '../strategies/smart-price-action-reversal.strategy';

/**
 * Registry facade — exposes active strategies for backtesting.
 */
@Injectable({ providedIn: 'root' })
export class StrategyRegistryService {
  private readonly strategyEngine = inject(StrategyEngineService);
  private readonly firstHourBreakout = inject(FirstHourBreakoutStrategy);
  private readonly intradayReversal = inject(IntradayReversalStrategy);

  private readonly active: TradingStrategy[];

  constructor() {
    this.active = [this.firstHourBreakout, this.intradayReversal];
  }

  getAll(): TradingStrategy[] {
    return [...this.active];
  }

  getEnabled(): TradingStrategy[] {
    return this.active.filter((s) => s.enabled);
  }

  setEnabled(id: string, enabled: boolean): void {
    const strategy = this.active.find((s) => s.id === id);
    if (!strategy) {
      return;
    }
    strategy.enabled = enabled;
    this.strategyEngine.setEnabled(id, enabled);
  }

  resetAll(): void {
    this.strategyEngine.resetAll();
  }
}
