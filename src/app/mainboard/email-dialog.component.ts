import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

export interface EmailDialogData {
  emails: string[];
  onAddEmail: (email: string) => Promise<void>;
  onRemoveEmail: (email: string) => Promise<void>;
}

@Component({
  selector: 'app-email-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="email-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">email</mat-icon>
        Authorized Email List
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="email-info">
          <p class="info-text">
            Only authorized emails can access this protected board. ({{ emails.length }}/50)
          </p>
        </div>

        <div class="email-input-section">
          <div class="form-group">
            <label for="email-input" class="input-label">Email Address</label>
            <mat-form-field appearance="outline" class="email-field">
              <input
                matInput
                id="email-input"
                type="email"
                [formControl]="emailControl"
                placeholder="Enter email address"
                (keyup.enter)="addEmail()"
              />
              <mat-icon matSuffix>person_add</mat-icon>
            </mat-form-field>
          </div>
        </div>

        <div class="email-list-section" *ngIf="emails.length > 0">
          <h3 class="list-title">Authorized Emails</h3>
          <div class="email-list">
            <div class="email-item" *ngFor="let email of emails; let i = index">
              <mat-icon class="email-icon">email</mat-icon>
              <span class="email-text">{{ email }}</span>
              <button
                mat-icon-button
                color="warn"
                (click)="removeEmail(email)"
                [disabled]="removingEmail === email"
                class="remove-btn"
                aria-label="Remove email"
                title="Remove email"
              >
                <mat-icon>{{ removingEmail === email ? 'hourglass_empty' : 'delete' }}</mat-icon>
              </button>
            </div>
          </div>
        </div>

        <div class="empty-state" *ngIf="emails.length === 0">
          <mat-icon class="empty-icon">inbox</mat-icon>
          <p class="empty-text">No authorized emails yet</p>
          <p class="empty-hint">Add emails to restrict board access</p>
        </div>

        <p class="error-message" *ngIf="errorMessage">{{ errorMessage }}</p>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button
          mat-raised-button
          color="primary"
          (click)="addEmail()"
          [disabled]="addingEmail || emails.length >= 50 || !emailControl.value?.trim() || emailControl.invalid"
          class="add-btn"
        >
          <mat-icon>{{ addingEmail ? 'hourglass_empty' : 'add' }}</mat-icon>
          {{ addingEmail ? 'Adding...' : 'Add Email' }}
        </button>
        <span class="spacer"></span>
        <button mat-button (click)="close()" class="close-btn">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .email-dialog-wrapper {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 420px;
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
      gap: 8px;
    }

    .title-icon {
      color: #666;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
      overflow-y: auto;
      max-height: 60vh;
      flex: 1;
    }

    .email-info {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
    }

    .info-text {
      margin: 0;
      font-size: 14px;
      color: #555;
    }

    .email-input-section {
      margin-bottom: 20px;
    }

    .form-group {
      width: 100%;
    }

    .input-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #111111;
      margin-bottom: 8px;
      padding-left: 2px;
      line-height: 1.4;
    }

    .email-field {
      width: 100%;
    }

    ::ng-deep .email-field .mat-mdc-form-field {
      width: 100%;
      margin-bottom: 0;
    }

    ::ng-deep .email-field .mat-mdc-text-field-wrapper {
      background-color: #ffffff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      transition: all 0.2s ease;
      padding: 0;
      margin: 0;
    }

    ::ng-deep .email-field .mat-mdc-form-field-infix {
      margin: 0 2% !important;
    }

    ::ng-deep .email-field .mat-mdc-text-field-wrapper:hover {
      border-color: #999999;
      background-color: #ffffff;
    }

    ::ng-deep .email-field .mat-mdc-text-field-wrapper.mdc-text-field--focused {
      border-color: #111111 !important;
      background-color: #ffffff !important;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
    }

    ::ng-deep .email-field .mat-mdc-form-field .mdc-notched-outline {
      display: none !important;
    }

    ::ng-deep .email-field .mat-mdc-form-field-label {
      display: none !important;
    }

    ::ng-deep .email-field .mdc-floating-label--float-above {
      display: none !important;
    }

    ::ng-deep .email-field .mat-mdc-form-field-input-control input {
      color: #111111;
      font-size: 15px;
      padding: 12px 48px 12px 16px;
      background: transparent;
      border: none;
      margin: 0;
      line-height: 1.4;
      vertical-align: middle;
    }

    ::ng-deep .email-field .mat-mdc-form-field-suffix {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      display: flex;
      align-items: center;
      z-index: 1;
    }

    ::ng-deep .email-field .mat-mdc-form-field-suffix mat-icon {
      color: #666;
      font-size: 20px;
      width: 20px;
      height: 20px;
      display: block;
    }

    ::ng-deep .email-field .mat-mdc-form-field-input-control input::placeholder {
      color: #999999;
      opacity: 0.8;
    }

    ::ng-deep .email-field .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .email-list-section {
      margin-top: 20px;
    }

    .list-title {
      font-size: 16px;
      font-weight: 600;
      color: #111111;
      margin: 0 0 12px 0;
    }

    .email-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 250px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .email-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      transition: all 0.2s ease;
    }

    .email-item:hover {
      background: #f0f0f0;
      border-color: #d0d0d0;
    }

    .email-icon {
      color: #666;
      font-size: 20px;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .email-text {
      flex: 1;
      font-size: 14px;
      color: #111111;
      word-break: break-all;
      min-width: 0;
    }

    .remove-btn {
      opacity: 0.7;
      transition: opacity 0.2s ease;
      flex-shrink: 0;
    }

    .remove-btn:hover {
      opacity: 1;
    }

    .empty-state {
      text-align: center;
      padding: 30px 20px;
      color: #999;
    }

    .empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #ccc;
      margin-bottom: 12px;
    }

    .empty-text {
      font-size: 16px;
      font-weight: 500;
      color: #666;
      margin: 0 0 6px 0;
    }

    .empty-hint {
      font-size: 14px;
      color: #999;
      margin: 0;
    }

    .error-message {
      color: #d32f2f;
      font-size: 14px;
      margin: 16px 0 0 0;
      padding: 8px 12px;
      background: #ffebee;
      border-radius: 4px;
      border-left: 3px solid #d32f2f;
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px 20px 20px !important;
      margin: 0 !important;
      min-height: auto;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .add-btn {
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .close-btn {
      min-width: 80px;
    }

    /* Scrollbar styling */
    .email-list::-webkit-scrollbar {
      width: 6px;
    }

    .email-list::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 3px;
    }

    .email-list::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 3px;
    }

    .email-list::-webkit-scrollbar-thumb:hover {
      background: #555;
    }

    .dialog-content::-webkit-scrollbar {
      width: 6px;
    }

    .dialog-content::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 3px;
    }

    .dialog-content::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 3px;
    }

    .dialog-content::-webkit-scrollbar-thumb:hover {
      background: #555;
    }

    @media (max-width: 600px) {
      .email-dialog-wrapper {
        max-width: 90vw;
      }

      .dialog-content {
        padding: 16px !important;
        max-height: 50vh;
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

      .add-btn {
        width: 100%;
      }

      .spacer {
        display: none;
      }
    }
  `]
})
export class EmailDialogComponent implements OnInit {
  emailControl = new FormControl<string | null>('', [Validators.required, Validators.email]);
  addingEmail = false;
  removingEmail: string | null = null;
  errorMessage = '';
  emails: string[] = [];

  constructor(
    public dialogRef: MatDialogRef<EmailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: EmailDialogData,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    // Initialize local emails array from data
    this.emails = [...this.data.emails];
    
    // Reset error message when email control changes
    this.emailControl.valueChanges.subscribe(() => {
      this.errorMessage = '';
    });
  }

  async addEmail() {
    const raw = this.emailControl.value?.trim();
    if (!raw || this.emailControl.invalid) {
      this.errorMessage = 'Please enter a valid email address';
      return;
    }

    if (this.emails.length >= 50) {
      this.errorMessage = 'Maximum 50 emails allowed';
      return;
    }

    const email = raw.toLowerCase();
    if (this.emails.includes(email)) {
      this.errorMessage = 'Email already exists in the list';
      return;
    }

    this.addingEmail = true;
    this.errorMessage = '';

    try {
      await this.data.onAddEmail(email);
      // Add email to local array immediately for instant display
      this.emails.push(email);
      this.emailControl.setValue('');
      this.snackBar.open('Email added successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      this.errorMessage = e?.message || 'Error adding email';
      this.snackBar.open(this.errorMessage, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.addingEmail = false;
    }
  }

  async removeEmail(email: string) {
    this.removingEmail = email;
    this.errorMessage = '';

    try {
      await this.data.onRemoveEmail(email);
      // Remove email from local array immediately for instant display
      const index = this.emails.indexOf(email);
      if (index > -1) {
        this.emails.splice(index, 1);
      }
      this.snackBar.open('Email removed successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      this.errorMessage = e?.message || 'Error removing email';
      this.snackBar.open(this.errorMessage, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.removingEmail = null;
    }
  }

  close() {
    this.dialogRef.close();
  }
}
