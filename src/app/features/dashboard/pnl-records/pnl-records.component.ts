import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

interface PnlRecord {
  date: string;
  amountRs: number;
  note?: string;
  updatedAt?: string;
}

interface PnlSummary {
  days: number;
  totalRs: number;
  greenDays: number;
  redDays: number;
  flatDays: number;
}

@Component({
  selector: 'app-pnl-records',
  standalone: true,
  imports: [FormsModule, MatButtonModule, DecimalPipe],
  templateUrl: './pnl-records.component.html',
  styleUrl: './pnl-records.component.css',
})
export class PnlRecordsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiBase =
    (environment as { pnlApiBaseUrl?: string }).pnlApiBaseUrl || '/api/pnl';

  protected date = new Date().toISOString().slice(0, 10);
  protected amountRs: number | null = null;
  protected note = '';

  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly records = signal<PnlRecord[]>([]);
  protected readonly summary = signal<PnlSummary | null>(null);

  protected readonly sorted = computed(() =>
    [...this.records()].sort((a, b) => b.date.localeCompare(a.date)),
  );

  ngOnInit(): void {
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ records: PnlRecord[]; summary: PnlSummary }>(this.apiBase),
      );
      this.records.set(res.records || []);
      this.summary.set(res.summary || null);
      this.message.set('');
    } catch {
      this.message.set(
        'P/L API unreachable. Check Order-API on droplet (Mongo) and /api/pnl proxy.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected edit(row: PnlRecord): void {
    this.date = row.date;
    this.amountRs = row.amountRs;
    this.note = row.note || '';
  }

  protected async save(): Promise<void> {
    if (this.amountRs == null || !Number.isFinite(Number(this.amountRs))) {
      this.message.set('Enter a ₹ amount (use negative for loss).');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.put(this.apiBase, {
          date: this.date,
          amountRs: Number(this.amountRs),
          note: this.note,
        }),
      );
      this.message.set(`Saved ${this.date}`);
      this.amountRs = null;
      this.note = '';
      await this.refresh();
    } catch (err) {
      this.message.set(`Save failed: ${String(err)}`);
      this.busy.set(false);
    }
  }

  protected async remove(date: string): Promise<void> {
    if (!window.confirm(`Delete P/L for ${date}?`)) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`${this.apiBase}/${date}`));
      this.message.set(`Deleted ${date}`);
      await this.refresh();
    } catch (err) {
      this.message.set(`Delete failed: ${String(err)}`);
      this.busy.set(false);
    }
  }
}
