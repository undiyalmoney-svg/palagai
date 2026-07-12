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
}
