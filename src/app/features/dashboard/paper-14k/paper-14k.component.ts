import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { allClosedFills, booksFundEnd } from '../../../core/paper-desk/live-paper.engine';
import {
  CRUDE_OPTION_MIN_COMMODITY_RS,
  commodityTopUpRs,
  planCapitalSplit,
} from '../../../core/paper-desk/capital-split.util';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent {
  protected readonly paper = inject(LivePaperService);

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

  protected fills() {
    return allClosedFills(this.paper.session().books);
  }
}
