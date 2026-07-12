export interface TesterInstrument {
  id: string;
  instrumentToken: number;
  tradingSymbol: string;
  name: string;
  exchange: string;
}

export const NIFTY_50_INSTRUMENT: TesterInstrument = {
  id: 'nifty-50',
  instrumentToken: 256265,
  tradingSymbol: 'NIFTY 50',
  name: 'NIFTY 50',
  exchange: 'NSE',
};

export const BANK_NIFTY_INSTRUMENT: TesterInstrument = {
  id: 'bank-nifty',
  instrumentToken: 260105,
  tradingSymbol: 'NIFTY BANK',
  name: 'Bank Nifty',
  exchange: 'NSE',
};

/** Kept for session/helpers; not shown as an active tester tab. */
export const CRUDE_OIL_INSTRUMENT: TesterInstrument = {
  id: 'crude-oil',
  instrumentToken: 520702,
  tradingSymbol: 'CRUDEOIL',
  name: 'Crude Oil',
  exchange: 'MCX',
};

/** Placeholder — reserved for a future stocks experience. */
export const STOCKS_TAB_ID = 'stocks';

export const TESTER_TAB_IDS = [NIFTY_50_INSTRUMENT.id, BANK_NIFTY_INSTRUMENT.id] as const;

export function getTesterInstrument(id: string): TesterInstrument | undefined {
  if (id === NIFTY_50_INSTRUMENT.id) {
    return NIFTY_50_INSTRUMENT;
  }
  if (id === BANK_NIFTY_INSTRUMENT.id) {
    return BANK_NIFTY_INSTRUMENT;
  }
  if (id === CRUDE_OIL_INSTRUMENT.id) {
    return CRUDE_OIL_INSTRUMENT;
  }
  return undefined;
}
