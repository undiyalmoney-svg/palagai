import { Injectable } from '@angular/core';
import { TradingStrategy } from '../../strategy-engine/interfaces/trading-strategy.interface';
import { ResearchStrategy } from '../interfaces/research-strategy.interface';

/** @deprecated Research platform removed — returns no strategies. */
@Injectable({ providedIn: 'root' })
export class ResearchStrategyRegistryService {
  getAll(): ResearchStrategy[] {
    return [];
  }

  getEnabled(): ResearchStrategy[] {
    return [];
  }

  asTradingStrategies(): TradingStrategy[] {
    return [];
  }

  resetAll(): void {
    // no-op
  }
}
