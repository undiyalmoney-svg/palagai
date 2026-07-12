export type PaperDeskMode = 'testing' | 'live';

export interface PaperOptionContract {
  tradingSymbol: string;
  instrumentToken: number;
  strike: number;
  expiry: string;
  optionType: 'CE' | 'PE';
  lotSize: number;
  /** chain = from Kite instruments; synthetic = computed label when chain miss */
  source: 'chain' | 'synthetic';
}

export interface PaperTrade {
  id: string;
  instrumentId: string;
  instrumentName: string;
  direction: 'BUY' | 'SELL';
  /** Index levels (same as Historical Tester). */
  indexEntry: number;
  indexStop: number;
  indexTarget: number;
  indexExit: number;
  indexPoints: number;
  entryTime: string;
  exitTime: string;
  exitReason: string;
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
  optionExitPremium: number | null;
  /** Main P&L: (exit − entry) × lotSize for long CE/PE. */
  optionPnlRs: number | null;
  premiumEstimated: boolean;
  outcome: 'WIN' | 'LOSS' | 'FLAT';
}

export interface PaperInstrumentStatus {
  instrumentId: string;
  instrumentName: string;
  lastBarTime: string | null;
  dayNetIndexPts: number;
  dayNetOptionRs: number;
  openTrade: {
    direction: 'BUY' | 'SELL';
    indexEntry: number;
    indexStop: number;
    indexTarget: number;
    entryTime: string;
    option: PaperOptionContract | null;
    optionEntryPremium: number | null;
  } | null;
  /** ATM weekly contract selected for this index (open trade, last trade, or live bias). */
  chosenOption: PaperOptionContract | null;
  chosenBias: 'BUY' | 'SELL' | null;
  indexSpot: number | null;
  chosenAsOf: string | null;
  lastSignal: string;
  tradesToday: number;
}

export interface PaperDeskSnapshot {
  mode: PaperDeskMode;
  running: boolean;
  fromDate: string;
  toDate: string;
  marketOpen: boolean;
  message: string;
  statuses: PaperInstrumentStatus[];
  trades: PaperTrade[];
  totals: {
    trades: number;
    wins: number;
    losses: number;
    indexNetPts: number;
    optionNetRs: number;
  };
}
