import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { BoardService } from '../board.service';

export interface GoldenSlateIdDialogData {
  boardKey: string;
  currentGoldenSlateId?: string;
}

@Component({
  selector: 'app-golden-slate-id-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
  ],
  template: `
    <div class="golden-slate-dialog">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon>workspace_premium</mat-icon>
        Golden Slate ID
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <p class="description">
          Set a custom ID for this board. This can be any string, word, or sentence.
          The ID must be unique across all boards.
        </p>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Golden Slate ID</mat-label>
          <input
            matInput
            [(ngModel)]="goldenSlateId"
            placeholder="e.g., my-custom-id, Welcome Board, or any text"
            maxlength="200"
            (keyup.enter)="onSave()"
            autocomplete="off"
          />
          <mat-hint>Leave empty to remove the golden slate ID</mat-hint>
        </mat-form-field>
        
        <div class="current-id" *ngIf="data.currentGoldenSlateId">
          <p><strong>Current ID:</strong> {{ data.currentGoldenSlateId }}</p>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="onCancel()" class="cancel-btn">Cancel</button>
        <button mat-raised-button color="primary" (click)="onSave()" [disabled]="saving" class="save-btn">
          <mat-icon *ngIf="!saving">save</mat-icon>
          <mat-icon *ngIf="saving" class="spinning">hourglass_empty</mat-icon>
          <span>{{ saving ? 'Saving...' : 'Save' }}</span>
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .golden-slate-dialog {
      padding: 0;
      min-width: 400px;
      max-width: 600px;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 24px;
      font-weight: 600;
      color: #1976d2;
      margin: 0 0 8px 0;
      padding: 24px 24px 16px 24px;
    }

    .dialog-title mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: #ffd700;
    }

    .dialog-content {
      padding: 0 24px 24px 24px;
    }

    .description {
      color: #666;
      font-size: 14px;
      margin-bottom: 20px;
      line-height: 1.5;
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .current-id {
      margin-top: 16px;
      padding: 12px;
      background-color: #f5f5f5;
      border-radius: 4px;
    }

    .current-id p {
      margin: 0;
      color: #333;
      font-size: 14px;
    }

    .dialog-actions {
      padding: 16px 24px 24px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin: 0;
    }

    .cancel-btn {
      color: #666;
    }

    .save-btn {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .save-btn .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 600px) {
      .golden-slate-dialog {
        min-width: unset;
        max-width: 90vw;
      }

      .dialog-title {
        font-size: 20px;
        padding: 20px 20px 12px 20px;
      }

      .dialog-content {
        padding: 0 20px 20px 20px;
      }
    }
  `],
})
export class GoldenSlateIdDialogComponent {
  goldenSlateId: string = '';
  saving: boolean = false;

  constructor(
    public dialogRef: MatDialogRef<GoldenSlateIdDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: GoldenSlateIdDialogData,
    private boardsService: BoardService
  ) {
    // Initialize with current golden slate ID if it exists
    this.goldenSlateId = data.currentGoldenSlateId || '';
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  async onSave(): Promise<void> {
    if (this.saving) {
      return;
    }

    this.saving = true;

    try {
      // Trim the input
      const trimmedId = this.goldenSlateId.trim();
      
      // If empty, remove the golden slate ID
      const idToSet = trimmedId === '' ? null : trimmedId;
      
      await this.boardsService.setGoldenSlateId(this.data.boardKey, idToSet);
      
      this.dialogRef.close({ success: true, goldenSlateId: idToSet });
    } catch (error: any) {
      // Close dialog with error message
      this.dialogRef.close({ success: false, error: error?.message || 'Failed to set golden slate ID' });
    } finally {
      this.saving = false;
    }
  }
}

