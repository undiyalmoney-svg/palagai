import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CompetitionAlertDialogData {
  onInterested: () => void;
  onNotInterested: () => void;
}

@Component({
  selector: 'app-competition-alert-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="competition-alert-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">favorite</mat-icon>
        Kavithai Competition
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="competition-info">
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
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button 
          mat-button 
          (click)="notInterested()" 
          class="not-interested-btn"
        >
          Not Interested
        </button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="interested()" 
          class="interested-btn"
        >
          <mat-icon>favorite</mat-icon>
          I'm Interested
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .competition-alert-dialog-wrapper {
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

    .info-text strong {
      color: #e91e63;
      font-weight: 600;
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

    .not-interested-btn {
      min-width: 120px;
    }

    .interested-btn {
      min-width: 160px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: #e91e63;
      color: white;
    }

    .interested-btn:hover:not(:disabled) {
      background: #c2185b;
    }

    @media (max-width: 600px) {
      .competition-alert-dialog-wrapper {
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

      .not-interested-btn,
      .interested-btn {
        width: 100%;
      }
    }
  `]
})
export class CompetitionAlertDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<CompetitionAlertDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CompetitionAlertDialogData
  ) {}

  interested() {
    this.data.onInterested();
    this.dialogRef.close();
  }

  notInterested() {
    this.data.onNotInterested();
    this.dialogRef.close();
  }
}



