import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { SlBuddyRule, SlBuddyView } from './sl-buddy.models';

@Injectable({ providedIn: 'root' })
export class SlBuddyApiService {
  private readonly http = inject(HttpClient);
  private readonly kite = inject(KiteSessionService);
  private readonly base =
    (environment as { slBuddyApiBaseUrl?: string }).slBuddyApiBaseUrl || '/api/sl-buddy';

  get(): Promise<{ buddy: SlBuddyView; rules: SlBuddyRule[] }> {
    return firstValueFrom(
      this.http.get<{ buddy: SlBuddyView; rules: SlBuddyRule[] }>(this.base, {
        headers: this.kiteHeader(),
      }),
    );
  }

  setWatching(enabled: boolean): Promise<{ buddy: SlBuddyView; rules: SlBuddyRule[] }> {
    return firstValueFrom(
      this.http.put<{ buddy: SlBuddyView; rules: SlBuddyRule[] }>(
        this.base,
        { enabled },
        { headers: this.kiteHeader() },
      ),
    );
  }

  private kiteHeader(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}
