export interface EntryQualityBreakdown {
  trendAlignment: number;
  breakoutStrength: number;
  structureQuality: number;
  confirmationCandle: number;
  riskReward: number;
  total: number;
}

export const ENTRY_QUALITY_MIN_SCORE = 80;

export interface EntryQualityInput {
  trendAligned: boolean;
  /** 0–100 breakout or momentum strength */
  breakoutStrengthPct: number;
  /** 0–100 structure score (e.g. reversal stages) */
  structureScorePct: number;
  /** 0–100 confirmation candle quality */
  confirmationScorePct: number;
  riskRewardRatio: number;
}

export function calculateEntryQualityScore(input: EntryQualityInput): EntryQualityBreakdown {
  const trendAlignment = input.trendAligned ? 20 : Math.round(input.breakoutStrengthPct * 0.1);
  const breakoutStrength = Math.min(20, Math.round((input.breakoutStrengthPct / 100) * 20));
  const structureQuality = Math.min(20, Math.round((input.structureScorePct / 100) * 20));
  const confirmationCandle = Math.min(20, Math.round((input.confirmationScorePct / 100) * 20));
  const riskReward = Math.min(20, Math.round((input.riskRewardRatio / 2.5) * 20));

  const total = trendAlignment + breakoutStrength + structureQuality + confirmationCandle + riskReward;

  return {
    trendAlignment,
    breakoutStrength,
    structureQuality,
    confirmationCandle,
    riskReward,
    total,
  };
}

export function passesEntryQuality(score: EntryQualityBreakdown): boolean {
  return score.total >= ENTRY_QUALITY_MIN_SCORE;
}
