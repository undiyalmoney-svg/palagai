/** Central strategy identifiers for Strategy Manager. */
export const MANAGED_STRATEGY_IDS = {
  CHAMPION_PDHL: 'pdhl-opening-range',
  VOL_EXPAND_DONCH15: 'vol-expand-donch15-ema50-eod',
  SWING5_PREV_DAY: 'swing5-prev-day-eod',
  DONCHIAN_20: 'donchian-20-eod',
  DONCHIAN_55_TURTLE: 'donchian-55-turtle',
  /** Daily-consistency search: max green-day share (not default — fat tails). */
  INSIDE_BREAK: 'inside-break-eod',
  /** Donch-20 retest + OR-mid + Swing-5 structure trail — selectable. */
  DONCH_RETEST_OR_MID_2R: 'donch-retest-or-mid-2r',
  /** S/R retest twin: Swing-5 retest + EMA50 + 2R. */
  SWING_RETEST_EMA50_2R: 'swing-retest-ema50-2r',
  /**
   * Pine Smart Pullback PRO port — EMA50 pullback · 1.5R.
   * Selectable (not default). Research: scripts/smart-pullback-pro-daily-research.py
   */
  SMART_PULLBACK_PRO: 'smart-pullback-pro',
  /**
   * Align Combo · GENIE — Nifty+Bank together when aligned, one alone, skip chop.
   * Selectable (was prior default). OOS ~₹507/day.
   */
  ALIGN_COMBO_GENIE: 'align-combo-genie',
  /**
   * S/R Trap + Confirm — liquidity sweep at swing S/R + next-bar confirm · 3.5R.
   * Superseded by SR_TRAP_CONFIRM_V2 as the Nifty/Bank default — kept
   * registered (not deleted) for comparison against the loss history it was
   * live for.
   */
  SR_TRAP_CONFIRM: 'sr-trap-confirm',
  /**
   * S/R Trap + Confirm v2 — same sweep+confirm mechanics as SR_TRAP_CONFIRM,
   * but with a single-source DNA (TRAP_V2_ENTRY_DNA_EXTRAS in
   * strategy-dna-caps.ts, shared by this UI module and the Order-API live
   * bundle) and an enforced hard ₹/lot option loss cap. **Default Nifty/Bank**
   * Paper+Live.
   */
  SR_TRAP_CONFIRM_V2: 'sr-trap-confirm-v2',
  /** Stocks Desk champion — gap-up fade ₹500 book. */
  GAP_FADE_500: 'gap-fade-500',
  /** Exhaustion Fade — volume-climax blow-off fade on stocks. Paper-first. */
  EXHAUSTION_FADE: 'exhaustion-fade-v1',
} as const;

export type ManagedStrategyId =
  (typeof MANAGED_STRATEGY_IDS)[keyof typeof MANAGED_STRATEGY_IDS];

/**
 * Research-backed defaults:
 * - Nifty/Bank: Trap V2 (confirm edge · 3.5R · profit protect 1R→BE · hard ₹ loss cap)
 * - Stocks: GAP_FADE_500 (same DNA as Stocks Desk)
 */
export const DEFAULT_CHANNEL_ASSIGNMENTS = {
  nifty: {
    paper: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2,
    live: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2,
    shadow: null as string | null,
  },
  bank: {
    paper: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2,
    live: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2,
    shadow: null as string | null,
  },
  stocks: {
    paper: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    live: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    shadow: null as string | null,
  },
} as const;
