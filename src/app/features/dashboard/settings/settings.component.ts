import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DataManagementService } from '../../../core/services/data-management.service';
import { InstrumentStoreService } from '../../../core/services/instrument-store.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatDialogModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  private readonly dataManagement = inject(DataManagementService);
  private readonly instrumentStore = inject(InstrumentStoreService);
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly dialog = inject(MatDialog);

  protected readonly metadata = this.instrumentStore.instrumentMetadata;
  protected readonly message = signal('');
  protected readonly isLoading = signal(false);
  protected lots = 1;

  constructor() {
    this.lots = this.lotsPreference.get();
  }

  protected onLotsChange(): void {
    const normalized = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = normalized;
    this.lotsPreference.set(normalized);
    this.message.set(`Default lots set to ${normalized}.`);
  }

  protected async refreshInstruments(): Promise<void> {
    this.isLoading.set(true);
    this.message.set('');
    try {
      await this.dataManagement.refreshInstruments();
      this.message.set('Instruments refreshed successfully.');
    } catch (error) {
      this.message.set(formatUnknownError(error, 'Instrument refresh'));
    } finally {
      this.isLoading.set(false);
    }
  }

  protected confirmAction(title: string, message: string, action: () => void | Promise<void>): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title, message },
      width: '440px',
      maxWidth: '92vw',
      panelClass: ['ui-dialog-panel'],
      backdropClass: 'ui-dialog-backdrop',
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        void Promise.resolve(action()).then(() => this.message.set(`${title} completed.`));
      }
    });
  }

  protected clearResults(): void {
    this.confirmAction('Clear Historical Results', 'Remove all saved backtest results?', () =>
      this.dataManagement.clearHistoricalResults(),
    );
  }

  protected clearTrades(): void {
    this.confirmAction('Clear Trade History', 'Remove all stored trade records?', () =>
      this.dataManagement.clearTradeHistory(),
    );
  }

  protected clearCandles(): void {
    this.confirmAction('Clear Candle Cache', 'Remove cached historical candle data?', () =>
      this.dataManagement.clearCandleCache(),
    );
  }

  protected clearInstruments(): void {
    this.confirmAction('Clear Instrument Cache', 'Delete the local instrument file?', () =>
      this.dataManagement.clearInstrumentCache(),
    );
  }

  protected clearAll(): void {
    this.confirmAction(
      'Clear All Data',
      'Reset all cached data while keeping login credentials?',
      () => this.dataManagement.clearAllData(false),
    );
  }

  protected factoryReset(): void {
    this.confirmAction(
      'Factory Reset',
      'Delete ALL data including stored API credentials and tokens?',
      () => this.dataManagement.clearAllData(true),
    );
  }
}
