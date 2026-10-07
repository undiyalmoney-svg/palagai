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
import {
  BANK_NIFTY_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  SENSEX_INSTRUMENT,
} from '../constants/instruments.const';
import { assertKiteResponseSuccess, extractKiteApiError } from '../utils/kite-error.util';
import { aggregateCandles } from './candle-aggregate.util';
import {
  ChartInterval,
  ChartIntervalSpec,
  MAX_CHART_BARS,
  chartIntervalSpec,
  formatIstDateTime,
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
  { id: 'nifty', label: 'Nifty 50', exchange: 'NSE', decimals: 2 },
  { id: 'bank', label: 'Bank Nifty', exchange: 'NSE', decimals: 2 },
  { id: 'crude', label: 'Crude Oil Mini', exchange: 'MCX', decimals: 0 },
] as const;

/** Charts trend cards. Sensex is display-only and is not a tradable book. */
export type TrendBookId = ChartBookId | 'sensex';

export function isTradableChartBook(id: TrendBookId): id is ChartBookId {
  return id !== 'sensex';
}

export interface TrendBookDef {
  id: TrendBookId;
  label: string;
  exchange: 'NSE' | 'MCX' | 'BSE';
  decimals: number;
}

const chartBook = (id: ChartBookId): TrendBookDef => {
  const book = CHART_BOOKS.find((row) => row.id === id);
  if (!book) throw new Error(`Missing chart book ${id}`);
  return book;
};

export const TREND_BOOKS: readonly TrendBookDef[] = [
  chartBook('nifty'),
  chartBook('bank'),
  { id: 'sensex', label: 'Sensex', exchange: 'BSE', decimals: 2 },
  chartBook('crude'),
];

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
   * Nifty and Bank Nifty use their index tokens.
   * Crude has no index, so it resolves the nearest CRUDEOILM futures contract.
   */
  async resolveInstrument(book: ChartBookId, asOf?: Date): Promise<ResolvedChartInstrument> {
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
    const contract = resolveCrudeOilMiniFuturesToken(
      this.instrumentStore.allInstruments(),
      asOf,
    );
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

  /** Same as {@link resolveInstrument}, plus the Sensex index for the trend cards. */
  async resolveTrendInstrument(book: TrendBookId, asOf?: Date): Promise<ResolvedChartInstrument> {
    if (book === 'sensex') {
      return {
        token: SENSEX_INSTRUMENT.instrumentToken,
        symbol: SENSEX_INSTRUMENT.tradingSymbol,
        exchange: SENSEX_INSTRUMENT.exchange,
      };
    }
    return this.resolveInstrument(book, asOf);
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
          from: formatIstDateTime(from),
          to: formatIstDateTime(to),
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
