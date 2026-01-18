import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-link-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Share Your Board</h2>
    <mat-dialog-content>
      <div class="input-group">
        <label class="input-label">Board ID</label>
        <div class="link-container">
          <input 
            type="text" 
            [value]="data.boardId" 
            readonly 
            class="link-input"
            #boardIdInput
          />
          <button 
            mat-icon-button 
            (click)="copyBoardId()"
            aria-label="Copy Board ID"
            title="Copy Board ID"
          >
            <mat-icon>content_copy</mat-icon>
          </button>
        </div>
      </div>
      <div class="input-group">
        <label class="input-label">Shareable Link</label>
        <div class="link-container">
          <input 
            type="text" 
            [value]="data.link" 
            readonly 
            class="link-input"
            #linkInput
          />
          <button 
            mat-icon-button 
            (click)="copyLink()"
            aria-label="Copy link"
            title="Copy link"
          >
            <mat-icon>content_copy</mat-icon>
          </button>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .input-group {
      margin-bottom: 24px;
    }

    .input-group:last-child {
      margin-bottom: 0;
    }

    .input-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #111111;
      margin-bottom: 8px;
    }

    .link-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .link-input {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #e5e5e5;
      border-radius: 8px;
      font-size: 14px;
      background: #fafafa;
      color: #111111;
      font-family: monospace;
    }

    .link-input:focus {
      outline: none;
      border-color: #b19cd9;
      background: #ffffff;
    }

    h2 {
      margin: 0 0 8px 0;
      font-size: 20px;
      font-weight: 600;
      color: #111111;
    }

    mat-dialog-content {
      padding: 20px 24px;
    }

    mat-dialog-actions {
      padding: 8px 24px 20px;
    }
  `]
})
export class LinkDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<LinkDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { link: string; boardId: string },
    private snackBar: MatSnackBar
  ) {}

  copyLink() {
    // SSR-safe: Check for browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.data.link).then(() => {
        this.snackBar.open('Link copied to clipboard!', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }).catch(() => {
        this.fallbackCopy(this.data.link, 'Link copied to clipboard!', 'Failed to copy link');
      });
    } else {
      this.fallbackCopy(this.data.link, 'Link copied to clipboard!', 'Failed to copy link');
    }
  }

  copyBoardId() {
    // SSR-safe: Check for browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.data.boardId).then(() => {
        this.snackBar.open('Board ID copied to clipboard!', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }).catch(() => {
        this.fallbackCopy(this.data.boardId, 'Board ID copied to clipboard!', 'Failed to copy Board ID');
      });
    } else {
      this.fallbackCopy(this.data.boardId, 'Board ID copied to clipboard!', 'Failed to copy Board ID');
    }
  }

  private fallbackCopy(text: string, successMessage: string = 'Copied to clipboard!', errorMessage: string = 'Failed to copy') {
    // SSR-safe: Check for browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      this.snackBar.open(successMessage, 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (err) {
      this.snackBar.open(errorMessage, 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
    }
    document.body.removeChild(textArea);
  }

  close() {
    this.dialogRef.close();
  }
}

