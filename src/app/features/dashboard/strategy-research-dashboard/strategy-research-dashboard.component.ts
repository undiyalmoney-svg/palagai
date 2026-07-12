import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { RESEARCH_STRATEGY_IDS } from '../../../core/research-platform/interfaces/research-strategy.interface';
import {
  CandleDebugRecord,
  DailyDebugSummary,
  StrategyResearchDebugRun,
} from '../../../core/research-platform/strategy-debug/models/strategy-research-debug.model';
import { StrategyResearchDebugEngineService } from '../../../core/research-platform/strategy-debug/services/strategy-research-debug-engine.service';
import { StrategyResearchDebugStoreService } from '../../../core/research-platform/strategy-debug/services/strategy-research-debug-store.service';
import { StrategyResearchExportService } from '../../../core/research-platform/strategy-debug/services/strategy-research-export.service';
import { NIFTY_50_INSTRUMENT } from '../../../core/constants/instruments.const';

@Component({
  selector: 'app-strategy-research-dashboard',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    NgTemplateOutlet,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './strategy-research-dashboard.component.html',
  styleUrl: './strategy-research-dashboard.component.css',
})
export class StrategyResearchDashboardComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly engine = inject(StrategyResearchDebugEngineService);
  private readonly store = inject(StrategyResearchDebugStoreService);
  private readonly exportService = inject(StrategyResearchExportService);

  protected readonly strategy1Id = RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT;
  protected readonly strategy2Id = RESEARCH_STRATEGY_IDS.MTF_PULLBACK;
  protected readonly strategy3Id = RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT;

  protected readonly selectedTab = signal(0);
  protected readonly tabLabels = [
    'Overview',
    'Strategy 1',
    'Strategy 2',
    'Strategy 3',
    'Daily Debug',
    'Trade History',
    'Rule Statistics',
    'Rule Bottleneck',
    'Strategy Comparison',
  ];
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly selectedStrategyFilter = signal<string>('all');

  protected readonly form = this.formBuilder.nonNullable.group({
    fromDate: ['2025-06-24', Validators.required],
    fromTime: ['09:15', Validators.required],
    toDate: ['2025-07-03', Validators.required],
    toTime: ['15:30', Validators.required],
  });

  protected readonly isRunning = this.engine.isRunning;
  protected readonly progress = this.engine.progress;
  protected readonly lastRun = this.engine.lastRun;

  protected readonly dailyColumns = [
    'date', 'strategy', 'trend', 'structure', 'pullback', 'breakout', 'retest',
    'confirmation', 'entry', 'decision', 'reason',
  ];

  protected readonly comparisonColumns = [
    'strategy', 'trades', 'wins', 'losses', 'winRate', 'netProfit', 'profitFactor', 'maxDrawdown',
  ];

  protected readonly filteredDaily = computed(() => {
    const run = this.lastRun();
    if (!run) return [];
    const filter = this.selectedStrategyFilter();
    return run.dailySummaries.filter((d) => filter === 'all' || d.strategyId === filter);
  });

  protected readonly strategy1Summary = computed(() =>
    this.lastRun()?.strategySummaries.find((s) => s.strategyId === this.strategy1Id),
  );
  protected readonly strategy2Summary = computed(() =>
    this.lastRun()?.strategySummaries.find((s) => s.strategyId === this.strategy2Id),
  );
  protected readonly strategy3Summary = computed(() =>
    this.lastRun()?.strategySummaries.find((s) => s.strategyId === this.strategy3Id),
  );

  protected readonly dayCandleRecords = computed((): CandleDebugRecord[] => {
    const run = this.lastRun();
    const day = this.selectedDay();
    if (!run || !day) return [];
    return run.candleRecords.filter((r) => r.tradingDate === day);
  });

  ngOnInit(): void {
    const saved = this.store.runs()[0];
    if (saved && !this.lastRun()) {
      this.engine.lastRun.set(saved);
    }
  }

  protected async runAnalysis(): Promise<void> {
    if (this.form.invalid || this.isRunning()) return;
    const v = this.form.getRawValue();
    try {
      await this.engine.runDebugAnalysis({
        instrumentToken: NIFTY_50_INSTRUMENT.instrumentToken,
        instrumentSymbol: NIFTY_50_INSTRUMENT.tradingSymbol,
        fromDateTime: `${v.fromDate} ${v.fromTime}:00`,
        toDateTime: `${v.toDate} ${v.toTime}:00`,
      });
      this.selectedTab.set(0);
    } catch (err) {
      console.error(err);
    }
  }

  protected selectDay(date: string): void {
    this.selectedDay.set(date);
    this.selectedTab.set(4);
  }

  protected formatVal(value: number | null | undefined): string {
    return value === null || value === undefined ? '--' : value.toFixed(2);
  }

  protected passFail(passed: boolean): string {
    return passed ? 'PASS' : 'FAIL';
  }

  protected exportJson(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportJson(run, `strategy-research-${run.id}.json`);
  }

  protected exportDailyCsv(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportDailyCsv(run, `daily-debug-${run.id}.csv`);
  }

  protected exportStatsCsv(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportRuleStatisticsCsv(run, `rule-stats-${run.id}.csv`);
  }

  protected exportBottleneckCsv(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportBottleneckCsv(run, `bottleneck-${run.id}.csv`);
  }

  protected exportTradesCsv(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportTradesCsv(run, `trades-${run.id}.csv`);
  }

  protected exportComparisonExcel(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportComparisonExcel(run, `comparison-${run.id}.csv`);
  }

  protected exportPdf(): void {
    const run = this.lastRun();
    if (run) this.exportService.exportPdf(run);
  }

  protected recordsForStrategy(strategyId: string): CandleDebugRecord[] {
    return this.dayCandleRecords().filter((r) => r.strategyId === strategyId);
  }
}
