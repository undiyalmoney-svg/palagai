import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from './instrument-store.service';
import {
  BANK_NIFTY_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  TesterInstrument,
  getTesterInstrument,
} from '../constants/instruments.const';
import { NSE_SESSION } from '../config/session.config';
import {
  assertKiteHistoricalSuccess,
  extractKiteApiError,
} from '../utils/kite-error.util';
import {
  isBankNiftyInstrumentId,
  resolveNseIndexFuturesToken,
} from '../utils/instrument-resolver.util';
import {
  ManualTradePlan,
  calculatePdhlManualPlan,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-manual-plan';

export interface PdhlCalcRequest {
  instrumentId: string;
  /** YYYY-MM-DD */
  tradingDate: string;
}

@Injectable({ providedIn: 'root' })
export class PdhlManualCalcService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);

  readonly instruments: TesterInstrument[] = [NIFTY_50_INSTRUMENT, BANK_NIFTY_INSTRUMENT];

  async calculate(request: PdhlCalcRequest): Promise<{
    plan: ManualTradePlan;
    candleCount: number;
    instrument: TesterInstrument;
    resolvedSymbol?: string;
  }> {
    const instrument = getTesterInstrument(request.instrumentId);
    if (!instrument || !this.instruments.some((i) => i.id === instrument.id)) {
      throw new Error('Select Nifty 50 or Bank Nifty');
    }

    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Go to Get Token.');
    }

    const { token, symbol } = await this.resolveToken(instrument);

    const from = `${shiftDate(request.tradingDate, -10)} 09:00:00`;
    const to = `${request.tradingDate} 15:30:00`;

    const candles = await this.fetch5m({
      instrumentToken: token,
      from,
      to,
      authorization,
    });

    const plan = calculatePdhlManualPlan({
      candles5m: candles,
      tradingDate: request.tradingDate,
      instrumentId: instrument.id,
      session: NSE_SESSION,
    });

    const displayName =
      symbol !== instrument.tradingSymbol
        ? `${instrument.name} (${symbol})`
        : instrument.name;

    return {
      plan,
      candleCount: candles.length,
      instrument: { ...instrument, name: displayName },
      resolvedSymbol: symbol,
    };
  }

  /** Live / manual desk: always evaluate Nifty 50 + Bank Nifty for the same day. */
  async calculateBoth(tradingDate: string): Promise<
    Array<{
      plan: ManualTradePlan;
      candleCount: number;
      instrument: TesterInstrument;
      error?: string;
    }>
  > {
    const results: Array<{
      plan: ManualTradePlan;
      candleCount: number;
      instrument: TesterInstrument;
      error?: string;
    }> = [];

    for (let i = 0; i < this.instruments.length; i += 1) {
      const instrument = this.instruments[i]!;
      try {
        if (i > 0) {
          await delay(2000);
        }
        const result = await this.calculate({
          instrumentId: instrument.id,
          tradingDate,
        });
        results.push(result);
      } catch (err) {
        results.push({
          instrument,
          candleCount: 0,
          error: err instanceof Error ? err.message : String(err),
          plan: {
            status: 'INCOMPLETE',
            action: null,
            entryPrice: null,
            stopLoss: null,
            target: null,
            riskPts: null,
            riskRewardRatio: null,
            signalTime: null,
            tradingDate,
            reason: err instanceof Error ? err.message : String(err),
            bias: null,
            orHigh: null,
            orLow: null,
            pdh: null,
            pdl: null,
            atr: null,
            candlesScanned: 0,
          },
        });
      }
    }

    return results;
  }

  private async resolveToken(
    instrument: TesterInstrument,
  ): Promise<{ token: number; symbol: string }> {
    try {
      await this.instrumentStore.ensureLoaded();
      const kind = isBankNiftyInstrumentId(instrument.id) ? 'banknifty' : 'nifty';
      const fut = resolveNseIndexFuturesToken(this.instrumentStore.allInstruments(), kind);
      if (fut) {
        return { token: fut.instrumentToken, symbol: fut.tradingSymbol };
      }
    } catch {
      // Fall back to index token.
    }
    return { token: instrument.instrumentToken, symbol: instrument.tradingSymbol };
  }

  private async fetch5m(params: {
    instrumentToken: number;
    from: string;
    to: string;
    authorization: string;
  }): Promise<Candle[]> {
    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: String(params.instrumentToken),
          interval: '5minute',
          from: params.from,
          to: params.to,
          authorization: params.authorization,
        }),
      );

      assertKiteHistoricalSuccess(response, '5minute');
      const parsed = response as KiteHistoricalResponse;
      const candles =
        parsed.data?.candles?.map((row: [string, number, number, number, number, number]) => ({
          date: row[0],
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[5],
        })) ?? [];

      if (!candles.length) {
        throw new Error(
          `No 5m candles for token ${params.instrumentToken} (${params.from} → ${params.to}).`,
        );
      }
      return candles;
    } catch (error) {
      throw new Error(extractKiteApiError(error, '5minute'));
    }
  }
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
