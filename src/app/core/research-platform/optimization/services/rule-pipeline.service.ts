import { Injectable } from '@angular/core';
import { RuleContext, RuleGateResult } from '../models/research-optimization.model';
import { evaluateAllRules, evaluateRuleSubset } from '../rules/rule-catalog';

/** Applies rule gates to raw strategy signals without modifying existing strategies. */
@Injectable({ providedIn: 'root' })
export class RulePipelineService {
  evaluateAll(ctx: RuleContext) {
    return evaluateAllRules(ctx);
  }

  evaluateSubset(ctx: RuleContext, ruleIds: string[]): RuleGateResult {
    return evaluateRuleSubset(ctx, ruleIds);
  }

  isTradeAllowed(ctx: RuleContext, ruleIds: string[]): boolean {
    const hasSignal = ctx.rawSignal.action === 'BUY' || ctx.rawSignal.action === 'SELL';
    if (!hasSignal) {
      return false;
    }
    return this.evaluateSubset(ctx, ruleIds).allowed;
  }
}
