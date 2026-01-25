import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CompetitionDialogData {
  isSubmitted?: boolean;
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
        <mat-icon class="heart-icon">{{ data.isSubmitted ? 'favorite' : 'favorite_border' }}</mat-icon>
        {{ data.isSubmitted ? 'Remove from Competition' : 'Submit for Kavithai Competition' }}
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="competition-info" *ngIf="!data.isSubmitted">
          <p class="topic-text">
            <strong>Topic:</strong> என்னவள்
          </p>
          <p class="info-text">
            This competition is for <strong>Valentine's Day</strong>. You can share your board too!
          </p>
          <p class="info-text">
            We will publish your Kavithai and get public votes. The Kavithai getting more votes will win <strong>₹500 cash prize</strong>.
          </p>
          <p class="info-text">
            <strong>Hit the heart icon</strong> to submit your kavithai to the competition.
          </p>
          <p class="info-text">
            You can submit your kavithai in <strong>Tamil</strong>, <strong>English</strong>, or even <strong>Thanglish</strong>!
          </p>
          <p class="info-text">
            Competition ends on <strong>28th Feb</strong>. For any queries send email to <strong>palagaiofficial@gmail.com</strong>.
          </p>
        </div>
        <div class="rules-section" *ngIf="!data.isSubmitted">
          <p class="rules-title">Make sure your kavithai following these rules:</p>
          <ul class="rules-list">
            <li>Not copying from anywhere outside</li>
            <li>Only own contents is allowed</li>
          </ul>
        </div>
        <p class="confirmation-text">
          {{ data.isSubmitted 
            ? 'Are you sure you want to remove your Kavithai from the competition?' 
            : 'Are you sure you want to submit your Kavithai for this competition?' }}
        </p>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="cancel-btn">Cancel</button>
        <button 
          mat-raised-button 
          [color]="data.isSubmitted ? 'warn' : 'primary'"
          (click)="submit()" 
          [disabled]="submitting"
          class="submit-btn"
          [class.remove-btn]="data.isSubmitted"
        >
          <mat-icon>{{ submitting ? 'hourglass_empty' : (data.isSubmitted ? 'favorite_border' : 'favorite') }}</mat-icon>
          {{ submitting ? (data.isSubmitted ? 'Removing...' : 'Submitting...') : (data.isSubmitted ? 'Remove' : 'Submit') }}
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

    .topic-text {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #e91e63;
      padding-bottom: 12px;
      border-bottom: 2px solid #ffc1d6;
    }

    .topic-text strong {
      color: #c2185b;
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

    .rules-section {
      background: #fff3e0;
      border: 1px solid #ffb74d;
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
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

    .submit-btn.remove-btn {
      background: #f44336;
    }

    .submit-btn.remove-btn:hover:not(:disabled) {
      background: #d32f2f;
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








