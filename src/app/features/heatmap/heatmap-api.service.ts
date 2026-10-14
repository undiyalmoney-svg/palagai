import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HeatmapSnapshot } from './heatmap.models';

@Injectable({ providedIn: 'root' })
export class HeatmapApiService {
  private readonly http = inject(HttpClient);
  private readonly base =
    (environment as { heatmapApiBaseUrl?: string }).heatmapApiBaseUrl || '/api/heatmap';

  snapshot(): Promise<HeatmapSnapshot> {
    return firstValueFrom(this.http.get<HeatmapSnapshot>(this.base));
  }
}
