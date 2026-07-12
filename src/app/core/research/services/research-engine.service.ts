import { Injectable, inject } from '@angular/core';
import { ResearchOptimizationEngineService } from '../../research-platform/optimization/services/research-optimization-engine.service';
import { StrategyResearchDebugEngineService } from '../../research-platform/strategy-debug/services/strategy-research-debug-engine.service';
import { RuleCombinationAnalysisService } from '../../research-platform/optimization/services/rule-combination-analysis.service';
import { StrategyResearchReportService } from '../../research-platform/strategy-debug/services/strategy-research-report.service';

/**
 * Research Engine facade — independent from strategy implementations and backtesting internals.
 * UI and future optimization features consume research capabilities through this service.
 */
@Injectable({ providedIn: 'root' })
export class ResearchEngineService {
  readonly optimization = inject(ResearchOptimizationEngineService);
  readonly strategyDebug = inject(StrategyResearchDebugEngineService);
  readonly ruleAnalysis = inject(RuleCombinationAnalysisService);
  readonly debugReports = inject(StrategyResearchReportService);
}
