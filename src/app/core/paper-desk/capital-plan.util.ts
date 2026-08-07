/**
 * Capital-aware desk sizing for long CE/PE index books (Nifty + Bank only).
 * ₹40k plan → auto lots so concurrent ATM premium stays inside a safe budget.
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
  note: string;
}

function cost(lots: { nifty: number; bank: number }): number {
  return lots.nifty * ATM_PREMIUM_RS_PER_LOT.nifty + lots.bank * ATM_PREMIUM_RS_PER_LOT.bank;
}

/**
 * Pick lots for a capital base. Nifty+Bank only (Trade Desk has no Crude).
 */
export function planLotsForCapital(capitalRs: number = DEFAULT_TRADING_CAPITAL_RS): CapitalLotPlan {
  const capital = Math.max(10_000, Math.floor(Number(capitalRs) || DEFAULT_TRADING_CAPITAL_RS));
  const premiumBudgetRs = Math.floor(capital * PREMIUM_BUDGET_FRAC);

  const candidates: Array<{ nifty: number; bank: number }> = [
    { nifty: 1, bank: 1 },
    { nifty: 1, bank: 0 },
    { nifty: 0, bank: 1 },
  ];

  if (premiumBudgetRs >= cost({ nifty: 2, bank: 1 })) {
    candidates.unshift({ nifty: 2, bank: 1 });
  }
  if (premiumBudgetRs >= cost({ nifty: 1, bank: 2 })) {
    candidates.unshift({ nifty: 1, bank: 2 });
  }

  let chosen: { nifty: number; bank: number } | null = null;
  for (const c of candidates) {
    if (cost(c) <= premiumBudgetRs) {
      chosen = c;
      break;
    }
  }
  if (!chosen) {
    chosen =
      candidates.find((c) => cost(c) <= premiumBudgetRs) ?? { nifty: 1, bank: 0 };
  }

  const estimatedPremiumRs = cost(chosen);
  const dailyTargetRs = Math.round(capital * 0.05);
  const tenDayGoalRs = dailyTargetRs * 10;
  const dayProfitLockRs = Math.round(capital * 0.075);

  return {
    capitalRs: capital,
    premiumBudgetRs,
    niftyLots: chosen.nifty,
    bankLots: chosen.bank,
    enableNifty: chosen.nifty > 0,
    enableBank: chosen.bank > 0,
    estimatedPremiumRs,
    dailyTargetRs,
    tenDayGoalRs,
    dayProfitLockRs,
    note:
      `Capital ₹${capital.toLocaleString('en-IN')} · premium budget ₹${premiumBudgetRs.toLocaleString('en-IN')} · ` +
      `lots N${chosen.nifty}/B${chosen.bank} · target ~₹${dailyTargetRs.toLocaleString('en-IN')}/day`,
  };
}
