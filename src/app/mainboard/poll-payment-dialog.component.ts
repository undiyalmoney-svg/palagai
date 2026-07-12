import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface PollPaymentDialogData {
  onCancel: () => void;
  onContact: () => void;
}

@Component({
  selector: 'app-poll-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="payment-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">info</mat-icon>
        Board Type Restriction
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="info-message">
          <p class="main-message">
            <strong>Only one board you can use at a time.</strong>
          </p>
          <p class="sub-message">
            If you want multiple boards, please contact us.
          </p>
          <p class="contact-info">
            <mat-icon>email</mat-icon>
            <a href="mailto:palagaiofficial@gmail.com" class="email-link">palagaiofficial@gmail.com</a>
          </p>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button 
          mat-button 
          (click)="onCancel()" 
          class="cancel-btn"
        >
          Cancel
        </button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="onContact()" 
          class="contact-btn"
        >
          <mat-icon>email</mat-icon>
          Contact Us
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .payment-dialog-wrapper {
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
      color: #1976d2;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
    }

    .info-message {
      background: #e3f2fd;
      border: 1px solid #90caf9;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
    }

    .main-message {
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 500;
      color: #1976d2;
    }

    .main-message strong {
      font-weight: 600;
    }

    .sub-message {
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #555;
      line-height: 1.6;
    }

    .contact-info {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin: 0;
      padding-top: 12px;
      border-top: 1px solid #90caf9;
    }

    .contact-info mat-icon {
      color: #1976d2;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .email-link {
      color: #1976d2;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
    }

    .email-link:hover {
      text-decoration: underline;
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

    .contact-btn {
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .contact-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    @media (max-width: 600px) {
      .payment-dialog-wrapper {
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
      .contact-btn {
        width: 100%;
      }
    }
  `]
})
export class PollPaymentDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<PollPaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PollPaymentDialogData
  ) {}

  onCancel(): void {
    this.data.onCancel();
    this.dialogRef.close();
  }

  onContact(): void {
    this.data.onContact();
    this.dialogRef.close();
  }
}






