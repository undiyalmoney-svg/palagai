import { Injectable, computed, inject, signal } from '@angular/core';
import { MomentumApiService } from './momentum-api.service';
import { MomentumStatus } from './momentum.models';
import { errorMessage } from './format.util';

/** Shared, server-derived state for the Momentum shell (never trading logic). */
@Injectable({ providedIn: 'root' })
export class MomentumStateService {
  private readonly api = inject(MomentumApiService);

  readonly status = signal<MomentumStatus | null>(null);
  readonly statusError = signal('');
  readonly loading = signal(false);

  /** Live Trading is only offered once a broker session is configured. */
  readonly liveAvailable = computed(() => !!this.status()?.broker.configured);
  readonly simulated = computed(() => !!this.status()?.provider.simulated);

  async refreshStatus(): Promise<MomentumStatus | null> {
    this.loading.set(true);
    try {
      const s = await this.api.status();
      this.status.set(s);
      this.statusError.set('');
      return s;
    } catch (err) {
      this.statusError.set(errorMessage(err, 'Could not load Momentum status'));
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}
