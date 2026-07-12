import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class HistoricalTesterSessionService {
  readonly lastRunInstrumentId = signal<string | null>(null);

  markRun(instrumentId: string): void {
    this.lastRunInstrumentId.set(instrumentId);
  }
}
