/** Shared shapes for the Paper 14k analytics layer. Nothing here places an order. */

export interface SignalCheck {
  label: string;
  pass: boolean;
}

export interface SignalCard {
  /** Share of rule checks that agree (0-100). NOT a probability of profit and not calibrated. */
  ruleScore: number;
  checks: SignalCheck[];
  reasons: string[];
  entry: number;
  sl: number;
  tp: number;
  qty: number;
  /** Modelled risk to the stop, including estimated round-trip charges. */
  riskRs: number;
  /** Modelled reward at the target, after estimated round-trip charges. */
  rewardRs: number;
  rewardRisk: number | null;
}

/** One closed forward-paper trade, as stored in the ledger. */
export interface PaperTrade {
  id: string;
  day: string;
  book: string;
  label: string;
  optionSymbol: string;
  optionType: '' | 'CE' | 'PE';
  strike: number | null;
  expiry: string;
  qty: number;
  structure: string;
  mode: string;
  reason: string;
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  /** Net P&L the existing paper engine reports (flat charge, last-price fills). */
  paperNetRs: number;
  /** A banks ₹370. B green short of bank. C scratch/flat. D small loss. F stop. */
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  entryBid: number | null;
  entryAsk: number | null;
  exitBid: number | null;
  exitAsk: number | null;
  entryAt: string;
  exitAt: string;
  signal: SignalCard | null;
}

export type FillQuality = 'quoted' | 'modelled';

export interface RealisticFill {
  entryFill: number;
  exitFill: number;
  grossRs: number;
  chargesRs: number;
  netRs: number;
  /** Rupees lost to spread and slippage relative to the paper fills. */
  spreadSlipRs: number;
  quality: FillQuality;
}

export interface ExecutionAssumptions {
  /** Adverse ticks applied on each leg. */
  slipTicks: number;
  /** Full bid-ask spread as a fraction of premium, used only when no quote was observed. */
  fallbackSpreadPct: number;
}

export interface PerformanceMetrics {
  trades: number;
  wins: number;
  losses: number;
  flats: number;
  /** Wins divided by all closed trades (flat trades count as not winning). */
  winRatePct: number | null;
  /** Sum of winning trades, each net of charges. */
  grossProfitRs: number;
  /** Absolute sum of losing trades, each net of charges. */
  grossLossRs: number;
  netRs: number;
  avgWinRs: number | null;
  avgLossRs: number | null;
  /** Average win divided by average loss size (payoff ratio). */
  riskReward: number | null;
  profitFactor: number | null;
  expectancyRs: number | null;
  maxDrawdownRs: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  currentStreak: { kind: 'win' | 'loss' | 'none'; length: number };
  bestTradeRs: number | null;
  worstTradeRs: number | null;
}

export interface PeriodRow {
  key: string;
  trades: number;
  wins: number;
  netRs: number;
}

export type PeriodKind = 'day' | 'week' | 'month';

export interface ScenarioRow {
  label: 'worst' | 'base' | 'best';
  rs: number;
}

export type ScenarioResult =
  | { status: 'insufficient'; reason: string }
  | {
      status: 'ok';
      horizonDays: number;
      expectedPerTradeRs: number;
      perTradeCi90: [number, number];
      tradesPerDay: number;
      expectedPerDayRs: number;
      rows: ScenarioRow[];
      simulations: number;
    };

export interface GateCheck {
  label: string;
  pass: boolean;
  detail: string;
}

export type ReadinessVerdict = 'insufficient' | 'not-ready' | 'candidate';

export interface ReadinessResult {
  verdict: ReadinessVerdict;
  checks: GateCheck[];
}

/** A signal the desk saw and could not take. Kept visible so a quiet book is never mistaken for a quiet market. */
export interface SkippedSignal {
  at: string;
  day: string;
  book: string;
  side: 'CE' | 'PE';
  mode: string;
  structure: string;
  contract: string;
  premium: number | null;
  lot: number;
  costRs: number | null;
  budgetRs: number;
  reason: 'premium-over-budget' | 'no-listed-contract' | 'no-live-quote' | 'day-stop' | 'spread-over-3pct';
}
