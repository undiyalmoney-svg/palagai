import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { RESEARCH_STRATEGY_IDS } from '../../../core/research-platform/interfaces/research-strategy.interface';
import {
  ResearchBaseStrategyId,
  RuleCombinationStats,
  SignalDecisionRecord,
} from '../../../core/research-platform/optimization/models/research-optimization.model';
import { ResearchOptimizationEngineService } from '../../../core/research-platform/optimization/services/research-optimization-engine.service';
import { RuleRegistryService } from '../../../core/research-platform/optimization/services/rule-registry.service';
import { ResearchRunStoreService } from '../../../core/research-platform/optimization/services/research-run-store.service';
import { NIFTY_50_INSTRUMENT } from '../../../core/constants/instruments.const';
import { generateRuleCombinations } from '../../../core/research-platform/optimization/utils/rule-combination-generator.util';

const STRATEGY_OPTIONS: { id: ResearchBaseStrategyId; label: string }[] = [
  { id: RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT, label: 'Trendline Breakout + Retest' },
  { id: RESEARCH_STRATEGY_IDS.MTF_PULLBACK, label: 'Multi Timeframe Pullback' },
  { id: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT, label: '1 Hour Breakout' },
];

@Component({
  selector: 'app-research-dashboard',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
  ],
  templateUrl: './research-dashboard.component.html',
  styleUrl: './research-dashboard.component.css',
})
export class ResearchDashboardComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly engine = inject(ResearchOptimizationEngineService);
  protected readonly ruleRegistry = inject(RuleRegistryService);
  private readonly runStore = inject(ResearchRunStoreService);

  ngOnInit(): void {
    const saved = this.runStore.runs()[0];
    if (saved && !this.lastRun()) {
      this.engine.lastRun.set(saved);
    }
  }

  protected readonly strategyOptions = STRATEGY_OPTIONS;
  protected readonly tabLabels = [
    'Strategy Selection',
    'Rule Selection',
    'Backtest Results',
    'Trade History',
    'Rule Combination Analysis',
    'Winning Rule Analysis',
    'Losing Rule Analysis',
    'Overall Strategy Comparison',
  ];
  protected readonly selectedTab = signal(0);
  protected readonly selectedCombinationId = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    fromDate: ['2025-01-01', Validators.required],
    fromTime: ['09:15', Validators.required],
    toDate: ['2025-01-31', Validators.required],
    toTime: ['15:30', Validators.required],
    baseStrategyId: [RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT as ResearchBaseStrategyId],
  });

  protected readonly isRunning = this.engine.isRunning;
  protected readonly progress = this.engine.progress;
  protected readonly lastRun = this.engine.lastRun;
  protected readonly lastSignalDebug = this.engine.lastSignalDebug;

  protected readonly selectedRules = this.ruleRegistry.selectedRuleIds;
  protected readonly combinationPreviewCount = computed(() =>
    generateRuleCombinations(this.selectedRules()).length,
  );

  protected readonly sortedResults = computed(() => {
    const run = this.lastRun();
    if (!run) {
      return [];
    }
    return [...run.combinationResults].sort((a, b) => a.rank - b.rank);
  });

  protected readonly selectedCombination = computed((): RuleCombinationStats | null => {
    const run = this.lastRun();
    const id = this.selectedCombinationId();
    if (!run || !id) {
      return run?.combinationResults[0] ?? null;
    }
    return run.combinationResults.find((c) => c.combinationId === id) ?? null;
  });

  protected readonly comparisonColumns = [
    'rank',
    'rules',
    'totalTrades',
    'winRate',
    'netProfit',
    'profitFactor',
    'maxDrawdown',
    'avgHolding',
  ];

  protected readonly tradeColumns = [
    'entryTime',
    'direction',
    'entryPrice',
    'exitPrice',
    'points',
    'outcome',
    'holdingMinutes',
  ];

  protected readonly ruleDebugColumns = ['ruleName', 'status', 'reason'];

  protected isRuleSelected(ruleId: string): boolean {
    return this.selectedRules().includes(ruleId);
  }

  protected toggleRule(ruleId: string, checked: boolean): void {
    this.ruleRegistry.toggleRule(ruleId, checked);
  }

  protected selectAllRules(): void {
    this.ruleRegistry.setSelectedRules(this.ruleRegistry.allRules.map((r) => r.id));
  }

  protected clearAllRules(): void {
    this.ruleRegistry.setSelectedRules([]);
  }

  protected selectCombination(combo: RuleCombinationStats): void {
    this.selectedCombinationId.set(combo.combinationId);
    this.selectedTab.set(3);
  }

  protected async runOptimization(): Promise<void> {
    if (this.form.invalid || this.isRunning()) {
      return;
    }
    const v = this.form.getRawValue();
    const fromDateTime = `${v.fromDate} ${v.fromTime}:00`;
    const toDateTime = `${v.toDate} ${v.toTime}:00`;

    try {
      await this.engine.runOptimization({
        instrumentToken: NIFTY_50_INSTRUMENT.instrumentToken,
        instrumentSymbol: NIFTY_50_INSTRUMENT.tradingSymbol,
        fromDateTime,
        toDateTime,
        baseStrategyId: v.baseStrategyId,
      });
      this.selectedCombinationId.set(null);
      this.selectedTab.set(2);
    } catch (err) {
      console.error(err);
    }
  }

  protected ruleEvaluationsForSignal(signal: SignalDecisionRecord | null) {
    return signal?.evaluations ?? [];
  }

  protected dailySummary(trades: RuleCombinationStats['trades']) {
    const map = new Map<string, { trades: number; wins: number; pnl: number }>();
    for (const t of trades) {
      const day = t.entryTime.slice(0, 10);
      const row = map.get(day) ?? { trades: 0, wins: 0, pnl: 0 };
      row.trades += 1;
      if (t.outcome === 'WIN') {
        row.wins += 1;
      }
      row.pnl += t.points;
      map.set(day, row);
    }
    return [...map.entries()].map(([date, stats]) => ({ date, ...stats }));
  }

  protected monthlySummary(trades: RuleCombinationStats['trades']) {
    const map = new Map<string, { trades: number; wins: number; pnl: number }>();
    for (const t of trades) {
      const month = t.entryTime.slice(0, 7);
      const row = map.get(month) ?? { trades: 0, wins: 0, pnl: 0 };
      row.trades += 1;
      if (t.outcome === 'WIN') {
        row.wins += 1;
      }
      row.pnl += t.points;
      map.set(month, row);
    }
    return [...map.entries()].map(([month, stats]) => ({ month, ...stats }));
  }
}
