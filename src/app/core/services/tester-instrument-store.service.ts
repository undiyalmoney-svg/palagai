import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  BANK_NIFTY_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  TESTER_TAB_IDS,
} from '../constants/instruments.const';

const SELECTED_KEY = 'palagai_tester_tab_selected';

@Injectable({ providedIn: 'root' })
export class TesterInstrumentStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly selectedId = signal<string>(this.loadSelectedId());

  readonly selectedTabId = this.selectedId.asReadonly();

  select(id: string): void {
    if (!TESTER_TAB_IDS.includes(id as (typeof TESTER_TAB_IDS)[number])) {
      return;
    }
    this.selectedId.set(id);
    this.persistSelected();
  }

  private loadSelectedId(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return NIFTY_50_INSTRUMENT.id;
    }
    const stored = localStorage.getItem(SELECTED_KEY);
    if (stored === BANK_NIFTY_INSTRUMENT.id) {
      return BANK_NIFTY_INSTRUMENT.id;
    }
    return NIFTY_50_INSTRUMENT.id;
  }

  private persistSelected(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    localStorage.setItem(SELECTED_KEY, this.selectedId());
  }
}
