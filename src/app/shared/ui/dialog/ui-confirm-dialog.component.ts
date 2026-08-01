import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface UiConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
}

@Component({
  selector: 'app-ui-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule],
  template: `
    <div class="dlg" [attr.data-tone]="data.tone || 'default'">
      <div class="dlg-icon" aria-hidden="true">
        @if ((data.tone || 'default') === 'danger') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
        } @else if (data.tone === 'warning') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4m0-4h.01" />
          </svg>
        }
      </div>
      <h2 class="dlg-title">{{ data.title }}</h2>
      <p class="dlg-msg">{{ data.message }}</p>
      <div class="dlg-actions">
        <button type="button" class="ui-btn ui-btn-secondary" (click)="close(false)">
          {{ data.cancelLabel || 'Cancel' }}
        </button>
        <button
          type="button"
          class="ui-btn"
          [class.ui-btn-primary]="(data.tone || 'default') !== 'danger'"
          [class.ui-btn-danger]="data.tone === 'danger'"
          (click)="close(true)"
        >
          {{ data.confirmLabel || 'Confirm' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .dlg {
      padding: 1.75rem 1.75rem 1.5rem;
      text-align: left;
    }
    .dlg-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      margin-bottom: 1rem;
      background: var(--pg-bg-soft);
      color: var(--pg-bull);
    }
    .dlg[data-tone='danger'] .dlg-icon {
      background: var(--pg-bear-soft);
      color: var(--pg-bear-deep);
    }
    .dlg[data-tone='warning'] .dlg-icon {
      background: var(--pg-warn-soft);
      color: var(--pg-warn);
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
      color: var(--pg-ink);
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
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 1.5rem;
    }
  `,
})
export class UiConfirmDialogComponent {
  protected readonly data = inject<UiConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<UiConfirmDialogComponent, boolean>);

  protected close(value: boolean): void {
    this.dialogRef.close(value);
  }
}
