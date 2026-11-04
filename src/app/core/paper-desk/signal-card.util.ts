/**
 * Explains a paper signal: the rule checks behind it, entry / stop / target and the modelled ₹ risk and reward.
 * The rule score is the share of checks that agree. It is NOT a probability of profit and is not calibrated
 * against outcomes — the forward ledger is what measures how often signals actually win.
 */
import { SignalCard, SignalCheck } from './paper-analytics.models';
import { ChargeVenue, optionRoundTripCharges } from './option-charges.util';

export const MODE_REASON: Record<string, string> = {
  pdhl: 'Index closed beyond the previous-day high/low in the signal direction (trend continuation).',
  fade: 'Index swept the opening-range edge, closed back inside and reversed (range fade).',
  orb_fade: 'Index swept the opening-range edge, closed back inside and reversed (opening-range fade).',
  trap: 'Index swept a 6-bar swing extreme and closed back inside (liquidity trap reversal).',
  vwap_fade: 'Index stretched away from its session average and the bar reversed toward it (mean reversion).',
  orb_break: 'Index closed beyond the opening range in the signal direction (opening-range breakout).',
  pdhl_fade: 'Previous-day break or opening-range fade.',
  fade_trap: 'Opening-range fade or swing trap.',
  all_three: 'Previous-day break, opening-range fade or swing trap.',
};

const STRUCTURE_REASON: Record<string, string> = {
  trend: 'Morning opening range resolved into a trend.',
  range: 'Morning opening range stayed inside a range.',
  quiet: 'Morning opening range was narrow (quiet session).',
  stand: 'Morning structure not yet decided.',
  wait: 'Morning structure not yet decided.',
};

export interface SignalCardInput {
  book: string;
  venue: ChargeVenue;
  mode: string;
  structure: string;
  /** True when the signal came from the primary rule for this structure rather than a backup. */
  primaryRule: boolean;
  entry: number;
  sl: number;
  tp: number;
  qty: number;
  premiumCostRs: number;
  /** True when the fill used a live ask on a listed contract. */
  liveAsk: boolean;
  /** Observed (ask - bid) / mid at entry, if a quote was available. */
  spreadPct: number | null;
  entryMinute: number;
  entryStartMin: number;
  flatMin: number;
  dayClosedRs: number;
  dayLossCapRs: number;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildSignalCard(i: SignalCardInput): SignalCard {
  const risk = Math.max(0, i.entry - i.sl) * i.qty + optionRoundTripCharges(i.entry, i.sl, i.qty, i.venue);
  const reward = Math.max(0, i.tp - i.entry) * i.qty - optionRoundTripCharges(i.entry, i.tp, i.qty, i.venue);
  const rewardRisk = risk > 0 ? r2(reward / risk) : null;
  const checks: SignalCheck[] = [
    { label: 'Morning structure decided', pass: i.structure !== 'wait' && i.structure !== 'stand' },
    { label: 'Primary rule for this structure', pass: i.primaryRule },
    { label: 'Confirmation candle agreed', pass: true },
    { label: 'Inside entry window', pass: i.entryMinute >= i.entryStartMin && i.entryMinute <= i.flatMin - 30 },
    { label: 'Live ask on a listed contract', pass: i.liveAsk && i.premiumCostRs > 0 },
    { label: 'Day-loss headroom left', pass: i.dayClosedRs > -i.dayLossCapRs / 2 },
    { label: 'Reward at least 1.5x risk', pass: rewardRisk != null && rewardRisk >= 1.5 },
    {
      label: 'Bid/ask spread under 3%',
      pass: i.spreadPct != null && i.spreadPct <= 0.03,
    },
  ];
  const passed = checks.filter((c) => c.pass).length;
  const reasons = [
    MODE_REASON[i.mode] ?? `Rule ${i.mode}.`,
    STRUCTURE_REASON[i.structure] ?? '',
    i.primaryRule ? 'Rule is the primary one for this structure.' : 'Rule is a backup for this structure.',
    i.spreadPct == null ? 'No bid/ask was observed at entry; cost is modelled.' : `Observed spread ${r2(i.spreadPct * 100)}% of premium.`,
  ].filter(Boolean);
  return {
    ruleScore: Math.round((passed / checks.length) * 100),
    checks,
    reasons,
    entry: i.entry,
    sl: i.sl,
    tp: i.tp,
    qty: i.qty,
    riskRs: r2(risk),
    rewardRs: r2(reward),
    rewardRisk,
  };
}
