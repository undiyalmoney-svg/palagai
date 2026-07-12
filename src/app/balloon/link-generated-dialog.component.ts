import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

export interface LinkGeneratedDialogData {
  url: string;
}

@Component({
  selector: 'app-link-generated-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="link-dialog-container">
      <div class="dialog-header">
        <div class="success-icon-wrapper">
          <mat-icon class="success-icon">check_circle</mat-icon>
        </div>
        <h2 mat-dialog-title class="dialog-title">Link Generated!</h2>
        <p class="dialog-subtitle">Share this link to reveal your secret 🎈</p>
      </div>

      <mat-dialog-content class="dialog-content">
        <div class="image-container">
          <img 
            src="/assets/balloon-success.png" 
            alt="Balloon Success" 
            class="success-image"
            onerror="this.style.display='none'"
          />
        </div>

        <div class="url-section">
          <div class="url-display">
            <input
              type="text"
              [value]="data.url"
              readonly
              class="url-input"
              #urlInput
              (click)="urlInput.select()"
            />
            <button
              mat-icon-button
              color="primary"
              (click)="copyToClipboard()"
              class="copy-btn"
              title="Copy to clipboard"
            >
              <mat-icon>content_copy</mat-icon>
            </button>
          </div>
          <p class="copy-hint">Click the link to select, or use the copy button</p>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-raised-button color="primary" (click)="copyToClipboard()" class="copy-button">
          <mat-icon>content_copy</mat-icon>
          <span>Copy Link</span>
        </button>
        <button mat-button (click)="close()" class="close-button">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .link-dialog-container {
      padding: 0;
      min-width: 400px;
      max-width: 500px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    }

    .dialog-header {
      text-align: center;
      padding: 20px 24px 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 8px 8px 0 0;
      flex-shrink: 0;
    }

    .success-icon-wrapper {
      margin-bottom: 12px;
      animation: scaleIn 0.5s ease;
    }

    @keyframes scaleIn {
      0% {
        transform: scale(0);
        opacity: 0;
      }
      50% {
        transform: scale(1.2);
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .success-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #4caf50;
      background: white;
      border-radius: 50%;
      padding: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      animation: pulse 2s ease infinite;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.05);
      }
    }

    .dialog-title {
      margin: 0 0 6px 0;
      font-size: 20px;
      font-weight: 700;
      color: white;
    }

    .dialog-subtitle {
      margin: 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
    }

    .dialog-content {
      padding: 16px 24px !important;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      box-sizing: border-box;
    }

    .image-container {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 0 auto;
      max-width: 200px;
      flex-shrink: 0;
    }

    .success-image {
      max-width: 100%;
      height: auto;
      max-height: 150px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      animation: fadeInUp 0.6s ease;
      object-fit: contain;
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .url-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .url-display {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .url-input {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      font-family: monospace;
      background: #f5f5f5;
      color: #333;
      transition: border-color 0.3s ease;
      cursor: text;
    }

    .url-input:focus {
      outline: none;
      border-color: #667eea;
    }

    .copy-btn {
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }

    .copy-btn:hover {
      transform: scale(1.1);
    }

    .copy-btn:active {
      transform: scale(0.95);
    }

    .copy-hint {
      margin: 0;
      font-size: 12px;
      color: #666;
      text-align: center;
    }

    .dialog-actions {
      padding: 12px 24px 20px 24px !important;
      margin: 0 !important;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }

    .copy-button {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .close-button {
      flex-shrink: 0;
    }

    @media (max-width: 600px) {
      .link-dialog-container {
        min-width: 0;
        width: 95vw;
        max-width: 95vw;
        max-height: 95vh;
        margin: 0 auto;
      }

      .dialog-header {
        padding: 16px 12px 10px 12px;
      }

      .success-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        padding: 5px;
      }

      .dialog-title {
        font-size: 18px;
        margin: 0 0 4px 0;
      }

      .dialog-subtitle {
        font-size: 12px;
      }

      .dialog-content {
        padding: 12px 12px !important;
        gap: 12px;
        min-height: auto;
        max-height: calc(95vh - 200px);
      }

      .image-container {
        max-width: 150px;
        margin: 0 auto;
      }

      .success-image {
        max-height: 120px;
      }

      .url-section {
        gap: 8px;
      }

      .url-display {
        flex-direction: row;
        gap: 6px;
        align-items: stretch;
      }

      .url-input {
        width: 100%;
        padding: 10px 12px;
        font-size: 12px;
        min-width: 0;
        flex: 1;
      }

      .copy-btn {
        flex-shrink: 0;
      }

      .copy-hint {
        font-size: 11px;
      }

      .dialog-actions {
        padding: 10px 12px 16px 12px !important;
        flex-direction: column;
        gap: 8px;
      }

      .copy-button,
      .close-button {
        width: 100%;
        margin: 0 !important;
      }

      .copy-button {
        padding: 10px 16px;
        font-size: 14px;
      }

      .close-button {
        padding: 8px 16px;
        font-size: 14px;
      }
    }
  `]
})
export class LinkGeneratedDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<LinkGeneratedDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: LinkGeneratedDialogData,
    private snackBar: MatSnackBar
  ) {}

  async copyToClipboard(): Promise<void> {
    if (!this.data.url) {
      return;
    }

    try {
      if (typeof window !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(this.data.url);
        this.snackBar.open('Link copied to clipboard!', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar']
        });
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = this.data.url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.snackBar.open('Link copied to clipboard!', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar']
        });
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      this.snackBar.open('Failed to copy. Please copy manually.', 'OK', {
        duration: 3000
      });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}

