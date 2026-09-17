/**
 * Candle feed for the Charts tab.
 *
 * Pulls OHLC straight from Kite historical (the same proxy the tester uses).
 * Every interval the tab offers is a real Kite interval except 45m, which Kite
 * does not serve and is folded from three 15-minute bars.
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
import { assertKiteResponseSuccess, extractKiteApiError } from '../utils/kite-error.util';
import { aggregateCandles } from './candle-aggregate.util';
import {
  ChartInterval,
  ChartIntervalSpec,
  MAX_CHART_BARS,
  chartIntervalSpec,
  formatKiteDateTime,
} from './chart-intervals.util';

export type ChartBookId = 'nifty' | 'bank' | 'crude';

export const KITE_SESSION_REQUIRED = 'Kite access token required. Connect in the Token tab.';

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

@Injectable({ providedIn: 'root' })
export class LiveChartDataService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);

  spec(interval: ChartInterval): ChartIntervalSpec {
    return chartIntervalSpec(interval);
  }

  /** True when the interval is folded locally because Kite does not serve it. */
  isDerived(interval: ChartInterval): boolean {
    return this.spec(interval).groupSize > 1;
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
      throw new Error(KITE_SESSION_REQUIRED);
    }

    const spec = this.spec(params.interval);
    const to = params.now ?? new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - spec.lookbackDays);

    let raw: Candle[];
    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: String(params.token),
          interval: spec.fetch,
          from: formatKiteDateTime(from),
          to: formatKiteDateTime(to),
          authorization,
        }),
      );
      // Kite answers HTTP 200 with { status: 'error' } on a dead token.
      assertKiteResponseSuccess(response, spec.label);
      raw = toCandles(response as KiteHistoricalResponse);
    } catch (error) {
      throw new Error(extractKiteApiError(error, spec.label));
    }

    // Fold first, then trim: trimming raw bars would leave a ragged part-bucket
    // at the left edge of a derived interval.
    const folded = aggregateCandles(raw, spec.groupSize);
    return folded.length > MAX_CHART_BARS ? folded.slice(-MAX_CHART_BARS) : folded;
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
