export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleRangeApiResponse {
  status: string;
  payload?: {
    candles?: Array<[number, number, number, number, number, number]>;
    interval_in_minutes?: number;
  };
}

export interface ReversalSignal {
  signal: 'BUY' | 'SELL' | 'NO TRADE';
  type: 'BREAKOUT' | 'REVERSAL' | 'NONE';
  reversal_status: 'CONFIRMED' | 'DEVELOPING' | 'NA';
  entry_trigger_candle_time: number | null;
  entry_price: number;
  stop_loss: number;
  reason: string;
  /** Bars used in the analysis slice (last up to 10); null if not computed. */
  analysis_candle_count: number | null;
  /** First candle timestamp in the analysis window. */
  analysis_window_start_time: number | null;
  /** Last candle timestamp in the analysis window (same as entry bar when signal is on the close). */
  analysis_window_end_time: number | null;
}

export interface ReversalInput {
  exchange: string;
  segment: string;
  trading_symbol: string;
  start_time: string;
  end_time: string;
  interval_in_minutes: number;
}
