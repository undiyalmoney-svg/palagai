import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface SaveConfirmationDialogData {
  message: string;
  showCancel?: boolean;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
}

@Component({
  selector: 'app-save-confirmation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="save-confirmation-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">save</mat-icon>
        Unsaved Changes
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <p class="message-text">{{ data.message }}</p>
        <div class="rules-section" *ngIf="data.message.includes('competition')">
          <p class="rules-title">Make sure your kavithai following these rules:</p>
          <ul class="rules-list">
            <li>Not copying from anywhere outside</li>
            <li>Only own contents is allowed</li>
          </ul>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button 
          *ngIf="data.showCancel !== false"
          mat-button 
          (click)="cancel()" 
          class="cancel-btn"
        >
          {{ data.cancelLabel || 'Cancel' }}
        </button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="save()" 
          class="save-btn"
        >
          <mat-icon>save</mat-icon>
          {{ data.saveLabel || 'Save Changes' }}
        </button>
        <button 
          mat-button 
          color="warn"
          (click)="discard()" 
          class="discard-btn"
        >
          {{ data.discardLabel || 'Discard' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .save-confirmation-dialog-wrapper {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 450px;
      margin: 0 auto;
    }

    .dialog-title {
      margin: 0;
      padding: 20px 20px 0 20px;
      font-size: 20px;
      font-weight: 600;
      color: #111111;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .title-icon {
      color: #667eea;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
    }

    .message-text {
      margin: 0 0 16px 0;
      font-size: 15px;
      color: #111111;
      line-height: 1.6;
    }

    .message-text:last-child {
      margin-bottom: 0;
    }

    .rules-section {
      background: #fff3e0;
      border: 1px solid #ffb74d;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }

    .rules-title {
      margin: 0 0 12px 0;
      font-size: 15px;
      font-weight: 600;
      color: #e65100;
    }

    .rules-list {
      margin: 0;
      padding-left: 20px;
      color: #555;
      font-size: 14px;
      line-height: 1.8;
    }

    .rules-list li {
      margin-bottom: 8px;
    }

    .rules-list li:last-child {
      margin-bottom: 0;
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding: 0 20px 20px 20px !important;
      margin: 0 !important;
      min-height: auto;
    }

    .cancel-btn {
      min-width: 100px;
    }

    .save-btn {
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .discard-btn {
      min-width: 100px;
    }

    @media (max-width: 600px) {
      .save-confirmation-dialog-wrapper {
        max-width: 90vw;
      }

      .dialog-content {
        padding: 16px !important;
      }

      .dialog-title {
        padding: 16px 16px 0 16px;
        font-size: 18px;
      }

      .dialog-actions {
        flex-direction: column;
        gap: 12px;
        padding: 0 16px 16px 16px !important;
      }

      .cancel-btn,
      .save-btn,
      .discard-btn {
        width: 100%;
      }
    }
  `]
})
export class SaveConfirmationDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<SaveConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SaveConfirmationDialogData
  ) {}

  save() {
    this.dialogRef.close('save');
  }

  discard() {
    this.dialogRef.close('discard');
  }

  cancel() {
    this.dialogRef.close('cancel');
  }
}



