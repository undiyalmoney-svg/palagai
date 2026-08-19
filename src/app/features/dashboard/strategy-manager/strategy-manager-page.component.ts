import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';

/** One OHLC candle. With oi=1, Kite returns OI as the 2nd column. */
interface HistoricalCandle {
  date: string;
  oi?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NormalizedResponse {
  candles: HistoricalCandle[];
  display: unknown;
}

@Component({
  selector: 'app-strategy-manager-page',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './strategy-manager-page.component.html',
  styleUrl: './strategy-manager-page.component.css',
})
export class StrategyManagerPageComponent {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);

  /** Defaults mirror the reference curl. */
  protected readonly instrumentToken = signal('12517890');
  protected readonly interval = signal('minute');
  /** Full `YYYY-MM-DD HH:MM:SS` strings sent to Kite. */
  protected readonly fromDate = signal('2026-06-04 09:15:00');
  protected readonly toDate = signal('2026-06-04 09:20:00');
  protected readonly includeOi = signal(true);

  /** Date-picker state (date part only) + the separate time part. */
  protected readonly fromDateObj = signal<Date | null>(this.parseDatePart(this.fromDate()));
  protected readonly toDateObj = signal<Date | null>(this.parseDatePart(this.toDate()));
  protected readonly fromTime = signal(this.timePart(this.fromDate(), '09:15:00'));
  protected readonly toTime = signal(this.timePart(this.toDate(), '09:20:00'));

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly rawJson = signal('');
  protected readonly candles = signal<HistoricalCandle[]>([]);
  protected readonly copied = signal(false);

  protected readonly intervals = [
    'minute',
    '2minute',
    '3minute',
    '5minute',
    '10minute',
    '15minute',
    '30minute',
    '60minute',
    'day',
  ];

  protected async fetchData(): Promise<void> {
    this.error.set(null);
    this.copied.set(false);

    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      this.error.set(
        'No connected Kite session. Open the Token page and connect a Kite token first.',
      );
      this.candles.set([]);
      this.rawJson.set('');
      return;
    }

    const token = this.instrumentToken().trim();
    const from = this.fromDate().trim();
    const to = this.toDate().trim();
    if (!token || !from || !to) {
      this.error.set('Instrument token, From and To are required.');
      this.candles.set([]);
      this.rawJson.set('');
      return;
    }

    const oi = this.includeOi();
    this.loading.set(true);
    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: token,
          interval: this.interval(),
          from,
          to,
          authorization,
          oi,
        }),
      );
      const parsed = this.normalize(response, oi);
      this.candles.set(parsed.candles);
      this.rawJson.set(JSON.stringify(parsed.display, null, 2));
      if (!parsed.candles.length) {
        this.error.set('Kite returned no candles for the given range.');
      }
    } catch (err) {
      this.error.set(formatUnknownError(err, 'Kite historical'));
      this.candles.set([]);
      this.rawJson.set('');
    } finally {
      this.loading.set(false);
    }
  }

  protected copyJson(): void {
    const text = this.rawJson();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
    });
  }

  /** Date picker chose a new date → keep the time, rebuild the datetime string. */
  protected pickFromDate(value: Date | null): void {
    this.fromDateObj.set(value);
    this.fromDate.set(this.combine(value, this.fromTime()));
  }

  protected pickToDate(value: Date | null): void {
    this.toDateObj.set(value);
    this.toDate.set(this.combine(value, this.toTime()));
  }

  protected setFromTime(value: string): void {
    this.fromTime.set(value);
    this.fromDate.set(this.combine(this.fromDateObj(), value));
  }

  protected setToTime(value: string): void {
    this.toTime.set(value);
    this.toDate.set(this.combine(this.toDateObj(), value));
  }

  protected downloadCsv(): void {
    const rows = this.candles();
    if (!rows.length) return;
    const oi = this.includeOi();
    const header = oi
      ? 'date,oi,open,high,low,close,volume'
      : 'date,open,high,low,close,volume';
    const lines = rows.map((c) => {
      const cols = [
        c.date,
        ...(oi ? [String(c.oi ?? '')] : []),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
      ];
      return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [header, ...lines].join('\n');
    this.downloadBlob(
      `instrument-${this.instrumentToken().trim()}-historical.csv`,
      csv,
      'text/csv',
    );
  }

  /** Build the display object (normalized candles) so the JSON mirrors Kite's shape. */
  private normalize(response: unknown, oi: boolean): NormalizedResponse {
    const body = response as {
      status?: string;
      data?: { candles?: unknown[][] };
    };
    const rows = body?.data?.candles ?? [];
    const candles = rows.map((row) => {
      if (oi && row.length >= 7) {
        return {
          date: String(row[0] ?? ''),
          oi: Number(row[1]),
          open: Number(row[2]),
          high: Number(row[3]),
          low: Number(row[4]),
          close: Number(row[5]),
          volume: Number(row[6]),
        };
      }
      return {
        date: String(row[0] ?? ''),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      };
    });
    return {
      candles,
      display: { status: body?.status ?? 'error', data: { candles } },
    };
  }

  private downloadBlob(name: string, content: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Parse the `YYYY-MM-DD` portion into a local Date (no timezone shifts). */
  private parseDatePart(dt: string): Date | null {
    const m = String(dt).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** Extract the `HH:MM:SS` portion; fall back to `fallback` when missing. */
  private timePart(dt: string, fallback: string): string {
    const m = String(dt).trim().match(/(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : fallback;
  }

  private fmtDate(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  /** Rebuild the `YYYY-MM-DD HH:MM:SS` string from a date + time. */
  private combine(date: Date | null, time: string): string {
    const datePart = date ? this.fmtDate(date) : '';
    const timePart = time.trim();
    return datePart && timePart ? `${datePart} ${timePart}` : datePart || timePart;
  }
}
