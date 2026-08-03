export interface Instrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingSymbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrumentType: string;
  expiry: string;
  strike: number;
  tickSize: number;
  lotSize: number;
  lastPrice: number;
}

export interface InstrumentMetadata {
  lastRefreshAt: string;
  totalInstruments: number;
  fileSizeBytes: number;
  status: 'ready' | 'missing' | 'stale' | 'error';
  /**
   * Bump when slimTradingInstruments keep-list changes so same-day caches
   * re-download (e.g. Nat Gas Mini was added after Crude-only slim).
   */
  slimSchema?: number;
}
