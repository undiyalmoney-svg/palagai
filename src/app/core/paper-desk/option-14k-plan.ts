/**
 * ₹14k option-buying plan. Motto: buy CE / PE.
 *
 * ATM index / Crude ATM still wash this cash. Cheap next-expiry OTM that
 * fits the ₹3,500 premium budget and ₹420 day-loss is the book.
 * Paper / Test trade these. Crude Mini FUT is refused at ₹14k (Kite NRML ~₹31k).
 * Not a guaranteed profit.
 */
import { LiveAssumeBookCfg } from './live-assume.engine';

export type Option14kBookId = 'nifty' | 'bank' | 'sensex' | 'crude';

export const OPTION_14K_CAPITAL_RS = 14_000;
export const OPTION_14K_PREMIUM_BUDGET_RS = 3_500;
export const OPTION_14K_DAY_LOSS_RS = 420;
export const OPTION_14K_CHARGE_RS = 50;

export interface Option14kBookPlan {
  id: Option14kBookId;
  label: string;
  exchange: 'MCX' | 'NFO' | 'BFO';
  name: string;
  lot: number;
  strikeStep: number;
  /** Distance from ATM to the cheap strike (underlying pts). */
  otmPts: number;
  /** Target premium per unit. */
  targetPremRs: number;
  openCostRs: number;
  oneStopRs: number;
  /** Premium-point SL / TP / scratch once the option is bound. */
  slPrem: number;
  tpPrem: number;
  scratchPrem: number;
  rsPt: number;
  product: string;
  expiryNote: string;
  orS: number;
  orE: number;
  entryS: number;
  flat: number;
  quietW: number;
  pdMax: number;
  orMin: number;
  orMax: number;
  trapP: number;
  vwapMin: number;
  primary: Record<string, string>;
  backup: Record<string, readonly string[]>;
}

const INDEX_BACKUP = {
  trend: ['trap', 'all_three', 'fade_trap'],
  range: ['trap', 'vwap_fade', 'fade_trap'],
  quiet: ['fade', 'trap', 'fade_trap'],
  stand: ['trap', 'vwap_fade', 'fade'],
} as const;

export const OPTION_14K_BOOKS: Record<Option14kBookId, Option14kBookPlan> = {
  nifty: {
    id: 'nifty',
    label: 'Nifty 50',
    exchange: 'NFO',
    name: 'NIFTY',
    lot: 65,
    strikeStep: 50,
    otmPts: 200,
    targetPremRs: 50,
    openCostRs: 3_250,
    oneStopRs: 325,
    slPrem: 5,
    tpPrem: 10,
    scratchPrem: 2.4,
    rsPt: 65,
    product: 'cheap CE/PE ₹50 ×65',
    expiryNote: 'Nifty weekly is Tuesday. On expiry day trade the next Tuesday — never the dying week.',
    orS: 9 * 60 + 15,
    orE: 10 * 60 + 15,
    entryS: 10 * 60 + 15,
    flat: 15 * 60 + 15,
    quietW: 30,
    pdMax: 500,
    orMin: 20,
    orMax: 180,
    trapP: 12,
    vwapMin: 15,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: INDEX_BACKUP,
  },
  bank: {
    id: 'bank',
    label: 'Bank Nifty',
    exchange: 'NFO',
    name: 'BANKNIFTY',
    lot: 30,
    strikeStep: 100,
    otmPts: 400,
    targetPremRs: 100,
    openCostRs: 3_000,
    oneStopRs: 300,
    slPrem: 10,
    tpPrem: 22,
    scratchPrem: 5,
    rsPt: 30,
    product: 'cheap CE/PE ₹100 ×30',
    expiryNote: 'Bank Nifty is monthly (last Tuesday). On expiry day trade the next month.',
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 80,
    pdMax: 900,
    orMin: 40,
    orMax: 350,
    trapP: 25,
    vwapMin: 30,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: INDEX_BACKUP,
  },
  sensex: {
    id: 'sensex',
    label: 'Sensex',
    exchange: 'BFO',
    name: 'SENSEX',
    lot: 20,
    strikeStep: 100,
    otmPts: 500,
    targetPremRs: 150,
    openCostRs: 3_000,
    oneStopRs: 320,
    slPrem: 16,
    tpPrem: 32,
    scratchPrem: 8,
    rsPt: 20,
    product: 'cheap CE/PE ₹150 ×20',
    expiryNote: 'Sensex weekly is Friday. On expiry day trade the next Friday — never the dying week.',
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 100,
    pdMax: 1000,
    orMin: 50,
    orMax: 400,
    trapP: 30,
    vwapMin: 35,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: INDEX_BACKUP,
  },
  crude: {
    id: 'crude',
    label: 'Crude Mini',
    exchange: 'MCX',
    name: 'CRUDEOILM',
    lot: 10,
    strikeStep: 50,
    otmPts: 100,
    targetPremRs: 150,
    openCostRs: 1_500,
    oneStopRs: 200,
    slPrem: 20,
    tpPrem: 25,
    scratchPrem: 10,
    rsPt: 10,
    product: 'cheap CE/PE ₹150 ×10',
    expiryNote: 'CRUDEOILM options: on expiry day skip the dying month and trade the next listed expiry.',
    orS: 10 * 60,
    orE: 10 * 60 + 30,
    entryS: 10 * 60 + 30,
    flat: 23 * 60 + 10,
    quietW: 25,
    pdMax: 400,
    orMin: 12,
    orMax: 220,
    trapP: 8,
    vwapMin: 18,
    primary: { trend: 'pdhl', range: 'orb_fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'orb_break', 'all_three'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['orb_fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'orb_fade'],
    },
  },
};

export const OPTION_14K_LIST: Option14kBookPlan[] = [
  OPTION_14K_BOOKS.crude,
  OPTION_14K_BOOKS.nifty,
  OPTION_14K_BOOKS.bank,
  OPTION_14K_BOOKS.sensex,
];

export function option14kToPaperCfg(plan: Option14kBookPlan): LiveAssumeBookCfg {
  return {
    id: plan.id,
    label: plan.label,
    product: plan.product,
    sl: plan.slPrem,
    tp: plan.tpPrem,
    scratch: plan.scratchPrem,
    rsPt: plan.rsPt,
    orS: plan.orS,
    orE: plan.orE,
    entryS: plan.entryS,
    flat: plan.flat,
    quietW: plan.quietW,
    pdMax: plan.pdMax,
    premiumRs: plan.openCostRs,
    orMin: plan.orMin,
    orMax: plan.orMax,
    trapP: plan.trapP,
    vwapMin: plan.vwapMin,
    primary: plan.primary,
    backup: plan.backup,
    buyOption: true,
  };
}

export function canBuyCheapCepe(
  book: Option14kBookId,
  capitalRs: number,
  premiumBudget: number,
  dayLoss: number,
): boolean {
  const plan = OPTION_14K_BOOKS[book];
  if (capitalRs < plan.openCostRs) return false;
  if (plan.openCostRs > premiumBudget) return false;
  if (plan.oneStopRs > dayLoss) return false;
  return true;
}

export const OPTION_14K_HONEST =
  'Motto: buy CE/PE. Cheap next-expiry OTM on Crude Mini, Nifty 50, Bank Nifty and Sensex. ' +
  'Premium ≤ ₹3,500 · day-loss ₹420 · 1 lot · skip expiry day. ATM still blocked. ' +
  'Paper / Test only — no Kite order. Crude Mini FUT is refused at ₹14k (NRML ~₹31k). Not a guaranteed profit.';
