import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { AuthService } from '../auth.service';
import { BoardService } from '../board.service';
import { AlertService } from '../shared/alert.service';
import { verifyPassword } from '../password.util';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDialogModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  hidePassword = true;
  isSubmitting = false;
  loginForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private boards: BoardService,
    private auth: AuthService,
    private alertService: AlertService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {
    this.loginForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });

    if (typeof window !== 'undefined') {
      const lastEmail = localStorage.getItem('palagai_last_email');
      if (lastEmail) {
        this.loginForm.patchValue({ email: lastEmail });
      }
    }
  }

  async onSubmit() {
    if (this.loginForm.invalid || this.isSubmitting) return;

    this.isSubmitting = true;
    this.cdr.detectChanges(); // Update UI to "disabled" state immediately

    try {
      const email = this.loginForm.value.email!.trim().toLowerCase();
      const password = this.loginForm.value.password!;

      const record = await this.boards.findUserByEmail(email);
      
      if (!record) {
        this.showAlert('User not found. Please sign up first.');
        return;
      }

      const valid = await verifyPassword(password, record.user.passwordHash || '');
      if (!valid) {
        this.showAlert('Email or password is incorrect.');
        return;
      }

      // Success logic
      this.auth.setUser({ uid: record.uid, email: record.user.email, boardKey: record.user.boardKey });
      localStorage.setItem('palagai_last_email', email);
      this.alertService.success('Login successful. Redirecting…');
      await this.router.navigate(['/mainboard']);

    } catch (err) {
      this.showAlert('Something went wrong. Please try again.');
    } finally {
      // ✅ Critical fix: resetting state and forcing change detection
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  private showAlert(message: string) {
    // NG0100 Fix: Use a timeout so the alert doesn't interrupt the render cycle
    setTimeout(() => this.alertService.error(message), 0);
  }

  async onForgotPassword() {
    // This dynamic import fixes both JIT error and the "Unused Component" warning
    const { ForgotPasswordDialogComponent } = await import('./forgot-password-dialog.component');
    
    this.dialog.open(ForgotPasswordDialogComponent, {
      width: '400px',
      data: { email: this.loginForm.value.email },
    });
  }
}