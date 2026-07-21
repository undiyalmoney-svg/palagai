/** Desk instrument channels managed by Strategy Manager. */
export type DeskChannel = 'nifty' | 'bank' | 'stocks';

/** Paper vs Live execution modes — may select different strategies. */
export type ExecutionMode = 'paper' | 'live';

export const DESK_CHANNELS: DeskChannel[] = ['nifty', 'bank', 'stocks'];

export const DESK_CHANNEL_LABELS: Record<DeskChannel, string> = {
  nifty: 'Nifty 50',
  bank: 'Bank Nifty',
  stocks: 'Stocks',
};
