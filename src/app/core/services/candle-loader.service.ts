import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Candle, KiteHistoricalResponse, Timeframe } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { CandleDataset } from '../strategy-engine/models/candle-dataset.model';
import { resolveSessionConfig } from '../config/session.config';
import {
  assertKiteHistoricalSuccess,
  extractKiteApiError,
} from '../utils/kite-error.util';

export interface CandleLoadConfig {
  instrumentToken: number;
  fromDateTime: string;
  toDateTime: string;
  lookbackDays?: number;
  instrumentId?: string;
  exchange?: string;
}

export interface CandleLoadProgress {
  message: string;
  timeframe: Timeframe;
  step: number;
  totalSteps: number;
}

export const DEFAULT_LOOKBACK_DAYS = 45;
const FETCH_ORDER: Timeframe[] = ['5minute', '60minute', '30minute', '15minute'];
const DELAY_BETWEEN_FETCH_MS = 3000;

@Injectable({ providedIn: 'root' })
export class CandleLoaderService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);

  private inMemoryStore: Record<Timeframe, Candle[]> | null = null;

  get loadedCandles(): Record<Timeframe, Candle[]> | null {
    return this.inMemoryStore;
  }

  clear(): void {
    this.inMemoryStore = null;
  }

  async load(
    config: CandleLoadConfig,
    onProgress?: (progress: CandleLoadProgress) => void,
  ): Promise<CandleDataset> {
    const lookbackDays = config.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const fetchFromDateTime = subtractDays(config.fromDateTime, lookbackDays);

    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Go to Get Token.');
    }

    const store = {} as Record<Timeframe, Candle[]>;

    for (let i = 0; i < FETCH_ORDER.length; i += 1) {
      const timeframe = FETCH_ORDER[i];
      const from = timeframe === '5minute' ? config.fromDateTime : fetchFromDateTime;

      onProgress?.({
        message: `Fetching ${timeframe} candles…`,
        timeframe,
        step: i + 1,
        totalSteps: FETCH_ORDER.length,
      });

      store[timeframe] = await this.fetchTimeframeOnce({
        instrumentToken: config.instrumentToken,
        timeframe,
        from,
        to: config.toDateTime,
        authorization,
      });

      if (i < FETCH_ORDER.length - 1) {
        onProgress?.({
          message: `Waiting 3s before next timeframe…`,
          timeframe,
          step: i + 1,
          totalSteps: FETCH_ORDER.length,
        });
        await this.delay(DELAY_BETWEEN_FETCH_MS);
      }
    }

    this.inMemoryStore = store;

    const session = resolveSessionConfig({
      instrumentId: config.instrumentId,
      exchange: config.exchange,
      instrumentToken: config.instrumentToken,
    });

    return new CandleDataset(
      store,
      config.fromDateTime,
      config.toDateTime,
      fetchFromDateTime,
      session,
      config.instrumentId,
    );
  }

  private async fetchTimeframeOnce(params: {
    instrumentToken: number;
    timeframe: Timeframe;
    from: string;
    to: string;
    authorization: string;
  }): Promise<Candle[]> {
    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: String(params.instrumentToken),
          interval: params.timeframe,
          from: params.from,
          to: params.to,
          authorization: params.authorization,
        }),
      );

      assertKiteHistoricalSuccess(response, params.timeframe);

      const parsed = response as KiteHistoricalResponse;
      const candles =
        parsed.data?.candles?.map((row) => ({
          date: row[0],
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[5],
        })) ?? [];

      if (!candles.length) {
        throw new Error(
          `Kite API (${params.timeframe}): no candles returned for token ${params.instrumentToken} (${params.from} → ${params.to}).`,
        );
      }

      return candles;
    } catch (error) {
      throw new Error(extractKiteApiError(error, params.timeframe));
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function subtractDays(dateTime: string, days: number): string {
  const normalized = dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T');
  const date = new Date(normalized);
  date.setDate(date.getDate() - days);
  return formatDateTime(date);
}

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
