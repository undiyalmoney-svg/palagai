import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  UiConfirmDialogComponent,
  UiConfirmDialogData,
} from './ui-confirm-dialog.component';
import { UiAlertDialogComponent, UiAlertDialogData } from './ui-alert-dialog.component';

@Injectable({ providedIn: 'root' })
export class UiDialogService {
  private readonly dialog = inject(MatDialog);

  /** Premium confirm popup. Returns true if user confirmed. */
  async confirm(data: UiConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open(UiConfirmDialogComponent, {
      data,
      width: '440px',
      maxWidth: '92vw',
      autoFocus: 'dialog',
      panelClass: ['ui-dialog-panel'],
      backdropClass: 'ui-dialog-backdrop',
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result === true;
  }

  /** Premium alert / info popup. */
  async alert(data: UiAlertDialogData): Promise<void> {
    const ref = this.dialog.open(UiAlertDialogComponent, {
      data,
      width: '420px',
      maxWidth: '92vw',
      autoFocus: 'dialog',
      panelClass: ['ui-dialog-panel'],
      backdropClass: 'ui-dialog-backdrop',
    });
    await firstValueFrom(ref.afterClosed());
  }
}
