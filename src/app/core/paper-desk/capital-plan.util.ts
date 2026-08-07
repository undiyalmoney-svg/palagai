/**
 * Capital-aware desk sizing for long CE/PE books.
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
  crude: 1_500,
  natgas: 3_000,
} as const;

export type CapitalBook = keyof typeof ATM_PREMIUM_RS_PER_LOT;

export interface CapitalLotPlan {
  capitalRs: number;
  premiumBudgetRs: number;
  niftyLots: number;
  bankLots: number;
  crudeLots: number;
  natGasLots: number;
  enableNifty: boolean;
  enableBank: boolean;
  enableCrude: boolean;
  enableNatGas: boolean;
  estimatedPremiumRs: number;
  dailyTargetRs: number;
  tenDayGoalRs: number;
  dayProfitLockRs: number;
  note: string;
}

function cost(lots: {
  nifty: number;
  bank: number;
  crude: number;
  natgas?: number;
}): number {
  return (
    lots.nifty * ATM_PREMIUM_RS_PER_LOT.nifty +
    lots.bank * ATM_PREMIUM_RS_PER_LOT.bank +
    lots.crude * ATM_PREMIUM_RS_PER_LOT.crude +
    (lots.natgas ?? 0) * ATM_PREMIUM_RS_PER_LOT.natgas
  );
}

/**
 * Pick lots for a capital base. Prefers Nifty+Bank+Crude ×1 when it fits.
 * Never enables Nat Gas on the capital plan (not in the 40k objective books).
 */
export function planLotsForCapital(capitalRs: number = DEFAULT_TRADING_CAPITAL_RS): CapitalLotPlan {
  const capital = Math.max(10_000, Math.floor(Number(capitalRs) || DEFAULT_TRADING_CAPITAL_RS));
  const premiumBudgetRs = Math.floor(capital * PREMIUM_BUDGET_FRAC);

  const candidates: Array<{ nifty: number; bank: number; crude: number }> = [
    { nifty: 1, bank: 1, crude: 1 },
    { nifty: 1, bank: 1, crude: 0 },
    { nifty: 1, bank: 0, crude: 1 },
    { nifty: 1, bank: 0, crude: 0 },
    { nifty: 0, bank: 1, crude: 0 },
  ];

  // If capital grows, allow 2 lots on the cheapest high-edge book only when safe.
  if (premiumBudgetRs >= cost({ nifty: 2, bank: 1, crude: 1 })) {
    candidates.unshift({ nifty: 2, bank: 1, crude: 1 });
  }
  if (premiumBudgetRs >= cost({ nifty: 1, bank: 2, crude: 1 })) {
    candidates.unshift({ nifty: 1, bank: 2, crude: 1 });
  }

  let chosen: { nifty: number; bank: number; crude: number } | null = null;
  for (const c of candidates) {
    if (cost(c) <= premiumBudgetRs) {
      chosen = c;
      break;
    }
  }
  // Last resort: cheapest single book that fits; else Nifty×1 (may exceed budget).
  if (!chosen) {
    const singles = [
      { nifty: 0, bank: 0, crude: 1 },
      { nifty: 1, bank: 0, crude: 0 },
      { nifty: 0, bank: 1, crude: 0 },
    ];
    chosen = singles.find((c) => cost(c) <= premiumBudgetRs) ?? { nifty: 1, bank: 0, crude: 0 };
  }

  const estimatedPremiumRs = cost(chosen);
  // 5% of capital / day ≈ ₹2k on ₹40k; day lock slightly above so winners can finish.
  const dailyTargetRs = Math.round(capital * 0.05);
  const tenDayGoalRs = dailyTargetRs * 10;
  const dayProfitLockRs = Math.round(capital * 0.075); // ₹3k on ₹40k

  return {
    capitalRs: capital,
    premiumBudgetRs,
    niftyLots: chosen.nifty,
    bankLots: chosen.bank,
    crudeLots: chosen.crude,
    natGasLots: 0,
    enableNifty: chosen.nifty > 0,
    enableBank: chosen.bank > 0,
    enableCrude: chosen.crude > 0,
    enableNatGas: false,
    estimatedPremiumRs,
    dailyTargetRs,
    tenDayGoalRs,
    dayProfitLockRs,
    note:
      `Capital ₹${capital.toLocaleString('en-IN')} · premium budget ₹${premiumBudgetRs.toLocaleString('en-IN')} · ` +
      `lots N${chosen.nifty}/B${chosen.bank}/C${chosen.crude} · target ~₹${dailyTargetRs.toLocaleString('en-IN')}/day`,
  };
}
