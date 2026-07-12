import { Injectable } from '@angular/core';
import {
  RuleCombinationAnalysis,
  RuleCombinationStats,
} from '../models/research-optimization.model';
import { RULE_CATALOG } from '../rules/rule-catalog';

@Injectable({ providedIn: 'root' })
export class RuleCombinationAnalysisService {
  analyze(results: RuleCombinationStats[]): RuleCombinationAnalysis {
    const sorted = [...results].sort((a, b) => b.netProfit - a.netProfit);
    sorted.forEach((r, i) => {
      r.rank = i + 1;
    });

    const topCombinations = sorted.slice(0, 10);
    const winners = sorted.filter((r) => r.netProfit > 0);
    const losers = sorted.filter((r) => r.netProfit <= 0);

    const winningRuleFrequency = this.frequencyFromCombinations(winners, winners.length || 1);
    const losingRuleFrequency = this.frequencyFromCombinations(losers, losers.length || 1);
    const recommendations = this.buildRecommendations(sorted, results);

    return {
      topCombinations,
      winningRuleFrequency,
      losingRuleFrequency,
      recommendations,
    };
  }

  private frequencyFromCombinations(
    combos: RuleCombinationStats[],
    total: number,
  ): { ruleId: string; ruleName: string; count: number; percentage: number }[] {
    const counts = new Map<string, number>();
    for (const combo of combos) {
      for (const id of combo.ruleIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([ruleId, count]) => ({
        ruleId,
        ruleName: RULE_CATALOG.find((r) => r.id === ruleId)?.name ?? ruleId,
        count,
        percentage: Math.round((count / total) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count);
  }

  private buildRecommendations(
    sorted: RuleCombinationStats[],
    all: RuleCombinationStats[],
  ): string[] {
    const recs: string[] = [];
    if (!sorted.length) {
      return recs;
    }

    const best = sorted[0]!;
    const baseline = all.find((r) => r.ruleIds.length === 0) ?? sorted[sorted.length - 1]!;

    if (best.netProfit > baseline.netProfit && baseline.netProfit !== 0) {
      const pct = Math.round(((best.netProfit - baseline.netProfit) / Math.abs(baseline.netProfit || 1)) * 100);
      recs.push(
        `Best combination (${best.ruleLabels.join(', ')}) improved net profit by ${pct}% vs baseline.`,
      );
    }

    if (best.winRate > baseline.winRate) {
      recs.push(
        `Adding optimal rules improved win rate from ${baseline.winRate.toFixed(1)}% to ${best.winRate.toFixed(1)}%.`,
      );
    }

    for (const rule of RULE_CATALOG.slice(0, 5)) {
      const withRule = all.filter((r) => r.ruleIds.includes(rule.id));
      const withoutRule = all.filter((r) => !r.ruleIds.includes(rule.id));
      if (!withRule.length || !withoutRule.length) {
        continue;
      }
      const avgWith = withRule.reduce((s, r) => s + r.netProfit, 0) / withRule.length;
      const avgWithout = withoutRule.reduce((s, r) => s + r.netProfit, 0) / withoutRule.length;
      if (avgWithout > avgWith && avgWithout > 0) {
        const pct = Math.round(((avgWithout - avgWith) / avgWithout) * 100);
        recs.push(`Removing ${rule.name} increased average profit by ${pct}%.`);
      } else if (avgWith > avgWithout && avgWithout !== 0) {
        const pct = Math.round(((avgWith - avgWithout) / Math.abs(avgWithout || 1)) * 100);
        recs.push(`Adding ${rule.name} improved average profit by ${pct}%.`);
      }
    }

    const sidewaysBlocks = all.reduce((sum, r) => sum + (r.rejectionCounts['sideways_filter'] ?? 0), 0);
    const totalRejections = all.reduce(
      (sum, r) => sum + Object.values(r.rejectionCounts).reduce((a, b) => a + b, 0),
      0,
    );
    if (totalRejections > 0 && sidewaysBlocks / totalRejections > 0.3) {
      recs.push(
        `Sideways Filter blocked ${Math.round((sidewaysBlocks / totalRejections) * 100)}% of rejected signals — consider tightening sideways detection.`,
      );
    }

    return recs.slice(0, 8);
  }
}
