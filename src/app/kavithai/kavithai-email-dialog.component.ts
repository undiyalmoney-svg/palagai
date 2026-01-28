import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface KavithaiEmailDialogData {
  email?: string;
}

@Component({
  selector: 'app-kavithai-email-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="email-dialog-container">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon>email</mat-icon>
        Email Address Required
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="info-message">
          <mat-icon class="info-icon">info</mat-icon>
          <p>
            <strong>Important:</strong> This email will be used for distributing the cash prize if your kavithai wins.
            Please make sure it's correct.
          </p>
        </div>
        
        <form [formGroup]="emailForm">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Email Address</mat-label>
            <input matInput type="email" formControlName="email" placeholder="your.email@example.com" required />
            <mat-icon matPrefix>email</mat-icon>
            <mat-error *ngIf="emailControl.hasError('required')">
              Email is required
            </mat-error>
            <mat-error *ngIf="emailControl.hasError('email')">
              Please enter a valid email address
            </mat-error>
          </mat-form-field>
        </form>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="onCancel()" class="cancel-btn">
          Cancel
        </button>
        <button mat-raised-button color="primary" (click)="onSubmit()" [disabled]="emailForm.invalid" class="submit-btn">
          <mat-icon>check</mat-icon>
          Confirm & Submit
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .email-dialog-container {
      padding: 0;
      min-width: 400px;
      max-width: 500px;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 24px;
      font-weight: 600;
      color: #1976d2;
      margin: 0 0 8px 0;
      padding: 24px 24px 16px 24px;
    }

    .dialog-title mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .dialog-content {
      padding: 0 24px 24px 24px;
    }

    .info-message {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      background: #e3f2fd;
      border-radius: 8px;
      margin-bottom: 24px;
      border-left: 4px solid #1976d2;
    }

    .info-icon {
      color: #1976d2;
      font-size: 24px;
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .info-message p {
      margin: 0;
      font-size: 14px;
      line-height: 1.6;
      color: #1976d2;
    }

    .info-message strong {
      font-weight: 600;
      display: block;
      margin-bottom: 4px;
    }

    .full-width {
      width: 100%;
    }

    .dialog-actions {
      padding: 16px 24px 24px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin: 0;
    }

    .cancel-btn {
      color: #666;
    }

    .submit-btn {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .submit-btn mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    @media (max-width: 600px) {
      .email-dialog-container {
        min-width: unset;
        max-width: 90vw;
      }

      .dialog-title {
        font-size: 20px;
        padding: 20px 20px 12px 20px;
      }

      .dialog-content {
        padding: 0 20px 20px 20px;
      }

      .info-message {
        padding: 12px;
        margin-bottom: 20px;
      }

      .info-message p {
        font-size: 13px;
      }

      .dialog-actions {
        padding: 12px 20px 20px 20px;
        flex-direction: column-reverse;
      }

      .cancel-btn,
      .submit-btn {
        width: 100%;
      }
    }
  `],
})
export class KavithaiEmailDialogComponent {
  emailForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<KavithaiEmailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: KavithaiEmailDialogData
  ) {
    this.emailForm = this.fb.group({
      email: [data?.email || '', [Validators.required, Validators.email]],
    });
  }

  get emailControl(): FormControl<string | null> {
    return this.emailForm.get('email') as FormControl<string | null>;
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSubmit(): void {
    if (this.emailForm.valid) {
      this.dialogRef.close(this.emailControl.value);
    }
  }
}


