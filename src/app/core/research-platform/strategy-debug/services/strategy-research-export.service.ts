import { Injectable } from '@angular/core';
import {
  DailyDebugSummary,
  StrategyResearchDebugRun,
} from '../models/strategy-research-debug.model';

@Injectable({ providedIn: 'root' })
export class StrategyResearchExportService {
  exportJson(run: StrategyResearchDebugRun, filename: string): void {
    this.downloadBlob(JSON.stringify(run, null, 2), filename, 'application/json');
  }

  exportDailyCsv(run: StrategyResearchDebugRun, filename: string): void {
    const headers = [
      'Date',
      'Strategy',
      'Trend',
      'Structure',
      'Pullback',
      'Breakout',
      'Retest',
      'Confirmation',
      'Entry',
      'Final Decision',
      'Reason',
      'Waiting State',
    ];
    const rows = run.dailySummaries.map((d) => this.dailyRow(d));
    this.downloadBlob(this.toCsv([headers, ...rows]), filename, 'text/csv');
  }

  exportRuleStatisticsCsv(run: StrategyResearchDebugRun, filename: string): void {
    const headers = ['Strategy', 'Module', 'Passed', 'Failed', 'Pass Rate %'];
    const rows: string[][] = [];
    for (const s of run.strategySummaries) {
      const st = s.statistics;
      const modules = [
        ['Trend', st.trendPassed, st.trendFailed],
        ['Structure', st.structurePassed, st.structureFailed],
        ['Pullback', st.pullbackPassed, st.pullbackFailed],
        ['Breakout', st.breakoutPassed, st.breakoutFailed],
        ['Retest', st.retestPassed, st.retestFailed],
        ['Confirmation', st.confirmationPassed, st.confirmationFailed],
        ['Entry', st.entryPassed, st.entryFailed],
      ] as const;
      for (const [name, passed, failed] of modules) {
        const total = passed + failed;
        rows.push([
          s.strategyName,
          name,
          String(passed),
          String(failed),
          total ? ((passed / total) * 100).toFixed(1) : '0',
        ]);
      }
    }
    this.downloadBlob(this.toCsv([headers, ...rows]), filename, 'text/csv');
  }

  exportBottleneckCsv(run: StrategyResearchDebugRun, filename: string): void {
    const headers = ['Rank', 'Strategy', 'Rule', 'Rejections', 'Rejection %'];
    const rows: string[][] = [];
    for (const s of run.strategySummaries) {
      for (const b of s.bottlenecks) {
        rows.push([
          String(b.rank),
          s.strategyName,
          b.ruleName,
          String(b.rejectionCount),
          String(b.rejectionPercent),
        ]);
      }
    }
    this.downloadBlob(this.toCsv([headers, ...rows]), filename, 'text/csv');
  }

  exportTradesCsv(run: StrategyResearchDebugRun, filename: string): void {
    const headers = [
      'Strategy',
      'Entry Time',
      'Exit Time',
      'Direction',
      'Entry',
      'Exit',
      'Stop Loss',
      'Target',
      'Points',
      'Outcome',
      'Holding Minutes',
    ];
    const rows: string[][] = [];
    for (const s of run.strategySummaries) {
      for (const t of s.trades) {
        rows.push([
          s.strategyName,
          t.entryTime,
          t.exitTime,
          t.direction,
          String(t.entryPrice),
          String(t.exitPrice),
          String(t.stopLoss),
          String(t.targetPrice),
          String(t.points),
          t.outcome,
          String(t.holdingMinutes),
        ]);
      }
    }
    this.downloadBlob(this.toCsv([headers, ...rows]), filename, 'text/csv');
  }

  /** Excel-compatible export (UTF-8 CSV with BOM). */
  exportExcelCsv(content: string, filename: string): void {
    const bom = '\uFEFF';
    this.downloadBlob(bom + content, filename, 'text/csv;charset=utf-8');
  }

  exportComparisonExcel(run: StrategyResearchDebugRun, filename: string): void {
    const headers = [
      'Strategy',
      'Total Trades',
      'Wins',
      'Losses',
      'Win Rate %',
      'Gross Profit',
      'Gross Loss',
      'Net Profit',
      'Profit Factor',
      'Max Drawdown',
      'Avg Win',
      'Avg Loss',
      'Avg Holding Min',
    ];
    const rows = run.strategySummaries.map((s) => {
      const p = s.performance;
      return [
        s.strategyName,
        String(p.totalTrades),
        String(p.winningTrades),
        String(p.losingTrades),
        p.winRate.toFixed(1),
        p.grossProfit.toFixed(2),
        p.grossLoss.toFixed(2),
        p.netProfit.toFixed(2),
        p.profitFactor === Infinity ? '∞' : p.profitFactor.toFixed(2),
        p.maxDrawdown.toFixed(2),
        p.averageWin.toFixed(2),
        p.averageLoss.toFixed(2),
        p.averageHoldingMinutes.toFixed(0),
      ];
    });
    this.exportExcelCsv(this.toCsv([headers, ...rows]), filename);
  }

  exportPdf(run: StrategyResearchDebugRun): void {
    const html = this.buildPrintHtml(run);
    const win = window.open('', '_blank');
    if (!win) {
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  private dailyRow(d: DailyDebugSummary): string[] {
    return [
      d.displayDate,
      d.strategyName,
      d.trend,
      d.structure,
      d.pullback,
      d.breakout,
      d.retest,
      d.confirmation,
      d.entry,
      d.finalDecision,
      d.reason,
      d.waitingState,
    ];
  }

  private toCsv(rows: string[][]): string {
    return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  private downloadBlob(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private buildPrintHtml(run: StrategyResearchDebugRun): string {
    const comparisonRows = run.strategySummaries
      .map(
        (s) => `<tr>
          <td>${s.strategyName}</td>
          <td>${s.performance.totalTrades}</td>
          <td>${s.performance.winRate.toFixed(1)}%</td>
          <td>${s.performance.netProfit.toFixed(2)}</td>
        </tr>`,
      )
      .join('');

    const dailyRows = run.dailySummaries
      .slice(0, 100)
      .map(
        (d) => `<tr>
          <td>${d.displayDate}</td>
          <td>${d.strategyName}</td>
          <td>${d.trend}</td>
          <td>${d.structure}</td>
          <td>${d.finalDecision}</td>
          <td>${d.reason}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html><html><head><title>Strategy Research Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
        th { background: #f0f0f0; }
        h1, h2 { color: #333; }
      </style></head><body>
      <h1>Strategy Research Debug Report</h1>
      <p>${run.instrumentSymbol} · ${run.fromDateTime} → ${run.toDateTime}</p>
      <h2>Strategy Comparison</h2>
      <table><thead><tr><th>Strategy</th><th>Trades</th><th>Win Rate</th><th>Net Profit</th></tr></thead>
      <tbody>${comparisonRows}</tbody></table>
      <h2>Daily Debug (first 100 rows)</h2>
      <table><thead><tr><th>Date</th><th>Strategy</th><th>Trend</th><th>Structure</th><th>Decision</th><th>Reason</th></tr></thead>
      <tbody>${dailyRows}</tbody></table>
      </body></html>`;
  }
}
