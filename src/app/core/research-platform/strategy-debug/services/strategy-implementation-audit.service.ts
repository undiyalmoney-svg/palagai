import { Injectable } from '@angular/core';
import {
  CandleDebugRecord,
  ImplementationAuditIssue,
  ResearchStrategyId,
  STRATEGY_DEBUG_META,
} from '../models/strategy-research-debug.model';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';

interface RuleTracker {
  rule: string;
  passCount: number;
  check: (r: CandleDebugRecord) => boolean;
}

@Injectable({ providedIn: 'root' })
export class StrategyImplementationAuditService {
  audit(candleRecords: CandleDebugRecord[]): ImplementationAuditIssue[] {
    const issues: ImplementationAuditIssue[] = [];

    issues.push(...this.auditStrategy2(candleRecords));
    issues.push(...this.auditStrategy3(candleRecords));

    return issues.sort((a, b) => {
      if (a.neverTrueInBacktest !== b.neverTrueInBacktest) {
        return a.neverTrueInBacktest ? -1 : 1;
      }
      return a.passCount - b.passCount;
    });
  }

  private auditStrategy2(records: CandleDebugRecord[]): ImplementationAuditIssue[] {
    const s2 = records.filter((r) => r.strategyId === RESEARCH_STRATEGY_IDS.MTF_PULLBACK);
    if (!s2.length) {
      return [];
    }

    const issues: ImplementationAuditIssue[] = [];
    const meta = STRATEGY_DEBUG_META[RESEARCH_STRATEGY_IDS.MTF_PULLBACK];

    const rules: RuleTracker[] = [
      { rule: '60m Trend (not Sideways)', passCount: 0, check: (r) => r.trend.detectedTrend !== 'Sideways' },
      { rule: '30m Support/Resistance', passCount: 0, check: (r) => r.structure.passed },
      { rule: '15m Pullback', passCount: 0, check: (r) => r.pullback.passed },
      { rule: '5m Confirmation', passCount: 0, check: (r) => r.confirmation.passed },
      { rule: 'Risk Reward >= 2', passCount: 0, check: (r) => r.entry.passed },
      { rule: 'BUY/SELL Signal', passCount: 0, check: (r) => r.finalDecision === 'BUY' || r.finalDecision === 'SELL' },
    ];

    for (const r of s2) {
      for (const rule of rules) {
        if (rule.check(r)) {
          rule.passCount += 1;
        }
      }
    }

    for (const rule of rules) {
      if (rule.passCount === 0) {
        issues.push(this.issue(meta.name, RESEARCH_STRATEGY_IDS.MTF_PULLBACK, rule.rule, s2.length, rule.passCount, true));
      } else if (rule.rule === '15m Pullback' && rule.passCount < s2.length * 0.01) {
        issues.push(this.issue(meta.name, RESEARCH_STRATEGY_IDS.MTF_PULLBACK, rule.rule, s2.length, rule.passCount, true));
      }
    }

    const mismatches = s2.filter((r) => r.strategy2Audit && !r.strategy2Audit.debugMatchesEvaluator);
    if (mismatches.length) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
        strategyName: meta.name,
        rule: 'Debug/Evaluator Alignment',
        severity: 'warning',
        message: `${mismatches.length} candle(s) where debug inference differs from evaluator — review strategy2Audit.mismatchNote`,
        neverTrueInBacktest: false,
        passCount: s2.length - mismatches.length,
        totalCandles: s2.length,
      });
    }

    const sidewaysOnly = s2.every((r) => r.trend.detectedTrend === 'Sideways');
    if (sidewaysOnly) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
        strategyName: meta.name,
        rule: '60m Trend',
        severity: 'warning',
        message: '60m trend was Sideways on EVERY candle — bullish/bearish path never activated. Possible data range or swing detection issue.',
        neverTrueInBacktest: true,
        passCount: 0,
        totalCandles: s2.length,
      });
    }

    return issues;
  }

  private auditStrategy3(records: CandleDebugRecord[]): ImplementationAuditIssue[] {
    const s3 = records.filter((r) => r.strategyId === RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT);
    if (!s3.length) {
      return [];
    }

    const issues: ImplementationAuditIssue[] = [];
    const meta = STRATEGY_DEBUG_META[RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT];

    const hourVerified = s3.filter((r) => r.strategy3Audit?.usesCompletedHourVerified).length;
    if (hourVerified < s3.length) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
        strategyName: meta.name,
        rule: 'Previous Completed 1H Candle',
        severity: 'warning',
        message: `${s3.length - hourVerified} candle(s) failed verification that previousCompletedHourBar uses candles60[length-2], not the forming candle`,
        neverTrueInBacktest: hourVerified === 0,
        passCount: hourVerified,
        totalCandles: s3.length,
      });
    }

    const rules: RuleTracker[] = [
      {
        rule: 'Bullish Breakout Close Condition',
        passCount: 0,
        check: (r) => r.strategy3Audit?.bullishBreakoutCloseCondition === true,
      },
      {
        rule: 'Bearish Breakout Close Condition',
        passCount: 0,
        check: (r) => r.strategy3Audit?.bearishBreakoutCloseCondition === true,
      },
      {
        rule: 'Breakout Candle Stored',
        passCount: 0,
        check: (r) => r.strategy3Audit?.storedBreakoutCandle !== null,
      },
      {
        rule: 'Follow-Through Entry Trigger',
        passCount: 0,
        check: (r) => r.strategy3Audit?.evaluatorPhase === 'entry_buy' || r.strategy3Audit?.evaluatorPhase === 'entry_sell',
      },
      {
        rule: 'BUY/SELL Signal',
        passCount: 0,
        check: (r) => r.finalDecision === 'BUY' || r.finalDecision === 'SELL',
      },
    ];

    for (const r of s3) {
      for (const rule of rules) {
        if (rule.check(r)) {
          rule.passCount += 1;
        }
      }
    }

    for (const rule of rules) {
      if (rule.passCount === 0) {
        issues.push(this.issue(meta.name, RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT, rule.rule, s3.length, rule.passCount, true));
      }
    }

    const breakoutNeverStored = rules.find((r) => r.rule === 'Breakout Candle Stored')?.passCount === 0;
    const closeBreakoutNever = rules.find((r) => r.rule === 'Bullish Breakout Close Condition')?.passCount === 0 &&
      rules.find((r) => r.rule === 'Bearish Breakout Close Condition')?.passCount === 0;

    if (closeBreakoutNever && breakoutNeverStored) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
        strategyName: meta.name,
        rule: 'Breakout Pipeline',
        severity: 'warning',
        message:
          'Neither bullish nor bearish close-cross breakout occurred in entire backtest. 5m close never crossed previous completed 1H high/low with required prev5.close condition. Review 1H levels vs 5m data alignment.',
        neverTrueInBacktest: true,
        passCount: 0,
        totalCandles: s3.length,
      });
    } else if (breakoutNeverStored && !closeBreakoutNever) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
        strategyName: meta.name,
        rule: 'Breakout Candle Stored',
        severity: 'warning',
        message:
          'Close-cross breakout occurred but breakout candle was NEVER stored in state — potential state machine issue in hour-breakout evaluator.',
        neverTrueInBacktest: true,
        passCount: 0,
        totalCandles: s3.length,
      });
    }

    const storedButNoEntry =
      (rules.find((r) => r.rule === 'Breakout Candle Stored')?.passCount ?? 0) > 0 &&
      (rules.find((r) => r.rule === 'Follow-Through Entry Trigger')?.passCount ?? 0) === 0;

    if (storedButNoEntry) {
      issues.push({
        strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
        strategyName: meta.name,
        rule: 'Follow-Through Entry Trigger',
        severity: 'warning',
        message:
          'Breakout candles were stored but follow-through entry trigger NEVER fired. 5m high/low may not exceed stored breakout candle on subsequent bars.',
        neverTrueInBacktest: true,
        passCount: 0,
        totalCandles: s3.length,
      });
    }

    return issues;
  }

  private issue(
    strategyName: string,
    strategyId: ResearchStrategyId,
    rule: string,
    total: number,
    passCount: number,
    neverTrue: boolean,
  ): ImplementationAuditIssue {
    return {
      strategyId,
      strategyName,
      rule,
      severity: 'warning',
      message: neverTrue
        ? `⚠ IMPLEMENTATION CHECK: "${rule}" was NEVER true during backtest (${total} candles). This may indicate an implementation or data alignment issue, not merely unfavourable market conditions.`
        : `"${rule}" rarely true (${passCount}/${total} candles).`,
      neverTrueInBacktest: neverTrue,
      passCount,
      totalCandles: total,
    };
  }
}
