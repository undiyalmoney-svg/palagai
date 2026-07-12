import { Component, inject, OnInit } from '@angular/core';
import { TesterInstrumentStoreService } from '../../../core/services/tester-instrument-store.service';
import {
  BANK_NIFTY_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
} from '../../../core/constants/instruments.const';
import { HistoricalTesterPanelComponent } from './historical-tester-panel.component';

@Component({
  selector: 'app-historical-tester',
  standalone: true,
  imports: [HistoricalTesterPanelComponent],
  templateUrl: './historical-tester.component.html',
  styleUrl: './historical-tester.component.css',
})
export class HistoricalTesterComponent implements OnInit {
  private readonly tabStore = inject(TesterInstrumentStoreService);

  protected readonly niftyId = NIFTY_50_INSTRUMENT.id;
  protected readonly bankNiftyId = BANK_NIFTY_INSTRUMENT.id;

  protected readonly tabs = [
    { id: NIFTY_50_INSTRUMENT.id, label: 'NIFTY 50' },
    { id: BANK_NIFTY_INSTRUMENT.id, label: 'Bank Nifty' },
  ] as const;

  protected readonly activeTabId = this.tabStore.selectedTabId;

  ngOnInit(): void {
    const current = this.activeTabId();
    if (current !== NIFTY_50_INSTRUMENT.id && current !== BANK_NIFTY_INSTRUMENT.id) {
      this.tabStore.select(NIFTY_50_INSTRUMENT.id);
    }
  }

  protected selectTab(tabId: string): void {
    this.tabStore.select(tabId);
  }

  protected isActiveTab(tabId: string): boolean {
    return this.activeTabId() === tabId;
  }
}
