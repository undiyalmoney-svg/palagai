import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth.service';

export interface BoardIdDialogData {
  boardId?: string;
  email?: string;
}

@Component({
  selector: 'app-board-id-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title>View Board</h2>
      
      <mat-dialog-content>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Board ID</mat-label>
          <input
            matInput
            type="text"
            placeholder="e.g. PAL-26011347KQX"
            [formControl]="boardIdControl"
            (keyup.enter)="onLoad()"
            autocomplete="off"
          />
          <button
            mat-icon-button
            matSuffix
            type="button"
            (click)="clearBoardId()"
            *ngIf="boardIdControl.value"
            class="clear-button"
            aria-label="Clear"
            tabindex="-1"
          >
            <mat-icon class="clear-icon">close</mat-icon>
          </button>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width" *ngIf="showEmailInput">
          <mat-label>Email (for protected boards)</mat-label>
          <input
            matInput
            type="email"
            placeholder="Enter authorized email"
            [formControl]="emailControl"
            (keyup.enter)="onLoad()"
            autocomplete="email"
          />
          <mat-icon matSuffix>email</mat-icon>
          <mat-hint>Required only for protected boards</mat-hint>
          <mat-error *ngIf="emailControl.hasError('email') && emailControl.touched">
            Please enter a valid email address
          </mat-error>
        </mat-form-field>
      </mat-dialog-content>
      
      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()" type="button">Cancel</button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="onLoad()" 
          type="button"
          [disabled]="loading || boardIdControl.invalid || (showEmailInput && emailControl.invalid)"
          class="load-board-btn"
        >
          <span class="button-content">
            <mat-icon *ngIf="!loading">search</mat-icon>
            <mat-icon *ngIf="loading" class="spinning">hourglass_empty</mat-icon>
            <span class="button-text">{{ loading ? 'Loading...' : 'Load Board' }}</span>
          </span>
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container {
      min-width: 400px;
      max-width: 500px;
    }

    mat-dialog-content {
      padding: 20px 24px !important;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .full-width {
      width: 100%;
    }

    .clear-button {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      padding: 0 !important;
      margin: 0 !important;
      line-height: 1 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative;
      z-index: 1;
    }

    .clear-button .clear-icon {
      font-size: 20px !important;
      width: 20px !important;
      height: 20px !important;
      line-height: 20px !important;
      color: rgba(0, 0, 0, 0.54) !important;
    }

    .clear-button:hover .clear-icon {
      color: rgba(0, 0, 0, 0.87) !important;
    }

    ::ng-deep .mat-mdc-form-field-icon-suffix {
      padding-right: 0 !important;
    }

    ::ng-deep .mat-mdc-form-field-icon-suffix .clear-button {
      margin-right: 8px;
    }

    mat-dialog-actions {
      padding: 8px 24px 16px 24px !important;
      margin: 0 !important;
    }

    mat-dialog-actions button {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .load-board-btn {
      min-width: 140px;
    }

    .load-board-btn .button-content {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      flex-direction: row !important;
    }

    .load-board-btn .button-text {
      display: inline-block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    .load-board-btn[disabled] .button-text {
      opacity: 0.6;
    }

    .load-board-btn mat-icon {
      display: inline-block !important;
      visibility: visible !important;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 600px) {
      .dialog-container {
        min-width: auto;
        max-width: 90vw;
      }

      mat-dialog-content {
        padding: 16px !important;
      }

      mat-dialog-actions {
        padding: 8px 16px 16px 16px !important;
        flex-direction: column-reverse;
      }

      mat-dialog-actions button {
        width: 100%;
      }
    }
  `]
})
export class BoardIdDialogComponent {
  boardIdControl = new FormControl<string>('', [Validators.required]);
  emailControl = new FormControl<string>('', [Validators.email]);
  showEmailInput = false;
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<BoardIdDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BoardIdDialogData,
    private auth: AuthService
  ) {
    // Pre-fill board ID if provided
    if (data?.boardId) {
      this.boardIdControl.setValue(data.boardId);
    } else if (typeof window !== 'undefined') {
      // Try to get from sessionStorage
      try {
        const sessionBoardId = sessionStorage.getItem('palagai_session_board_id');
        if (sessionBoardId) {
          this.boardIdControl.setValue(sessionBoardId);
        } else if (this.auth.user?.boardKey) {
          this.boardIdControl.setValue(this.auth.user.boardKey);
        }
      } catch (e) {
        console.error('Error reading storage:', e);
      }
    }
    
    if (data?.email) {
      this.emailControl.setValue(data.email);
      this.showEmailInput = true;
    }
  }

  clearBoardId() {
    this.boardIdControl.setValue('');
    this.boardIdControl.markAsUntouched();
  }

  onLoad() {
    if (this.loading || this.boardIdControl.invalid || (this.showEmailInput && this.emailControl.invalid)) {
      return;
    }

    this.loading = true;
    const result = {
      boardId: this.boardIdControl.value?.trim() || '',
      email: this.emailControl.value?.trim() || '',
      showEmailInput: this.showEmailInput
    };
    this.dialogRef.close(result);
  }

  onCancel() {
    this.dialogRef.close(null);
  }
}
