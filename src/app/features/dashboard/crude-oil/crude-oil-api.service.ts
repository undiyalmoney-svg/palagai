import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { CrudeLiveResponse } from './crude-oil.models';

@Injectable({ providedIn: 'root' })
export class CrudeOilApiService {
  private readonly http = inject(HttpClient);
  private readonly kite = inject(KiteSessionService);
  private readonly base =
    (environment as { crudeLiveApiBaseUrl?: string }).crudeLiveApiBaseUrl || '/api/crude-live';

  status(): Promise<CrudeLiveResponse> {
    return firstValueFrom(
      this.http.get<CrudeLiveResponse>(`${this.base}/status`, { headers: this.headers() }),
    );
  }

  startLiveMoney(): Promise<CrudeLiveResponse> {
    return firstValueFrom(
      this.http.post<CrudeLiveResponse>(
        `${this.base}/start`,
        { confirm: true },
        { headers: this.headers() },
      ),
    );
  }

  stopLiveMoney(): Promise<CrudeLiveResponse> {
    return firstValueFrom(
      this.http.post<CrudeLiveResponse>(`${this.base}/stop`, {}, { headers: this.headers() }),
    );
  }

  private headers(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}
