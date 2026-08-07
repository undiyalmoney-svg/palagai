import type { PaperDeskDayStats } from './paper-desk-day-stats';

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
  /** Defaults to NFO when omitted (Nifty / Bank Nifty). */
  exchange?: 'NFO' | 'MCX';
  /** Defaults to MIS when omitted. MCX crude uses NRML. */
  product?: 'MIS' | 'NRML';
}

export interface PaperTradeTimelineEvent {
  at: string;
  event: string;
  detail?: string;
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
  /**
   * Main P&L (owner dictation · long CE/PE):
   * (exitPremium − entryPremium) × lotSize × lots
   * e.g. 365→370 = ₹5 · Nifty×65 · Bank×30 · Crude Mini×10.
   * Live money overlays Kite average_price fills when present.
   * Gross of estimated charges — see netOptionPnlRs.
   */
  optionPnlRs: number | null;
  premiumEstimated: boolean;
  /** Option bar side used for entry premium (open = Trap-style, close = Genie-style). */
  optionEntryEdge?: 'open' | 'close';
  /** Index-points outcome (legacy desk win/loss). */
  outcome: 'WIN' | 'LOSS' | 'FLAT';
  /**
   * Points the replay would have booked at signal/stop/target levels, before
   * repricing to fills the desk can actually get. Reference only.
   */
  modelledIndexPoints?: number;
  /** Strategy Manager id that generated this trade. */
  strategyId?: string;
  strategyName?: string;
  /** Max favorable / adverse index excursion while open (pts). */
  mfeIndexPts?: number;
  maeIndexPts?: number;
  /** Estimated round-trip charges (₹). */
  chargesRs?: number | null;
  /** optionPnlRs − chargesRs when both known. */
  netOptionPnlRs?: number | null;
  /** Outcome from option ₹ (gross); optional audit field. */
  moneyOutcome?: 'WIN' | 'LOSS' | 'FLAT';
  /** Sparse timeline for audit UI. */
  timeline?: PaperTradeTimelineEvent[];
  /** Entry signal reason captured at open (when available). */
  entryReason?: string;
  /**
   * Live money: true when this closed leg was matched to Kite ENTRY+EXIT/SL fills.
   * Desk replay rows without this must not be shown as real orders.
   */
  onKite?: boolean;
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
  /** Strategy Manager module driving this instrument (desk resolve). */
  strategyId?: string;
  strategyName?: string;
  /** Max trades/day from strategy settings (0 = unlimited). */
  maxTradesPerDay?: number;
  /** Live desk phase for UI. */
  livePhase: 'idle' | 'waiting' | 'in_trade' | 'target_hit' | 'sl_hit' | 'exited';
  livePhaseLabel: string;
  /** Last closed trade exit reason (for target/SL banners). */
  lastExitReason: string | null;
  lastExitTime: string | null;
  /** Protective SL-M trigger on option premium (live money). */
  brokerSlTrigger: number | null;
  brokerSlOrderId: string | null;
  brokerEntryOrderId: string | null;
  /**
   * Live money only: why the desk signal did not become a Kite order
   * (synthetic option, API error, Real Orders off, etc.).
   */
  kiteBlockReason: string | null;
  /**
   * Live money: the open desk leg was signalled before Start, so it was
   * deliberately not sent to Kite. Not an error — the desk waits for a fresh
   * signal instead of chasing an hours-old entry at market.
   */
  preStartSignal?: boolean;
}

export interface PaperDeskSnapshot {
  mode: PaperDeskMode;
  running: boolean;
  fromDate: string;
  toDate: string;
  marketOpen: boolean;
  message: string;
  /** When true, Live mode places real Kite MIS orders (addon). */
  realOrders: boolean;
  /** ISO timestamp of last successful live tick (heartbeat). */
  lastTickAt: string | null;
  statuses: PaperInstrumentStatus[];
  trades: PaperTrade[];
  totals: {
    trades: number;
    wins: number;
    losses: number;
    indexNetPts: number;
    optionNetRs: number;
    /** Lots multiplier used for this run (Testing / Live paper Option ₹ and Live money qty). */
    lotsUsed: number;
    /**
     * Lot-scaled money from index/futures points:
     * Nifty/Bank ≈ pts × 65/30 × lots · Crude ≈ pts × 10 × lots.
     * Use this to verify lots — raw indexNetPts does NOT scale with lots.
     */
    pointsMoneyRs: number;
    /** Sum of estimated charges (₹). Additive — does not change optionNetRs. */
    optionChargesRs?: number;
    /** optionNetRs − optionChargesRs when charges known. */
    optionNetAfterChargesRs?: number;
    /** How many closed trades used δ/index estimate (not real front-week OHLC). */
    premiumEstimatedCount?: number;
    /**
     * Research Locked ₹: index proxy − ₹40/fill, day capped at ₹3k.
     * Matches published monthly table (Jul ₹65,041). Testing Profit uses this.
     */
    researchLockedNetRs?: number;
  };
  /** Testing day breakdown: best/worst days, weekday rollup. */
  dayStats: PaperDeskDayStats;
  /** Kite historical usage for this desk session (5m capped at 100 days/call). */
  kiteStats: {
    historicalCalls: number;
    lastRangeDays: number;
    maxDaysPerCall: number;
  };
  orderEvents: Array<{
    at: string;
    instrumentId: string;
    instrumentName?: string;
    action: string;
    detail: string;
    orderId?: string;
    tradingSymbol?: string;
    quantity?: number;
  }>;
  /** Live money: full Kite order book for this session (refreshed each tick). */
  orderSummary: Array<{
    id: string;
    at: string;
    instrumentId: string;
    instrumentName: string;
    tradingSymbol: string;
    quantity: number;
    leg: string;
    side: string;
    orderId: string;
    status: string;
    triggerPrice: number | null;
    averagePrice: number | null;
  }>;
}
