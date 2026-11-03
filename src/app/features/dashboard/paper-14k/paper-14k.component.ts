import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsView, PaperAnalyticsComponent } from './paper-analytics.component';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { OptionPickView, allClosedFills, booksFundEnd, optionPickLabel } from '../../../core/paper-desk/live-paper.engine';
import {
  CRUDE_OPTION_MIN_COMMODITY_RS,
  commodityTopUpRs,
  planCapitalSplit,
} from '../../../core/paper-desk/capital-split.util';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe, RouterLink, PaperAnalyticsComponent],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent {
  protected readonly paper = inject(LivePaperService);

  protected readonly view = signal<'desk' | AnalyticsView>('desk');
  protected readonly views: { id: 'desk' | AnalyticsView; label: string }[] = [
    { id: 'desk', label: 'Desk' },
    { id: 'signals', label: 'Signals' },
    { id: 'performance', label: 'Performance' },
    { id: 'compare', label: 'Paper vs live' },
    { id: 'validation', label: 'Validation' },
    { id: 'trades', label: 'Trades' },
  ];

  protected analyticsView(): AnalyticsView | null {
    const v = this.view();
    return v === 'desk' ? null : v;
  }

  protected readonly planOptions = [14_000, 21_000, 30_000, 50_000] as const;
  protected readonly planCapital = signal<number>(50_000);
  protected readonly plan = computed(() => planCapitalSplit(this.planCapital()));
  protected readonly crudeMinCommodityRs = CRUDE_OPTION_MIN_COMMODITY_RS;
  protected readonly topUpRs = computed(() =>
    commodityTopUpRs(this.plan(), this.paper.session().kiteFunds?.commodityCash),
  );

  protected pickPlan(capitalRs: number): void {
    this.planCapital.set(capitalRs);
  }

  protected startPaper(): void {
    void this.paper.start();
  }

  protected stopPaper(): void {
    this.paper.stop();
  }

  protected booksFund(): number {
    return booksFundEnd(this.paper.session().books);
  }

  protected pick(row: OptionPickView): string {
    return optionPickLabel(row);
  }

  protected fills() {
    return allClosedFills(this.paper.session().books);
  }
}
