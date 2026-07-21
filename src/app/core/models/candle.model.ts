export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '60minute' | '30minute' | '15minute' | '5minute' | 'day';

export const ALL_TIMEFRAMES: Timeframe[] = ['60minute', '30minute', '15minute', '5minute'];

export const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: '60minute', label: '1 Hour' },
  { value: '30minute', label: '30 Minutes' },
  { value: '15minute', label: '15 Minutes' },
  { value: '5minute', label: '5 Minutes' },
];

export interface KiteHistoricalResponse {
  status: string;
  data?: {
    candles: [string, number, number, number, number, number][];
  };
}
