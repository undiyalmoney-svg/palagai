import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ReversalMeterApiService } from './reversal-meter-api.service';
import { ReversalMeterAnalysisService } from './reversal-meter-analysis.service';
import { CandleRangeApiResponse, ReversalInput, ReversalSignal } from './reversal-meter.types';

type ReversalRequestSet = {
  trading_symbol: string;
  candleDate: string;
  startTime: string;
  endTime: string;
  intervalInMinutes: number;
};

type SymbolResult = {
  symbol: string;
  result: ReversalSignal;
  raw: CandleRangeApiResponse | { error: string };
};

@Component({
  selector: 'app-reversal-meter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reversal-meter.component.html',
  styleUrl: './reversal-meter.component.css',
})
export class ReversalMeterComponent {
  private readonly api = inject(ReversalMeterApiService);
  private readonly analysis = inject(ReversalMeterAnalysisService);

  private readonly backendPath = '/api/candles';
  private readonly exchange = 'NSE';
  private readonly segment = 'CASH';
  requestSets: ReversalRequestSet[] = [
    {
      trading_symbol: 'DMART',
      candleDate: '',
      startTime: '09:15',
      endTime: '10:20',
      intervalInMinutes: 5,
    },
  ];

  /** Signals so UI updates as soon as HTTP completes (fetch backend may run outside Zone). */
  readonly loading = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error' | 'info' | ''>('');
  readonly results = signal<SymbolResult[]>([]);

  checkReversal(): void {
    if (!this.requestSets.length) {
      this.setStatus('Add at least one set', 'error');
      return;
    }

    const normalizedSets = this.requestSets.map((set, index) => ({
      ...set,
      trading_symbol: (set.trading_symbol || '').trim().toUpperCase(),
      candleDate: (set.candleDate || '').trim(),
      startTime: (set.startTime || '').trim(),
      endTime: (set.endTime || '').trim(),
      index,
    }));

    const invalid = normalizedSets.find(
      (set) => !set.trading_symbol || !set.candleDate || !set.startTime || !set.endTime,
    );
    if (invalid) {
      this.setStatus(`Set ${invalid.index + 1}: symbol/date/start/end are required`, 'error');
      return;
    }

    this.loading.set(true);
    this.results.set([]);
    this.setStatus('', '');

    const requests = normalizedSets.map((set) => {
      const start = `${set.candleDate} ${set.startTime}:00`;
      const end = `${set.candleDate} ${set.endTime}:00`;
      const input: ReversalInput = {
        exchange: this.exchange.trim(),
        segment: this.segment.trim(),
        trading_symbol: set.trading_symbol,
        start_time: start,
        end_time: end,
        interval_in_minutes: set.intervalInMinutes || 5,
      };

      return this.api.fetchCandles(this.backendPath, input).pipe(
        catchError((err) =>
          of({
            status: 'ERROR',
            payload: {},
            error: err?.error?.message || err?.message || 'Failed to fetch candles',
          } as unknown as CandleRangeApiResponse),
        ),
      );
    });

    forkJoin(requests).subscribe({
      next: (responses) => {
        const mapped: SymbolResult[] = responses.map((resp, idx) => {
          const symbol = normalizedSets[idx].trading_symbol;
          const anyResp = resp as unknown as { error?: string };
          if (anyResp.error) {
            return {
              symbol,
              result: {
                signal: 'NO TRADE',
                type: 'NONE',
                reversal_status: 'NA',
                entry_trigger_candle_time: null,
                entry_price: 0,
                stop_loss: 0,
                reason: `Fetch failed: ${anyResp.error}`,
                analysis_candle_count: null,
                analysis_window_start_time: null,
                analysis_window_end_time: null,
              },
              raw: { error: anyResp.error },
            };
          }
          const parsed = this.analysis.parseCandles(resp as CandleRangeApiResponse);
          const result = this.analysis.analyze(parsed);
          return { symbol, result, raw: resp as CandleRangeApiResponse };
        });
        this.results.set(mapped);
        this.loading.set(false);
        this.setStatus(`Analysis complete for ${normalizedSets.length} set(s)`, 'success');
      },
      error: (err) => {
        this.loading.set(false);
        this.setStatus(err?.message || 'Failed to run reversal analysis', 'error');
      },
    });
  }

  getSignalClass(signal: ReversalSignal['signal']): string {
    if (signal === 'BUY') return 'buy';
    if (signal === 'SELL') return 'sell';
    return 'no-trade';
  }

  /** Candle `time` from API may be seconds or milliseconds. */
  formatTriggerTime(ts: number): string {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleString();
  }

  hasEnterNow(result: ReversalSignal): boolean {
    return result.reason.includes('🔥 ENTER NOW');
  }

  addSet(): void {
    this.requestSets.push({
      trading_symbol: '',
      candleDate: '',
      startTime: '09:15',
      endTime: '10:20',
      intervalInMinutes: 5,
    });
  }

  removeSet(index: number): void {
    if (this.requestSets.length === 1) {
      this.requestSets[0] = {
        trading_symbol: '',
        candleDate: '',
        startTime: '09:15',
        endTime: '10:20',
        intervalInMinutes: 5,
      };
      return;
    }
    this.requestSets.splice(index, 1);
  }

  /** Copy date, start, and end from the clicked set to every set. */
  syncDateTimeToAll(sourceIndex: number): void {
    const src = this.requestSets[sourceIndex];
    if (!src) {
      return;
    }
    const { candleDate, startTime, endTime } = src;
    for (const set of this.requestSets) {
      set.candleDate = candleDate;
      set.startTime = startTime;
      set.endTime = endTime;
    }
  }

  /** Shift this set's end time forward by 5 minutes (start unchanged). */
  addFiveMinutesToSet(index: number): void {
    this.shiftEndTimeByMinutes(index, 5);
  }

  /** Shift this set's end time back by 5 minutes (start unchanged). */
  subtractFiveMinutesFromSet(index: number): void {
    this.shiftEndTimeByMinutes(index, -5);
  }

  private shiftEndTimeByMinutes(index: number, deltaMinutes: number): void {
    const set = this.requestSets[index];
    if (!set) {
      return;
    }
    const dateStr = (set.candleDate || '').trim();
    if (dateStr) {
      const endDt = this.parseLocalDateTime(dateStr, set.endTime);
      if (endDt) {
        endDt.setMinutes(endDt.getMinutes() + deltaMinutes);
        set.candleDate = this.toDateInputValue(endDt);
        set.endTime = this.toTimeInputValue(endDt);
        return;
      }
    }
    set.endTime = this.addMinutesToTimeString(set.endTime, deltaMinutes);
  }

  private parseLocalDateTime(dateStr: string, timeStr: string): Date | null {
    const t = this.normalizeTimeForParse((timeStr || '').trim());
    if (!t) {
      return null;
    }
    const d = new Date(`${dateStr}T${t}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Ensures HH:mm:ss for ISO local parsing. */
  private normalizeTimeForParse(time: string): string | null {
    const parts = time.split(':').map((p) => p.trim());
    if (parts.length < 2) {
      return null;
    }
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = parts[2] !== undefined ? Number(parts[2]) : 0;
    if (![h, m, s].every((n) => Number.isFinite(n))) {
      return null;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private toDateInputValue(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  private toTimeInputValue(d: Date): string {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  private addMinutesToTimeString(time: string, deltaMinutes: number): string {
    const raw = (time || '').trim();
    const parts = raw.split(':');
    const h = parseInt(parts[0] ?? '', 10);
    const m = parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      return raw;
    }
    let total = h * 60 + m + deltaMinutes;
    total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  }

  private setStatus(message: string, type: 'success' | 'error' | 'info' | ''): void {
    this.status.set(message);
    this.statusType.set(type);
  }
}
