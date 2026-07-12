/** Per-instrument market session timing (IST). */
export interface InstrumentSessionConfig {
  marketOpen: string;
  marketClose: string;
  /** 5m candle open time used for session-close exit. */
  sessionCloseCandle: string;
  /** No new entries after this time. */
  lastEntryTime: string;
  /** Earliest time first-hour range is ready for evaluation. */
  firstHourReadyTime: string;
  /** Exclusive upper bound (HH:mm) for 5m bars in the first-hour range. */
  firstHourEnd: string;
  timezone: string;
  sessionCloseLabel: string;
}

/** NSE index / equity session (NIFTY). */
export const NSE_SESSION: InstrumentSessionConfig = {
  marketOpen: '09:15',
  marketClose: '15:30',
  sessionCloseCandle: '15:15',
  lastEntryTime: '14:15',
  firstHourReadyTime: '10:15',
  firstHourEnd: '10:15',
  timezone: 'Asia/Kolkata',
  sessionCloseLabel: 'Market close (15:15 candle)',
};

/** MCX Crude Oil — trades until 11:15 PM IST. */
export const MCX_CRUDE_SESSION: InstrumentSessionConfig = {
  marketOpen: '09:00',
  marketClose: '23:15',
  sessionCloseCandle: '23:15',
  lastEntryTime: '22:15',
  firstHourReadyTime: '10:00',
  firstHourEnd: '10:00',
  timezone: 'Asia/Kolkata',
  sessionCloseLabel: 'Market close (23:15 candle)',
};

/** @deprecated Use NSE_SESSION or resolveSessionConfig(). */
export const SESSION_CONFIG = NSE_SESSION;

export type SessionConfig = InstrumentSessionConfig;

export function resolveSessionConfig(params?: {
  instrumentId?: string;
  exchange?: string;
  instrumentToken?: number;
}): InstrumentSessionConfig {
  const { instrumentId, exchange, instrumentToken } = params ?? {};
  if (
    instrumentId === 'crude-oil' ||
    exchange === 'MCX' ||
    instrumentToken === 520702
  ) {
    return MCX_CRUDE_SESSION;
  }
  return NSE_SESSION;
}

export function isSessionCloseExitReason(reason: string): boolean {
  return reason.startsWith('Market close (');
}
