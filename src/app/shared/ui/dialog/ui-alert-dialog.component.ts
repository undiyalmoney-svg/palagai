import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface UiAlertDialogData {
  title: string;
  message: string;
  okLabel?: string;
}

@Component({
  selector: 'app-ui-alert-dialog',
  standalone: true,
  imports: [MatDialogModule],
  template: `
    <div class="dlg">
      <div class="dlg-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4m0-4h.01" />
        </svg>
      </div>
      <h2 class="dlg-title">{{ data.title }}</h2>
      <p class="dlg-msg">{{ data.message }}</p>
      <div class="dlg-actions">
        <button type="button" class="ui-btn ui-btn-primary" (click)="close()">
          {{ data.okLabel || 'OK' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .dlg {
      padding: 1.75rem 1.75rem 1.5rem;
    }
    .dlg-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      margin-bottom: 1rem;
      background: var(--pg-info-soft);
      color: var(--pg-info);
    }
    .dlg-icon svg {
      width: 22px;
      height: 22px;
    }
    .dlg-title {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.025em;
    }
    .dlg-msg {
      margin: 0.55rem 0 0;
      font-size: 0.9rem;
      line-height: 1.55;
      color: var(--pg-muted);
      white-space: pre-wrap;
    }
    .dlg-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 1.5rem;
    }
  `,
})
export class UiAlertDialogComponent {
  protected readonly data = inject<UiAlertDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<UiAlertDialogComponent, void>);

  protected close(): void {
    this.dialogRef.close();
  }
}
