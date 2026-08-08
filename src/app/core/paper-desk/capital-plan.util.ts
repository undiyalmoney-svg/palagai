/**
 * Capital-aware desk sizing for long CE/PE index books (Nifty + Bank only).
 * More capital → more lots (premium budget = 60% of capital).
 *
 * Scaling contract (Paper ≡ Live):
 * - Lots ↑ with capital (balanced N+B pairs).
 * - Day lock / strict stop money ≈ 1-lot band × riskLots (index pts stay fixed).
 * - Option peak-trail DNA is 1-lot (arm₹100); runtime scales × lots so premium
 *   distance to arm/floor stays the same when you raise capital.
 */

export const DEFAULT_TRADING_CAPITAL_RS = 40_000;

/** Fraction of capital allowed as concurrent long-option premium. */
export const PREMIUM_BUDGET_FRAC = 0.6;

/**
 * Conservative ATM premium ₹ / lot proxies (not fills).
 * Used only to size lots before a session — real premium varies.
 */
export const ATM_PREMIUM_RS_PER_LOT = {
  nifty: 10_000,
  bank: 12_000,
} as const;

/** Safety ceiling — beyond this, size by hand; margin/liquidity risk rises fast. */
export const MAX_LOTS_PER_BOOK = 30;

/** Research Locked day band at 1 lot (scales × lots). */
export const DAY_PROFIT_LOCK_PER_LOT_RS = 3_000;

/** Trap option-trail DNA at 1 lot — runtime × lots (see option-peak-trail.util). */
export const OPTION_TRAIL_PER_LOT_RS = {
  armRs: 100,
  lockRs: 50,
  givebackRs: 50,
} as const;

export type CapitalBook = keyof typeof ATM_PREMIUM_RS_PER_LOT;

export interface CapitalLotPlan {
  capitalRs: number;
  premiumBudgetRs: number;
  niftyLots: number;
  bankLots: number;
  enableNifty: boolean;
  enableBank: boolean;
  estimatedPremiumRs: number;
  dailyTargetRs: number;
  tenDayGoalRs: number;
  dayProfitLockRs: number;
  /** riskLots = max(N,B,1) — used for day lock + trail scale. */
  riskLots: number;
  /** Option trail arm ₹ after lot scale (DNA × riskLots). */
  optionTrailArmRs: number;
  note: string;
}

function cost(lots: { nifty: number; bank: number }): number {
  return lots.nifty * ATM_PREMIUM_RS_PER_LOT.nifty + lots.bank * ATM_PREMIUM_RS_PER_LOT.bank;
}

function clampLots(n: number): number {
  return Math.max(0, Math.min(MAX_LOTS_PER_BOOK, Math.floor(n)));
}

/**
 * Pick lots for a capital base. Nifty+Bank only (Trade Desk has no Crude).
 * Scales both books together as capital grows — ₹6L must not stay stuck at N1/B2.
 */
export function planLotsForCapital(capitalRs: number = DEFAULT_TRADING_CAPITAL_RS): CapitalLotPlan {
  const capital = Math.max(10_000, Math.floor(Number(capitalRs) || DEFAULT_TRADING_CAPITAL_RS));
  const premiumBudgetRs = Math.floor(capital * PREMIUM_BUDGET_FRAC);

  const unitPair = ATM_PREMIUM_RS_PER_LOT.nifty + ATM_PREMIUM_RS_PER_LOT.bank;
  let niftyLots = 0;
  let bankLots = 0;

  // Prefer balanced N+B: each "pair lot" costs ~₹22k premium proxy.
  const pairLots = clampLots(Math.floor(premiumBudgetRs / unitPair));
  if (pairLots >= 1) {
    niftyLots = pairLots;
    bankLots = pairLots;
    // Spend leftover budget on the cheaper book (Nifty) first, then Bank.
    let left = premiumBudgetRs - cost({ nifty: niftyLots, bank: bankLots });
    while (left >= ATM_PREMIUM_RS_PER_LOT.nifty && niftyLots < MAX_LOTS_PER_BOOK) {
      niftyLots += 1;
      left -= ATM_PREMIUM_RS_PER_LOT.nifty;
    }
    while (left >= ATM_PREMIUM_RS_PER_LOT.bank && bankLots < MAX_LOTS_PER_BOOK) {
      bankLots += 1;
      left -= ATM_PREMIUM_RS_PER_LOT.bank;
    }
  } else if (premiumBudgetRs >= ATM_PREMIUM_RS_PER_LOT.nifty) {
    niftyLots = 1;
  } else if (premiumBudgetRs >= ATM_PREMIUM_RS_PER_LOT.bank) {
    bankLots = 1;
  } else {
    // Below one ATM lot proxy — still arm Nifty ×1 so the desk is not empty.
    niftyLots = 1;
  }

  const estimatedPremiumRs = cost({ nifty: niftyLots, bank: bankLots });
  const riskLots = Math.max(niftyLots, bankLots, 1);
  const dayProfitLockRs = DAY_PROFIT_LOCK_PER_LOT_RS * riskLots;
  const optionTrailArmRs = OPTION_TRAIL_PER_LOT_RS.armRs * riskLots;
  // Target sits under the lock band (~⅔ of locked day at 1-lot DNA).
  const dailyTargetRs = Math.round(dayProfitLockRs * (2_000 / 3_000));
  const tenDayGoalRs = dailyTargetRs * 10;

  return {
    capitalRs: capital,
    premiumBudgetRs,
    niftyLots,
    bankLots,
    enableNifty: niftyLots > 0,
    enableBank: bankLots > 0,
    estimatedPremiumRs,
    dailyTargetRs,
    tenDayGoalRs,
    dayProfitLockRs,
    riskLots,
    optionTrailArmRs,
    note:
      `Capital ₹${capital.toLocaleString('en-IN')} · premium budget ₹${premiumBudgetRs.toLocaleString('en-IN')} · ` +
      `lots N${niftyLots}/B${bankLots} · lock ~₹${dayProfitLockRs.toLocaleString('en-IN')}/day · ` +
      `trail arm ₹${optionTrailArmRs.toLocaleString('en-IN')} · ` +
      `target ~₹${dailyTargetRs.toLocaleString('en-IN')}/day`,
  };
}
