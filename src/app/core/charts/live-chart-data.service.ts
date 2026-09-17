/**
 * Candle feed for the Charts tab.
 *
 * Pulls OHLC straight from Kite historical (the same proxy the tester uses) at
 * whichever interval the tab asks for, so 15-minute bars are real Kite bars
 * rather than 5-minute bars folded together in the browser.
 *
 * Deliberately separate from CandleLoaderService: that one fetches four
 * timeframes with a 3s gap between each to build a backtest dataset. A live
 * chart needs one timeframe, promptly, on a repeating poll.
 */
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import { resolveCrudeOilMiniFuturesToken } from '../utils/instrument-resolver.util';
import { BANK_NIFTY_INSTRUMENT, NIFTY_50_INSTRUMENT } from '../constants/instruments.const';
import { assertKiteHistoricalSuccess, extractKiteApiError } from '../utils/kite-error.util';

export type ChartBookId = 'nifty' | 'bank' | 'crude';

/** Intervals offered by the tab. Kite interval strings, passed through as-is. */
export type ChartInterval = '5minute' | '15minute' | '30minute' | '60minute';

export interface ChartBookDef {
  id: ChartBookId;
  label: string;
  exchange: 'NSE' | 'MCX';
  /** Price decimals — index ticks are 0.05, MCX crude ticks are whole rupees. */
  decimals: number;
}

export const CHART_BOOKS: readonly ChartBookDef[] = [
  { id: 'crude', label: 'Crude Oil Mini', exchange: 'MCX', decimals: 0 },
  { id: 'nifty', label: 'Nifty 50', exchange: 'NSE', decimals: 2 },
  { id: 'bank', label: 'Bank Nifty', exchange: 'NSE', decimals: 2 },
] as const;

export interface ResolvedChartInstrument {
  token: number;
  /** Symbol shown on the chart header, e.g. `CRUDEOILM26SEPFUT`. */
  symbol: string;
  exchange: string;
}

export const CHART_INTERVAL_LABELS: Record<ChartInterval, string> = {
  '5minute': '5m',
  '15minute': '15m',
  '30minute': '30m',
  '60minute': '1h',
};

/** Calendar days of history per interval — enough bars to shape S/R, not more. */
const LOOKBACK_DAYS: Record<ChartInterval, number> = {
  '5minute': 3,
  '15minute': 7,
  '30minute': 14,
  '60minute': 30,
};

@Injectable({ providedIn: 'root' })
export class LiveChartDataService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);

  lookbackDays(interval: ChartInterval): number {
    return LOOKBACK_DAYS[interval] ?? 7;
  }

  /**
   * Nifty and Bank Nifty use their index tokens — the same series the S/R
   * engine reads, so the chart shows the levels the bot actually trades.
   * Crude has no index, so it resolves the nearest CRUDEOILM futures contract.
   */
  async resolveInstrument(book: ChartBookId): Promise<ResolvedChartInstrument> {
    if (book === 'nifty') {
      return {
        token: NIFTY_50_INSTRUMENT.instrumentToken,
        symbol: NIFTY_50_INSTRUMENT.tradingSymbol,
        exchange: NIFTY_50_INSTRUMENT.exchange,
      };
    }
    if (book === 'bank') {
      return {
        token: BANK_NIFTY_INSTRUMENT.instrumentToken,
        symbol: BANK_NIFTY_INSTRUMENT.tradingSymbol,
        exchange: BANK_NIFTY_INSTRUMENT.exchange,
      };
    }

    await this.instrumentStore.ensureLoaded();
    const contract = resolveCrudeOilMiniFuturesToken(this.instrumentStore.allInstruments());
    if (!contract) {
      throw new Error(
        'No CRUDEOILM futures contract in the instrument list. Refresh instruments in Settings.',
      );
    }
    return {
      token: contract.instrumentToken,
      symbol: contract.tradingSymbol,
      exchange: contract.exchange,
    };
  }

  async loadCandles(params: {
    token: number;
    interval: ChartInterval;
    now?: Date;
  }): Promise<Candle[]> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Connect in the Token tab.');
    }

    const to = params.now ?? new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - this.lookbackDays(params.interval));

    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: String(params.token),
          interval: params.interval,
          from: formatKiteDateTime(from),
          to: formatKiteDateTime(to),
          authorization,
        }),
      );
      assertKiteHistoricalSuccess(response, params.interval);
      return toCandles(response as KiteHistoricalResponse);
    } catch (error) {
      throw new Error(extractKiteApiError(error, params.interval));
    }
  }
}

function toCandles(response: KiteHistoricalResponse): Candle[] {
  return (
    response.data?.candles?.map((row) => ({
      date: String(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5] ?? 0),
    })) ?? []
  );
}

/** Kite historical wants `YYYY-MM-DD HH:mm:ss` in exchange-local time. */
export function formatKiteDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
