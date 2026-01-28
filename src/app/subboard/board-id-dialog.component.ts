import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

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
    <div class="board-id-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">dashboard</mat-icon>
        View Board
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <mat-form-field appearance="outline" class="board-id-field">
          <mat-label>Board ID</mat-label>
          <input
            matInput
            type="text"
            placeholder="e.g. PAL-26011347KQX"
            [formControl]="boardIdControl"
            (keyup.enter)="loadBoard()"
          />
          <mat-icon matSuffix>dashboard</mat-icon>
          <mat-error *ngIf="boardIdControl.hasError('required') && boardIdControl.touched">
            Board ID is required
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="email-field" *ngIf="showEmailInput">
          <mat-label>Email (for protected boards)</mat-label>
          <input
            matInput
            type="email"
            placeholder="Enter authorized email"
            [formControl]="emailControl"
            (keyup.enter)="loadBoard()"
          />
          <mat-icon matSuffix>email</mat-icon>
          <mat-hint>Required only for protected boards</mat-hint>
          <mat-error *ngIf="emailControl.hasError('email') && emailControl.touched">
            Please enter a valid email address
          </mat-error>
        </mat-form-field>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="cancel-btn">Cancel</button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="loadBoard()" 
          [disabled]="loading || boardIdControl.invalid || (showEmailInput && emailControl.invalid)"
          class="load-btn"
        >
          <mat-icon>{{ loading ? 'hourglass_empty' : 'search' }}</mat-icon>
          {{ loading ? 'Loading...' : 'Load Board' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .board-id-dialog-wrapper {
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
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .board-id-field,
    .email-field {
      width: 100%;
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

    .load-btn {
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    @media (max-width: 600px) {
      .board-id-dialog-wrapper {
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
      .load-btn {
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
    @Inject(MAT_DIALOG_DATA) public data: BoardIdDialogData
  ) {
    if (data?.boardId) {
      this.boardIdControl.setValue(data.boardId);
    }
    if (data?.email) {
      this.emailControl.setValue(data.email);
      this.showEmailInput = true;
    }
  }

  loadBoard() {
    if (this.boardIdControl.invalid || (this.showEmailInput && this.emailControl.invalid)) {
      return;
    }
    this.loading = true;
    this.dialogRef.close({
      boardId: this.boardIdControl.value?.trim() || '',
      email: this.emailControl.value?.trim() || '',
      showEmailInput: this.showEmailInput
    });
  }

  close() {
    this.dialogRef.close(null);
  }
}











