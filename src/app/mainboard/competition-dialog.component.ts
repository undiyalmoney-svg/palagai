import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CompetitionDialogData {
  onSubmit: () => Promise<void>;
}

@Component({
  selector: 'app-competition-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="competition-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="heart-icon">favorite</mat-icon>
        Submit for Kavithai Competition
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="competition-info">
          <p class="info-text">
            This competition is for Valentine's Day. You can share your board too!
          </p>
          <p class="info-text">
            We will publish your Kavithai and get public votes. The Kavithai getting more votes will win ₹500 cash prize.
          </p>
        </div>
        <p class="confirmation-text">
          Are you sure you want to submit your Kavithai for this competition?
        </p>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="cancel-btn">Cancel</button>
        <button 
          mat-raised-button 
          color="primary" 
          (click)="submit()" 
          [disabled]="submitting"
          class="submit-btn"
        >
          <mat-icon>{{ submitting ? 'hourglass_empty' : 'favorite' }}</mat-icon>
          {{ submitting ? 'Submitting...' : 'Submit' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .competition-dialog-wrapper {
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

    .heart-icon {
      color: #e91e63;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
    }

    .competition-info {
      background: #fff5f8;
      border: 1px solid #ffc1d6;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .info-text {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #555;
      line-height: 1.6;
    }

    .info-text:last-child {
      margin-bottom: 0;
    }

    .confirmation-text {
      margin: 0;
      font-size: 15px;
      font-weight: 500;
      color: #111111;
      text-align: center;
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

    .submit-btn {
      min-width: 120px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: #e91e63;
      color: white;
    }

    .submit-btn:hover:not(:disabled) {
      background: #c2185b;
    }

    .submit-btn:disabled {
      opacity: 0.6;
    }

    @media (max-width: 600px) {
      .competition-dialog-wrapper {
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
      .submit-btn {
        width: 100%;
      }
    }
  `]
})
export class CompetitionDialogComponent {
  submitting = false;

  constructor(
    public dialogRef: MatDialogRef<CompetitionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CompetitionDialogData
  ) {}

  async submit() {
    this.submitting = true;
    try {
      await this.data.onSubmit();
      this.dialogRef.close(true);
    } catch (error) {
      // Error handling is done in the parent component
      this.submitting = false;
    }
  }

  close() {
    this.dialogRef.close(false);
  }
}



