import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface PunchPreviewDialogData {
  message: string;
  icon: number;
}

@Component({
  selector: 'app-punch-preview-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="preview-dialog-container">
      <h2 mat-dialog-title class="dialog-title">Preview - Reveal Message</h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="preview-message-card">
          <div class="message-header">
            <img 
              [src]="'/assets/icon-' + data.icon + '.png'" 
              [alt]="'Selected Icon'"
              class="preview-icon"
            />
            <h2>Your Secret Message</h2>
          </div>
          <div class="message-content">
            <p>{{ data.message || 'Your secret message will appear here...' }}</p>
          </div>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="close-button">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .preview-dialog-container {
      padding: 0;
      min-width: 500px;
      max-width: 600px;
    }

    .dialog-title {
      margin: 0 0 20px 0;
      font-size: 20px;
      font-weight: 600;
      color: #333;
      text-align: center;
    }

    .dialog-content {
      padding: 0 !important;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 300px;
    }

    .preview-message-card {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 24px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      animation: cardGrow 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes cardGrow {
      0% {
        transform: scale(0.8);
        opacity: 0;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .message-header {
      margin-bottom: 24px;
    }

    .preview-icon {
      width: 64px;
      height: 64px;
      margin-bottom: 12px;
      object-fit: contain;
      animation: iconPulse 1s ease infinite;
    }

    @keyframes iconPulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    .message-header h2 {
      margin: 0;
      color: #333;
      font-size: 28px;
      font-weight: 700;
    }

    .message-content {
      margin-bottom: 0;
    }

    .message-content p {
      margin: 0;
      color: #555;
      font-size: 18px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .dialog-actions {
      padding: 16px 24px 24px 24px !important;
      margin: 0 !important;
      justify-content: center;
    }

    .close-button {
      min-width: 100px;
    }

    @media (max-width: 600px) {
      .preview-dialog-container {
        min-width: auto;
        max-width: 90vw;
      }

      .preview-message-card {
        padding: 24px;
      }

      .message-header h2 {
        font-size: 24px;
      }

      .message-content p {
        font-size: 16px;
      }
    }
  `]
})
export class PunchPreviewDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<PunchPreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PunchPreviewDialogData
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}



