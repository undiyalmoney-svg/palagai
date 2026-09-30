import { SmcMarketId } from './smc.types';

export type SmcSlMethod = 'swing' | 'orderBlock' | 'atr';
export type SmcTpMethod = 'rr' | 'structure';
export type SmcEntryTrigger = 'both' | 'choch' | 'bos';

/**
 * Every tunable of the SMC engine. Nothing in the engine reads a literal that
 * is not here, so the same logic runs on any market and timeframe.
 */
export interface SmcConfig {
  // 1. Market structure
  /** Bars either side of a pivot. A swing is only marked this many bars later. */
  swingLength: number;
  atrPeriod: number;
  /** Two swings closer than this many ATRs are "equal" (EQH / EQL). */
  eqTolAtr: number;
  /** Swings back that an equal-high / equal-low search looks through. */
  eqLookbackSwings: number;
  /** Close beyond a swing by at least this many ATRs to count as a break. */
  breakBufferAtr: number;

  // 2. Trend determination
  /** Number of latest swings that define the current range. */
  rangeSwings: number;
  /** Swings spanning less than this many ATRs read as SIDEWAYS. */
  sidewaysRangeAtr: number;
  swingLengthHtf: number;
  /** Only take entries that agree with the higher-timeframe trend. */
  requireHtfTrend: boolean;

  // 3. Setup detection
  useDiscountPremium: boolean;
  useOrderBlock: boolean;
  useFvg: boolean;
  useLiquiditySweep: boolean;
  /** Fraction of the dealing range that counts as discount (below) / premium (above). */
  pdThreshold: number;
  /** Order blocks taller than this many ATRs fall back to their body. */
  obMaxAtr: number;
  fvgMinAtr: number;
  /** How many POI kinds must be touched to arm a setup. */
  minConfluence: number;
  /** A liquidity sweep or a rejection candle must precede the entry. */
  requireSweepOrReaction: boolean;
  /** Lower / upper wick share of the candle range that reads as rejection. */
  reactionWickRatio: number;
  setupExpiryBars: number;
  cooldownBars: number;

  // 4. Entry confirmation
  entryTrigger: SmcEntryTrigger;
  /** Bars after the break in which a confirming candle may still print. */
  confirmWindowBars: number;

  // 5. Stop loss
  slMethod: SmcSlMethod;
  slBufferAtr: number;
  slAtrMult: number;
  minRiskAtr: number;
  maxRiskAtr: number;

  // 6. Take profit
  minRR: number;
  targetMultiplier: number;
  tpMethod: SmcTpMethod;
  /** Falls back to R-multiples when no liquidity level gives minRR. */
  structureFallback: boolean;
  tp1Fraction: number;
  tp2Fraction: number;
  /** Share of the position closed at TP1 / TP2 / final. Sums to 100. */
  partialPct: [number, number, number];
  moveStopToBreakeven: boolean;

  // 7. Exit
  exitOnOppositeStructure: boolean;
  exitOnTrendReversal: boolean;
  exitOnObInvalidation: boolean;

  // Risk management
  riskPerTradePct: number;
  maxOpenPositions: number;
  initialCapital: number;

  // Display caps
  maxLiquidityLines: number;
  maxOrderBlocks: number;
  maxFvgs: number;
}

export const DEFAULT_SMC_CONFIG: SmcConfig = {
  swingLength: 3,
  atrPeriod: 14,
  eqTolAtr: 0.1,
  eqLookbackSwings: 6,
  breakBufferAtr: 0,

  rangeSwings: 4,
  sidewaysRangeAtr: 2,
  swingLengthHtf: 3,
  requireHtfTrend: true,

  useDiscountPremium: true,
  useOrderBlock: true,
  useFvg: true,
  useLiquiditySweep: true,
  pdThreshold: 0.5,
  obMaxAtr: 3,
  fvgMinAtr: 0.1,
  minConfluence: 1,
  requireSweepOrReaction: true,
  reactionWickRatio: 0.3,
  setupExpiryBars: 30,
  cooldownBars: 3,

  entryTrigger: 'both',
  confirmWindowBars: 2,

  slMethod: 'swing',
  slBufferAtr: 0.1,
  slAtrMult: 1.5,
  minRiskAtr: 0.3,
  maxRiskAtr: 6,

  minRR: 2,
  targetMultiplier: 1.5,
  tpMethod: 'rr',
  structureFallback: true,
  tp1Fraction: 1 / 3,
  tp2Fraction: 2 / 3,
  partialPct: [33, 33, 34],
  moveStopToBreakeven: true,

  exitOnOppositeStructure: true,
  exitOnTrendReversal: true,
  exitOnObInvalidation: true,

  riskPerTradePct: 1,
  maxOpenPositions: 1,
  initialCapital: 100_000,

  maxLiquidityLines: 3,
  maxOrderBlocks: 3,
  maxFvgs: 3,
};

/**
 * Per-market starting points. The logic is identical; only tolerances differ
 * because Bank Nifty and Crude carry more noise per ATR than Nifty.
 */
export const SMC_MARKET_PRESETS: Record<SmcMarketId, Partial<SmcConfig>> = {
  nifty: {},
  bank: { eqTolAtr: 0.12, slBufferAtr: 0.12, fvgMinAtr: 0.12 },
  crude: { eqTolAtr: 0.12, slBufferAtr: 0.15, fvgMinAtr: 0.12, obMaxAtr: 3.5 },
};

export function resolveSmcConfig(
  market: SmcMarketId,
  overrides: Partial<SmcConfig> = {},
): SmcConfig {
  return sanitizeSmcConfig({
    ...DEFAULT_SMC_CONFIG,
    ...SMC_MARKET_PRESETS[market],
    ...overrides,
  });
}

/** Clamp user input into ranges the engine can run on. */
export function sanitizeSmcConfig(config: SmcConfig): SmcConfig {
  const num = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const int = (value: number, fallback: number, min: number, max: number) =>
    Math.round(num(value, fallback, min, max));
  const d = DEFAULT_SMC_CONFIG;

  const partial = Array.isArray(config.partialPct) ? config.partialPct : d.partialPct;
  const parts = [0, 1, 2].map((i) => Math.max(0, Number(partial[i]) || 0));
  const sum = parts[0]! + parts[1]! + parts[2]!;
  const partialPct: [number, number, number] =
    sum > 0
      ? [(parts[0]! / sum) * 100, (parts[1]! / sum) * 100, (parts[2]! / sum) * 100]
      : [...d.partialPct];

  const tp1 = num(config.tp1Fraction, d.tp1Fraction, 0.05, 0.95);
  const tp2 = num(config.tp2Fraction, d.tp2Fraction, tp1 + 0.01, 0.99);

  return {
    ...config,
    swingLength: int(config.swingLength, d.swingLength, 1, 20),
    swingLengthHtf: int(config.swingLengthHtf, d.swingLengthHtf, 1, 20),
    atrPeriod: int(config.atrPeriod, d.atrPeriod, 2, 100),
    eqTolAtr: num(config.eqTolAtr, d.eqTolAtr, 0, 2),
    eqLookbackSwings: int(config.eqLookbackSwings, d.eqLookbackSwings, 1, 30),
    breakBufferAtr: num(config.breakBufferAtr, d.breakBufferAtr, 0, 2),
    rangeSwings: int(config.rangeSwings, d.rangeSwings, 2, 12),
    sidewaysRangeAtr: num(config.sidewaysRangeAtr, d.sidewaysRangeAtr, 0, 20),
    pdThreshold: num(config.pdThreshold, d.pdThreshold, 0.1, 0.9),
    obMaxAtr: num(config.obMaxAtr, d.obMaxAtr, 0.5, 20),
    fvgMinAtr: num(config.fvgMinAtr, d.fvgMinAtr, 0, 5),
    minConfluence: int(config.minConfluence, d.minConfluence, 1, 4),
    reactionWickRatio: num(config.reactionWickRatio, d.reactionWickRatio, 0, 0.9),
    setupExpiryBars: int(config.setupExpiryBars, d.setupExpiryBars, 1, 500),
    cooldownBars: int(config.cooldownBars, d.cooldownBars, 0, 100),
    confirmWindowBars: int(config.confirmWindowBars, d.confirmWindowBars, 0, 20),
    slBufferAtr: num(config.slBufferAtr, d.slBufferAtr, 0, 5),
    slAtrMult: num(config.slAtrMult, d.slAtrMult, 0.1, 20),
    minRiskAtr: num(config.minRiskAtr, d.minRiskAtr, 0, 10),
    maxRiskAtr: num(config.maxRiskAtr, d.maxRiskAtr, 0.5, 50),
    minRR: num(config.minRR, d.minRR, 0.5, 20),
    targetMultiplier: num(config.targetMultiplier, d.targetMultiplier, 0.5, 10),
    tp1Fraction: tp1,
    tp2Fraction: tp2,
    partialPct,
    riskPerTradePct: num(config.riskPerTradePct, d.riskPerTradePct, 0.05, 100),
    maxOpenPositions: int(config.maxOpenPositions, d.maxOpenPositions, 1, 10),
    initialCapital: num(config.initialCapital, d.initialCapital, 1, 1e12),
    maxLiquidityLines: int(config.maxLiquidityLines, d.maxLiquidityLines, 0, 20),
    maxOrderBlocks: int(config.maxOrderBlocks, d.maxOrderBlocks, 0, 20),
    maxFvgs: int(config.maxFvgs, d.maxFvgs, 0, 20),
    slMethod: (['swing', 'orderBlock', 'atr'] as const).includes(config.slMethod)
      ? config.slMethod
      : d.slMethod,
    tpMethod: config.tpMethod === 'structure' ? 'structure' : 'rr',
    entryTrigger: (['both', 'choch', 'bos'] as const).includes(config.entryTrigger)
      ? config.entryTrigger
      : d.entryTrigger,
  };
}
