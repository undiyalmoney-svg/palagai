/**
 * Research DNA max trades / R caps per managed strategy.
 * When the user switches strategy, desks auto-apply these caps.
 */
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';

export interface StrategyDnaCaps {
  /** Max trades per day for this strategy on the given channel. 0 = unlimited. */
  maxTradesPerDay: number;
  /** Optional R-multiple hint (informational / settings sync). */
  targetRMultiple?: number;
}

/**
 * Channel-aware DNA from hunts / live books.
 * Trap max-earn: ≤3/index · GENIE: Nifty≤2 Bank≤1 · etc.
 */
export function dnaCapsForStrategy(
  strategyId: string,
  channel: DeskChannel,
): StrategyDnaCaps {
  switch (strategyId) {
    case MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM:
      // Doc 31 — trap + next confirm · 3.5R · mt3 per index
      return { maxTradesPerDay: 3, targetRMultiple: 3.5 };
    case MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE:
      return channel === 'bank'
        ? { maxTradesPerDay: 1, targetRMultiple: 1.5 }
        : { maxTradesPerDay: 2, targetRMultiple: 3 };
    case MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO:
      return { maxTradesPerDay: 2, targetRMultiple: 1.5 };
    case MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R:
      // Owner default — ≤3t/index · Swing-5 trail (exit-lab)
      return { maxTradesPerDay: 3, targetRMultiple: 2 };
    case MANAGED_STRATEGY_IDS.GAP_FADE_500:
      return { maxTradesPerDay: 1 };
    case MANAGED_STRATEGY_IDS.INSIDE_BREAK:
      return { maxTradesPerDay: 0 }; // unlimited research
    case MANAGED_STRATEGY_IDS.CHAMPION_PDHL:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.SWING_RETEST_EMA50_2R:
    case MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15:
    case MANAGED_STRATEGY_IDS.SWING5_PREV_DAY:
    case MANAGED_STRATEGY_IDS.DONCHIAN_20:
    case MANAGED_STRATEGY_IDS.DONCHIAN_55_TURTLE:
      return { maxTradesPerDay: 1, targetRMultiple: 2 };
    default:
      return { maxTradesPerDay: 1 };
  }
}
