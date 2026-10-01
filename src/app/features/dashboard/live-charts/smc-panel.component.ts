/**
 * Compact SMC dashboard for one market: current read of the chart, the live
 * trade plan, and — kept separate — backtest and live-session statistics.
 */
import { TitleCasePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  SMC_EXIT_LABELS,
  SmcAnalysis,
  SmcStats,
  SmcTrade,
  SmcTrend,
} from '../../../core/charts/smc/smc.types';

interface StatRow {
  label: string;
  backtest: string;
  live: string;
}

@Component({
  selector: 'app-smc-panel',
  standalone: true,
  imports: [TitleCasePipe],
  templateUrl: './smc-panel.component.html',
  styleUrl: './smc-panel.component.css',
})
export class SmcPanelComponent {
  @Input() smc: SmcAnalysis | null = null;
  @Input() decimals = 2;
  @Input() htfLabel = '5m';
  @Input() ltfLabel = '1m';
  /** True while the chart is on today's session rather than a replayed date. */
  @Input() liveDay = true;

  protected readonly exitLabels = SMC_EXIT_LABELS;

  protected trendText(trend: SmcTrend | null | undefined): string {
    if (!trend) return '—';
    return trend === 'sideways' ? 'SIDEWAYS' : trend.toUpperCase();
  }

  protected price(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: this.decimals,
      maximumFractionDigits: this.decimals,
    });
  }

  protected rr(value: number | null | undefined): string {
    return value == null || !Number.isFinite(value) ? '—' : `1 : ${value.toFixed(2)}`;
  }

  protected signedR(value: number | null | undefined): string {
    if (value == null) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
  }

  protected time(date: string | null | undefined): string {
    if (!date) return '—';
    return `${String(date).slice(5, 10)} ${String(date).slice(11, 16)}`;
  }

  protected recentTrades(): SmcTrade[] {
    return (this.smc?.trades ?? []).slice(-8).reverse();
  }

  protected liveNote(): string {
    const split = this.smc?.stats;
    if (!split) return '';
    if (!this.liveDay || split.liveFromTs == null) {
      return 'Replayed date — everything is backtest, nothing is live.';
    }
    return 'Live = trades entered during today’s session. Backtest = everything before it.';
  }

  protected statRows(): StatRow[] {
    const split = this.smc?.stats;
    if (!split) return [];
    const live = split.liveFromTs != null;
    const row = (label: string, pick: (s: SmcStats) => string): StatRow => ({
      label,
      backtest: pick(split.backtest),
      live: live ? pick(split.live) : '—',
    });
    const pct = (v: number | null, d = 2) => (v == null ? '—' : `${v.toFixed(d)}%`);
    const num = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
    return [
      row('Total trades', (s) => String(s.totalTrades)),
      row('Winning trades', (s) => String(s.wins)),
      row('Losing trades', (s) => String(s.losses)),
      row('Win rate', (s) => pct(s.winRate, 1)),
      row('Average risk/reward', (s) => (s.avgPlannedRr == null ? '—' : `1 : ${s.avgPlannedRr.toFixed(2)}`)),
      row('Profit factor', (s) =>
        s.profitFactor == null ? '—' : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞',
      ),
      row('Maximum drawdown', (s) => pct(s.maxDrawdownPct)),
      row('Net return', (s) => pct(s.netReturnPct)),
      row('Average trade', (s) => pct(s.avgTradePct)),
      row('Average result', (s) => (s.avgR == null ? '—' : `${num(s.avgR)}R`)),
      row('BUY signals', (s) => String(s.buySignals)),
      row('SELL signals', (s) => String(s.sellSignals)),
    ];
  }
}
