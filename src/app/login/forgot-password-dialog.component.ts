import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BoardService } from '../board.service';
import { AlertService } from '../shared/alert.service';
import { hashPassword, verifyPassword } from '../password.util';

export interface ForgotPasswordDialogData {
  email: string;
}

@Component({
  selector: 'app-forgot-password-dialog',
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
    <div class="forgot-password-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">lock_reset</mat-icon>
        Reset Password
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div *ngIf="errorMessage" class="error-message">
          <span>{{ errorMessage }}</span>
        </div>
        
        <div [formGroup]="form">
          <div *ngIf="step === 'email'" class="step-content">
            <p class="info-text">Enter your email address to receive your security question.</p>
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="email" placeholder="Enter your email" />
                <mat-error *ngIf="form.controls['email'].errors?.['required']">
                  Email is required
                </mat-error>
                <mat-error *ngIf="form.controls['email'].errors?.['email']">
                  Enter a valid email
                </mat-error>
              </mat-form-field>
            </div>
          </div>

          <div *ngIf="step === 'security'" class="step-content">
            <p class="info-text">Answer your security question to reset your password.</p>
            <div class="security-question">
              <strong>{{ securityQuestion }}</strong>
            </div>
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="securityAnswer" placeholder="Enter your answer" />
                <mat-error *ngIf="form.controls['securityAnswer'].errors?.['required']">
                  Answer is required
                </mat-error>
              </mat-form-field>
            </div>
          </div>

          <div *ngIf="step === 'reset'" class="step-content">
            <p class="info-text">Enter your new password.</p>
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <input
                  matInput
                  [type]="hidePassword ? 'password' : 'text'"
                  formControlName="newPassword"
                  placeholder="Enter new password"
                  (input)="checkPasswordMatch()"
                />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="hidePassword = !hidePassword"
                  tabindex="-1"
                >
                  <mat-icon>{{ hidePassword ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                <mat-hint>Password must be at least 6 characters long</mat-hint>
                <mat-error *ngIf="form.controls['newPassword'].errors?.['required']">
                  Password is required
                </mat-error>
                <mat-error *ngIf="form.controls['newPassword'].errors?.['minlength']">
                  Password must be at least 6 characters
                </mat-error>
              </mat-form-field>
            </div>
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <input
                  matInput
                  [type]="hidePassword ? 'password' : 'text'"
                  formControlName="confirmPassword"
                  placeholder="Confirm new password"
                  (input)="checkPasswordMatch()"
                />
                <mat-error *ngIf="form.controls['confirmPassword'].errors?.['required']">
                  Please confirm your password
                </mat-error>
                <mat-error *ngIf="form.hasError('passwordMismatch')">
                  Passwords do not match
                </mat-error>
              </mat-form-field>
            </div>
          </div>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="cancel-btn">Cancel</button>
        <button
          mat-raised-button
          color="primary"
          (click)="nextStep()"
          [disabled]="isSubmitting || !isCurrentStepValid()"
          class="submit-btn"
        >
          <mat-icon>{{ isSubmitting ? 'hourglass_empty' : (step === 'reset' ? 'lock_reset' : 'arrow_forward') }}</mat-icon>
          {{ isSubmitting ? 'Processing...' : (step === 'reset' ? 'Reset Password' : 'Next') }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .forgot-password-dialog-wrapper {
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
      color: #4285f4;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
    }

    .step-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .info-text {
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #555;
      line-height: 1.6;
    }

    .error-message {
      background: #ffebee;
      border: 1px solid #ef5350;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      color: #c62828;
      font-size: 14px;
    }

    .security-question {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 8px;
      font-size: 15px;
      color: #111111;
    }

    .form-group {
      width: 100%;
    }

    .full-width {
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

    .submit-btn {
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    @media (max-width: 600px) {
      .forgot-password-dialog-wrapper {
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
export class ForgotPasswordDialogComponent {
  step: 'email' | 'security' | 'reset' = 'email';
  form!: FormGroup;
  securityQuestion = '';
  hidePassword = true;
  isSubmitting = false;
  userUid = '';
  errorMessage = '';

  constructor(
    public dialogRef: MatDialogRef<ForgotPasswordDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ForgotPasswordDialogData,
    private fb: FormBuilder,
    private boards: BoardService,
    private alertService: AlertService
  ) {
    this.form = this.fb.group({
      email: [data?.email || '', [Validators.required, Validators.email]],
      securityAnswer: ['', []],
      newPassword: ['', []],
      confirmPassword: ['', []],
    }, { validators: this.passwordMatchValidator });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('newPassword');
    const confirmPassword = form.get('confirmPassword');
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
    } else if (confirmPassword && confirmPassword.hasError('passwordMismatch')) {
      confirmPassword.setErrors(null);
    }
    return null;
  }

  isCurrentStepValid(): boolean {
    if (this.step === 'email') {
      const emailControl = this.form.get('email');
      return emailControl ? emailControl.valid : false;
    } else if (this.step === 'security') {
      const answerControl = this.form.get('securityAnswer');
      return answerControl ? answerControl.valid : false;
    } else if (this.step === 'reset') {
      return this.form.valid;
    }
    return false;
  }

  private setError(message: string) {
    queueMicrotask(() => {
      this.errorMessage = message;
    });
  }

  private clearError() {
    this.errorMessage = '';
  }

  checkPasswordMatch() {
    if (this.step !== 'reset') return;
    
    const newPassword = this.form.get('newPassword')?.value || '';
    const confirmPassword = this.form.get('confirmPassword')?.value || '';
    
    queueMicrotask(() => {
      if (confirmPassword && newPassword && newPassword !== confirmPassword) {
        this.setError('Passwords do not match. Please make sure both passwords are the same.');
      } else if (confirmPassword && newPassword && newPassword === confirmPassword) {
        this.clearError();
      }
    });
  }

  async nextStep() {
    if (!this.isCurrentStepValid() || this.isSubmitting) return;

    this.clearError();
    this.isSubmitting = true;

    try {
      if (this.step === 'email') {
        const email = this.form.value.email!.trim().toLowerCase();
        const record = await this.boards.findUserByEmail(email);
        
        if (!record) {
          this.setError('User not found. Please check your email address.');
          return;
        }

        if (!record.user.securityQuestion || !record.user.securityAnswerHash) {
          this.setError('Security question not set for this account. Please contact support.');
          return;
        }

        this.userUid = record.uid;
        this.securityQuestion = record.user.securityQuestion;
        this.step = 'security';
        this.form.patchValue({ email: email });
        this.form.get('securityAnswer')?.setValidators([Validators.required]);
        this.form.get('securityAnswer')?.updateValueAndValidity();
        this.clearError();
      } else if (this.step === 'security') {
        const answer = this.form.value.securityAnswer!.trim();
        if (!answer) {
          this.setError('Please enter your security answer.');
          return;
        }

        const record = await this.boards.findUserByEmail(this.form.value.email!);
        
        if (!record || !record.user.securityAnswerHash) {
          this.setError('Invalid security answer.');
          return;
        }

        const valid = await verifyPassword(answer.toLowerCase(), record.user.securityAnswerHash);
        if (!valid) {
          this.setError('Incorrect answer. Please try again.');
          this.form.get('securityAnswer')?.setValue('');
          this.form.get('securityAnswer')?.markAsUntouched();
          return;
        }

        this.step = 'reset';
        this.form.get('newPassword')?.setValidators([Validators.required, Validators.minLength(6)]);
        this.form.get('newPassword')?.updateValueAndValidity();
        this.form.get('confirmPassword')?.setValidators([Validators.required]);
        this.form.get('confirmPassword')?.updateValueAndValidity();
        this.clearError();
      } else if (this.step === 'reset') {
        const newPassword = this.form.value.newPassword!;
        const confirmPassword = this.form.value.confirmPassword!;
        
        if (!newPassword || newPassword.length < 6) {
          this.setError('Password must be at least 6 characters long.');
          return;
        }

        if (newPassword !== confirmPassword) {
          this.setError('Passwords do not match. Please make sure both passwords are the same.');
          return;
        }

        const passwordHash = await hashPassword(newPassword);
        await this.boards.updateUserPassword(this.userUid, passwordHash);
        
        queueMicrotask(() => {
          this.alertService.success('Password reset successfully! You can now log in with your new password.');
        });
        this.dialogRef.close('passwordResetSuccess');
        return;
      }
    } catch (err: any) {
      console.error('Forgot Password Error:', err);
      this.setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      queueMicrotask(() => {
        this.isSubmitting = false;
      });
    }
  }

  close() {
    this.dialogRef.close(false);
  }
}

