import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CandleRangeApiResponse, ReversalInput } from './reversal-meter.types';

@Injectable({ providedIn: 'root' })
export class ReversalMeterApiService {
  private readonly http = inject(HttpClient);

  fetchCandles(backendPath: string, input: ReversalInput): Observable<CandleRangeApiResponse> {
    const path = backendPath.trim() || '/api/candles';
    const url = `${environment.backendBaseUrl}${path}`;
    const params = new HttpParams({
      fromObject: {
        exchange: input.exchange,
        segment: input.segment,
        trading_symbol: input.trading_symbol,
        start_time: input.start_time,
        end_time: input.end_time,
        interval_in_minutes: String(input.interval_in_minutes),
      },
    });
    return this.http.get<CandleRangeApiResponse>(url, { params });
  }
}

