import { Injectable, inject } from '@angular/core';
import { CandleLoaderService, CandleLoadProgress } from '../../services/candle-loader.service';
import { CandleDataset } from '../../strategy-engine/models/candle-dataset.model';
import { BACKTEST_CONFIG } from '../../config/backtest.config';
import { IOhlcDataProvider, OHLCDataRequest } from '../interfaces/data-provider.interface';
import { DataLoadError } from '../../shared/errors/app-error';
import { AppLoggerService } from '../../shared/logging/app-logger.service';

/**
 * Data Layer — sole responsibility for loading and providing OHLC datasets.
 * All engines consume identical data through this service.
 */
@Injectable({ providedIn: 'root' })
export class OhlcDataService implements IOhlcDataProvider {
  private readonly candleLoader = inject(CandleLoaderService);
  private readonly logger = inject(AppLoggerService);

  async load(request: OHLCDataRequest, onProgress?: (progress: CandleLoadProgress) => void): Promise<CandleDataset> {
    try {
      this.logger.info('OhlcDataService', 'Loading OHLC data', request);
      return await this.candleLoader.load(
        {
          instrumentToken: request.instrumentToken,
          fromDateTime: request.fromDateTime,
          toDateTime: request.toDateTime,
          lookbackDays: request.lookbackDays ?? BACKTEST_CONFIG.defaultLookbackDays,
          instrumentId: request.instrumentId,
          exchange: request.exchange,
        },
        onProgress,
      );
    } catch (err) {
      throw new DataLoadError('Failed to load OHLC data', err);
    }
  }

  clear(): void {
    this.candleLoader.clear();
  }
}
