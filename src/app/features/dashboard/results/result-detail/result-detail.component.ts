import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HistoricalTest } from '../../../../core/models/historical-test.model';
import { ResultsStoreService } from '../../../../core/services/results-store.service';
import { downloadTextFile, toCsv } from '../../../../core/utils/export.util';

@Component({
  selector: 'app-result-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, MatButtonModule, MatIconModule],
  templateUrl: './result-detail.component.html',
  styleUrl: './result-detail.component.css',
})
export class ResultDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly resultsStore = inject(ResultsStoreService);

  protected readonly test = signal<HistoricalTest | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.test.set(this.resultsStore.getById(id) ?? null);
    }
  }

  protected exportTrades(): void {
    const current = this.test();
    if (!current) {
      return;
    }
    const rows = current.trades.map((t) => ({
      strategy: t.strategyName,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      stopLoss: t.stopLoss,
      target: t.targetPrice,
      points: t.points,
      profitLoss: t.profitLoss,
      confidence: t.confidence,
      entryReason: t.entryReason,
      exitReason: t.exitReason,
      holdingMinutes: t.holdingMinutes,
    }));
    downloadTextFile(`test-${current.id}-trades.csv`, toCsv(rows), 'text/csv');
  }
}
