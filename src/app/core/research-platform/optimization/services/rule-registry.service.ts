import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RULE_CATALOG, getRuleById } from '../rules/rule-catalog';

const STORAGE_KEY = 'palagai_research_rule_selection';

@Injectable({ providedIn: 'root' })
export class RuleRegistryService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly allRules = RULE_CATALOG;

  /** User-selected rules for combination experiments */
  readonly selectedRuleIds = signal<string[]>(this.loadSelection());

  toggleRule(ruleId: string, enabled: boolean): void {
    const current = new Set(this.selectedRuleIds());
    if (enabled) {
      current.add(ruleId);
    } else {
      current.delete(ruleId);
    }
    const next = [...current];
    this.selectedRuleIds.set(next);
    this.persistSelection(next);
  }

  setSelectedRules(ruleIds: string[]): void {
    this.selectedRuleIds.set([...ruleIds]);
    this.persistSelection(ruleIds);
  }

  getRuleName(ruleId: string): string {
    return getRuleById(ruleId)?.name ?? ruleId;
  }

  private loadSelection(): string[] {
    if (!isPlatformBrowser(this.platformId)) {
      return RULE_CATALOG.map((r) => r.id);
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as string[];
      }
    } catch {
      // defaults
    }
    return ['trend_60m', 'trend_30m', 'confirmation_5m', 'risk_reward', 'one_trade_per_day'];
  }

  private persistSelection(ids: string[]): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }
}
