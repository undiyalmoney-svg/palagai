import {
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  isBearishCandle,
  isBullishCandle,
} from '../../../strategy-engine/utils/swing-level.util';
import {
  bodySize,
  candleRange,
  last3HigherHighHigherLow,
  last3LowerHighLowerLow,
  trend30m,
} from '../../../strategy-engine/utils/ohlc-candle.util';
import { evaluateSidewaysMarketFilter } from '../../../strategy-engine/utils/sideways-market-filter.util';
import { calculateMomentumScore } from '../../../strategy-engine/utils/momentum-score.util';
import { RuleContext, RuleDefinition, RuleEvaluation, RuleGateResult } from '../models/research-optimization.model';

function pass(ruleId: string, name: string, reason: string): RuleEvaluation {
  return { ruleId, ruleName: name, passed: true, reason };
}

function fail(ruleId: string, name: string, reason: string): RuleEvaluation {
  return { ruleId, ruleName: name, passed: false, reason };
}

function extractTime(dateTime: string): string {
  const normalized = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return (normalized.split(' ')[1] ?? '').slice(0, 5);
}

export const RULE_CATALOG: RuleDefinition[] = [
  {
    id: 'trend_60m',
    name: '60-Minute Trend Confirmation',
    category: 'Trend',
    description: '60m structure must align with signal direction',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous60m, ctx.strategyContext.candle60m];
      const trend = detectStructureTrend(detectSwingHighs(candles), detectSwingLows(candles));
      if (trend === 'Sideways') {
        return fail('trend_60m', '60-Minute Trend Confirmation', '60m trend is sideways');
      }
      if (ctx.rawSignal.action === 'BUY' && trend !== 'Bullish') {
        return fail('trend_60m', '60-Minute Trend Confirmation', '60m trend not bullish for BUY');
      }
      if (ctx.rawSignal.action === 'SELL' && trend !== 'Bearish') {
        return fail('trend_60m', '60-Minute Trend Confirmation', '60m trend not bearish for SELL');
      }
      return pass('trend_60m', '60-Minute Trend Confirmation', `60m trend ${trend}`);
    },
  },
  {
    id: 'trend_30m',
    name: '30-Minute Trend Confirmation',
    category: 'Trend',
    description: '30m trend must agree with signal direction',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous30m, ctx.strategyContext.candle30m];
      const t = trend30m(candles).trend;
      if (ctx.rawSignal.action === 'BUY' && t !== 'BUY') {
        return fail('trend_30m', '30-Minute Trend Confirmation', '30m not bullish');
      }
      if (ctx.rawSignal.action === 'SELL' && t !== 'SELL') {
        return fail('trend_30m', '30-Minute Trend Confirmation', '30m not bearish');
      }
      return pass('trend_30m', '30-Minute Trend Confirmation', '30m confirms direction');
    },
  },
  {
    id: 'support_resistance_30m',
    name: '30m Support/Resistance Confirmation',
    category: 'Structure',
    description: '30m swing level aligns with trade direction',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous30m, ctx.strategyContext.candle30m];
      const highs = detectSwingHighs(candles);
      const lows = detectSwingLows(candles);
      if (ctx.rawSignal.action === 'BUY' && !lows.length) {
        return fail('support_resistance_30m', '30m Support/Resistance Confirmation', 'No 30m support');
      }
      if (ctx.rawSignal.action === 'SELL' && !highs.length) {
        return fail('support_resistance_30m', '30m Support/Resistance Confirmation', 'No 30m resistance');
      }
      return pass('support_resistance_30m', '30m Support/Resistance Confirmation', '30m level present');
    },
  },
  {
    id: 'pullback_15m',
    name: '15-Minute Pullback Confirmation',
    category: 'Structure',
    description: '15m shows pullback toward key level',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous15m, ctx.strategyContext.candle15m];
      if (candles.length < 4) {
        return fail('pullback_15m', '15-Minute Pullback Confirmation', 'Insufficient 15m candles');
      }
      return pass('pullback_15m', '15-Minute Pullback Confirmation', '15m pullback structure present');
    },
  },
  {
    id: 'confirmation_5m',
    name: '5-Minute Confirmation Candle',
    category: 'Entry',
    description: '5m confirmation candle valid for direction',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      const current = ctx.strategyContext.candle5m;
      const prev = candles.length >= 2 ? candles[candles.length - 2]! : null;
      if (!prev || ctx.rawSignal.action === 'NO_TRADE') {
        return pass('confirmation_5m', '5-Minute Confirmation Candle', 'No signal');
      }
      if (ctx.rawSignal.action === 'BUY') {
        const ok = isBullishCandle(current) && bodySize(current) > bodySize(prev);
        return ok
          ? pass('confirmation_5m', '5-Minute Confirmation Candle', 'Bullish 5m confirmation')
          : fail('confirmation_5m', '5-Minute Confirmation Candle', 'Weak 5m bullish candle');
      }
      const ok = isBearishCandle(current) && bodySize(current) > bodySize(prev);
      return ok
        ? pass('confirmation_5m', '5-Minute Confirmation Candle', 'Bearish 5m confirmation')
        : fail('confirmation_5m', '5-Minute Confirmation Candle', 'Weak 5m bearish candle');
    },
  },
  {
    id: 'bos',
    name: 'Break of Structure (BOS)',
    category: 'Structure',
    description: 'Break of structure detected',
    evaluate: (ctx) => {
      const passed = ctx.rawSignal.analysis['breakOfStructure'] === 'YES' || ctx.rawSignal.analysis['breakout'] === 'YES';
      return passed ? pass('bos', 'Break of Structure (BOS)', 'BOS confirmed') : fail('bos', 'Break of Structure (BOS)', 'No BOS');
    },
  },
  {
    id: 'choch',
    name: 'Change of Character (CHOCH)',
    category: 'Structure',
    description: 'Character change in swing structure',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      const ok = (ctx.rawSignal.action === 'BUY' && last3HigherHighHigherLow(candles)) || (ctx.rawSignal.action === 'SELL' && last3LowerHighLowerLow(candles));
      return ok ? pass('choch', 'Change of Character (CHOCH)', 'CHOCH present') : fail('choch', 'Change of Character (CHOCH)', 'No CHOCH');
    },
  },
  {
    id: 'retest',
    name: 'Retest',
    category: 'Structure',
    description: 'Retest of breakout level held',
    evaluate: (ctx) => {
      const passed = ctx.rawSignal.analysis['retest'] === 'YES' || ctx.rawSignal.analysis['retestHeld'] === true;
      return passed ? pass('retest', 'Retest', 'Retest held') : fail('retest', 'Retest', 'Retest not confirmed');
    },
  },
  {
    id: 'trendline_breakout',
    name: 'Trendline Breakout',
    category: 'Structure',
    description: 'Objective trendline breakout',
    evaluate: (ctx) => {
      const passed = ctx.rawSignal.analysis['breakout'] === 'YES';
      return passed ? pass('trendline_breakout', 'Trendline Breakout', 'Breakout detected') : fail('trendline_breakout', 'Trendline Breakout', 'No breakout');
    },
  },
  {
    id: 'trendline_retest',
    name: 'Trendline Retest',
    category: 'Structure',
    description: 'Trendline retest held',
    evaluate: (ctx) => {
      const passed = ctx.rawSignal.analysis['retest'] === 'YES';
      return passed ? pass('trendline_retest', 'Trendline Retest', 'Retest held') : fail('trendline_retest', 'Trendline Retest', 'No retest');
    },
  },
  {
    id: 'support_confirmation',
    name: 'Support Confirmation',
    category: 'Structure',
    description: 'Support level confirmed for BUY',
    evaluate: (ctx) => {
      if (ctx.rawSignal.action !== 'BUY') {
        return pass('support_confirmation', 'Support Confirmation', 'Not a BUY signal');
      }
      return ctx.rawSignal.analysis['support'] != null
        ? pass('support_confirmation', 'Support Confirmation', 'Support identified')
        : fail('support_confirmation', 'Support Confirmation', 'No support level');
    },
  },
  {
    id: 'resistance_confirmation',
    name: 'Resistance Confirmation',
    category: 'Structure',
    description: 'Resistance level confirmed for SELL',
    evaluate: (ctx) => {
      if (ctx.rawSignal.action !== 'SELL') {
        return pass('resistance_confirmation', 'Resistance Confirmation', 'Not a SELL signal');
      }
      return ctx.rawSignal.analysis['resistance'] != null
        ? pass('resistance_confirmation', 'Resistance Confirmation', 'Resistance identified')
        : fail('resistance_confirmation', 'Resistance Confirmation', 'No resistance level');
    },
  },
  {
    id: 'strong_candle',
    name: 'Strong Candle Filter',
    category: 'Entry',
    description: 'Candle body strength above 50% of range',
    evaluate: (ctx) => {
      const c = ctx.strategyContext.candle5m;
      const range = candleRange(c);
      if (range <= 0) {
        return fail('strong_candle', 'Strong Candle Filter', 'Zero range candle');
      }
      const strength = bodySize(c) / range;
      return strength >= 0.5
        ? pass('strong_candle', 'Strong Candle Filter', `Body ${(strength * 100).toFixed(0)}% of range`)
        : fail('strong_candle', 'Strong Candle Filter', 'Weak candle body');
    },
  },
  {
    id: 'pullback_filter',
    name: 'Pullback Filter',
    category: 'Structure',
    description: 'Pullback detected before entry',
    evaluate: (ctx) => {
      const passed = ctx.rawSignal.analysis['pullback'] === 'YES' || ctx.rawSignal.analysis['pullbackDetected'] === true;
      return passed ? pass('pullback_filter', 'Pullback Filter', 'Pullback confirmed') : fail('pullback_filter', 'Pullback Filter', 'No pullback');
    },
  },
  {
    id: 'sideways_filter',
    name: 'Sideways Filter',
    category: 'Filter',
    description: 'Market not sideways',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      const momentum = calculateMomentumScore(candles);
      const sideways = evaluateSidewaysMarketFilter(candles, momentum?.winningScore ?? 0);
      return sideways.decision === 'ALLOW_TRADE'
        ? pass('sideways_filter', 'Sideways Filter', `Sideways score ${sideways.sidewaysScore}/6`)
        : fail('sideways_filter', 'Sideways Filter', sideways.reason);
    },
  },
  {
    id: 'one_trade_per_day',
    name: 'Maximum One Trade Per Day',
    category: 'Filter',
    description: 'Only one trade allowed per calendar day',
    evaluate: (ctx) =>
      ctx.tradedToday
        ? fail('one_trade_per_day', 'Maximum One Trade Per Day', 'Already traded today')
        : pass('one_trade_per_day', 'Maximum One Trade Per Day', 'Daily limit clear'),
  },
  {
    id: 'opening_range',
    name: 'Opening Range Filter',
    category: 'Time',
    description: 'Block first 5m candle of session (09:15)',
    evaluate: (ctx) => {
      const time = extractTime(ctx.strategyContext.candle5m.date);
      return time === '09:15'
        ? fail('opening_range', 'Opening Range Filter', 'Opening range — wait for 09:20 close')
        : pass('opening_range', 'Opening Range Filter', 'Opening range complete');
    },
  },
  {
    id: 'time_filter',
    name: 'Time Filter',
    category: 'Time',
    description: 'Trade only during regular session 09:20–15:25',
    evaluate: (ctx) => {
      const time = extractTime(ctx.strategyContext.candle5m.date);
      const ok = time >= '09:20' && time <= '15:25';
      return ok ? pass('time_filter', 'Time Filter', `Time ${time} in session`) : fail('time_filter', 'Time Filter', `Time ${time} outside session`);
    },
  },
  {
    id: 'risk_reward',
    name: 'Risk Reward Filter',
    category: 'Risk',
    description: 'Minimum 1:2 risk reward',
    evaluate: (ctx) =>
      ctx.rawSignal.riskRewardRatio >= 2
        ? pass('risk_reward', 'Risk Reward Filter', `RR ${ctx.rawSignal.riskRewardRatio.toFixed(2)}`)
        : fail('risk_reward', 'Risk Reward Filter', `RR ${ctx.rawSignal.riskRewardRatio.toFixed(2)} below 2`),
  },
  {
    id: 'candle_body',
    name: 'Candle Body Filter',
    category: 'Entry',
    description: 'Body larger than previous candle',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      if (candles.length < 2) {
        return fail('candle_body', 'Candle Body Filter', 'Insufficient candles');
      }
      const cur = candles[candles.length - 1]!;
      const prev = candles[candles.length - 2]!;
      return bodySize(cur) > bodySize(prev)
        ? pass('candle_body', 'Candle Body Filter', 'Body expanded')
        : fail('candle_body', 'Candle Body Filter', 'Body not larger than previous');
    },
  },
  {
    id: 'swing_hl',
    name: 'Swing High/Low Filter',
    category: 'Structure',
    description: 'Valid swing structure on 5m',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      const ok = detectSwingHighs(candles).length >= 2 && detectSwingLows(candles).length >= 2;
      return ok ? pass('swing_hl', 'Swing High/Low Filter', 'Swings identified') : fail('swing_hl', 'Swing High/Low Filter', 'Insufficient swings');
    },
  },
  {
    id: 'hh_hl',
    name: 'Higher High/Higher Low Filter',
    category: 'Structure',
    description: 'HH+HL structure for bullish bias',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      if (ctx.rawSignal.action !== 'BUY') {
        return pass('hh_hl', 'Higher High/Higher Low Filter', 'Not required for SELL');
      }
      return last3HigherHighHigherLow(candles)
        ? pass('hh_hl', 'Higher High/Higher Low Filter', 'HH+HL confirmed')
        : fail('hh_hl', 'Higher High/Higher Low Filter', 'No HH+HL');
    },
  },
  {
    id: 'lh_ll',
    name: 'Lower High/Lower Low Filter',
    category: 'Structure',
    description: 'LH+LL structure for bearish bias',
    evaluate: (ctx) => {
      const candles = [...ctx.strategyContext.previous5m, ctx.strategyContext.candle5m];
      if (ctx.rawSignal.action !== 'SELL') {
        return pass('lh_ll', 'Lower High/Lower Low Filter', 'Not required for BUY');
      }
      return last3LowerHighLowerLow(candles)
        ? pass('lh_ll', 'Lower High/Lower Low Filter', 'LH+LL confirmed')
        : fail('lh_ll', 'Lower High/Lower Low Filter', 'No LH+LL');
    },
  },
  {
    id: 'confirmation_candle',
    name: 'Confirmation Candle Filter',
    category: 'Entry',
    description: 'Raw signal includes valid confirmation',
    evaluate: (ctx) => {
      if (ctx.rawSignal.action === 'NO_TRADE') {
        return fail('confirmation_candle', 'Confirmation Candle Filter', 'No trade signal from base strategy');
      }
      return pass('confirmation_candle', 'Confirmation Candle Filter', 'Base strategy produced signal');
    },
  },
];

export function getRuleById(id: string): RuleDefinition | undefined {
  return RULE_CATALOG.find((r) => r.id === id);
}

export function evaluateAllRules(ctx: RuleContext): RuleEvaluation[] {
  return RULE_CATALOG.map((rule) => rule.evaluate(ctx));
}

export function evaluateRuleSubset(ctx: RuleContext, ruleIds: string[]): RuleGateResult {
  const evaluations: RuleEvaluation[] = [];
  const blockingRules: string[] = [];
  const blockingReasons: string[] = [];

  for (const id of ruleIds) {
    const rule = getRuleById(id);
    if (!rule) {
      continue;
    }
    const result = rule.evaluate(ctx);
    evaluations.push(result);
    if (!result.passed) {
      blockingRules.push(id);
      blockingReasons.push(`${rule.name}: ${result.reason}`);
    }
  }

  return {
    allowed: blockingRules.length === 0,
    evaluations,
    blockingRules,
    blockingReasons,
  };
}
