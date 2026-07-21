/**
 * Resolve any NSE cash symbol (e.g. CANBK) to instrument token for Stocks Desk.
 * Order: quote → full dump exact EQ → known-token fallback.
 */
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { InstrumentStoreService } from '../services/instrument-store.service';

export interface ResolvedEquity {
  tradingSymbol: string;
  name: string;
  instrumentToken: number;
  source: 'quote' | 'dump' | 'known';
}

/** Well-known NSE EQ tokens when dump/quote are unavailable. */
const KNOWN_NSE_EQ_TOKENS: Record<string, { token: number; name: string }> = {
  CANBK: { token: 2763265, name: 'Canara Bank' },
  SBIN: { token: 779521, name: 'State Bank of India' },
  RELIANCE: { token: 738561, name: 'Reliance Industries' },
  HDFCBANK: { token: 341249, name: 'HDFC Bank' },
  ICICIBANK: { token: 1270529, name: 'ICICI Bank' },
  INFY: { token: 408065, name: 'Infosys' },
  TCS: { token: 2953217, name: 'Tata Consultancy Services' },
  ITC: { token: 424961, name: 'ITC' },
  AXISBANK: { token: 1510401, name: 'Axis Bank' },
  KOTAKBANK: { token: 492033, name: 'Kotak Mahindra Bank' },
};

export async function resolveNseEquitySymbol(params: {
  symbol: string;
  authorization: string;
  kiteApi: KiteApiService;
  instruments: InstrumentStoreService;
}): Promise<ResolvedEquity | null> {
  const symbol = params.symbol.trim().toUpperCase();
  if (!symbol) return null;

  // 1) Quote first — does not need full instruments CSV
  try {
    const key = `NSE:${symbol}`;
    const body = (await firstValueFrom(params.kiteApi.getQuotes(params.authorization, [key]))) as {
      status?: string;
      data?: Record<
        string,
        { instrument_token?: number; last_price?: number; ohlc?: unknown }
      >;
      message?: string;
    };
    const row = body.data?.[key];
    const token = Number(row?.instrument_token ?? 0);
    if (body.status !== 'error' && token > 0) {
      const fromDump = params.instruments.getByToken(token);
      return {
        tradingSymbol: fromDump?.tradingSymbol?.toUpperCase() || symbol,
        name: fromDump?.name || knownName(symbol) || symbol,
        instrumentToken: token,
        source: 'quote',
      };
    }
  } catch {
    /* fall through */
  }

  // 2) Force-load dump and exact EQ match
  try {
    await params.instruments.refreshBestEffort(true);
  } catch {
    /* ignore */
  }
  const hit = params.instruments.findNseEquityExact(symbol);
  if (hit?.instrumentToken) {
    return {
      tradingSymbol: hit.tradingSymbol.toUpperCase(),
      name: hit.name || hit.tradingSymbol,
      instrumentToken: hit.instrumentToken,
      source: 'dump',
    };
  }

  // 3) Known token map
  const known = KNOWN_NSE_EQ_TOKENS[symbol];
  if (known?.token) {
    return {
      tradingSymbol: symbol,
      name: known.name,
      instrumentToken: known.token,
      source: 'known',
    };
  }

  return null;
}

function knownName(symbol: string): string {
  return KNOWN_NSE_EQ_TOKENS[symbol]?.name ?? '';
}
