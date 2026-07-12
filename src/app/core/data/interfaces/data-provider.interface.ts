import { CandleDataset } from '../../strategy-engine/models/candle-dataset.model';
import { CandleLoadProgress } from '../../services/candle-loader.service';

export interface OHLCDataRequest {
  instrumentToken: number;
  fromDateTime: string;
  toDateTime: string;
  lookbackDays?: number;
  instrumentId?: string;
  exchange?: string;
}

export interface IOhlcDataProvider {
  load(request: OHLCDataRequest, onProgress?: (progress: CandleLoadProgress) => void): Promise<CandleDataset>;
  clear(): void;
}
