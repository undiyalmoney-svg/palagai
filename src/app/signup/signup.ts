import { Component, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { BoardService } from '../board.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { hashPassword, validateEmail, validatePasswordStrength } from '../password.util';
import { AlertService } from '../shared/alert.service';

/**
 * Immutable UI state enum - single source of truth for all UI state
 * Prevents NG0100 errors and ensures UI never gets stuck
 */
type UIState = 'idle' | 'loading' | 'error';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatSnackBarModule,
    MatIconModule,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup implements OnInit, OnDestroy {
  signupForm: FormGroup;
  isSubmitting = false;
  hidePassword = true;
  
  // Security questions list
  securityQuestions = [
    'What was the name of your first pet?',
    'What city were you born in?',
    'What was your mother\'s maiden name?',
    'What was the name of your elementary school?',
    'What is your favorite movie?',
    'What was your childhood nickname?',
  ];

  constructor(
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly alertService: AlertService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    // Initialize reactive form
    this.signupForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      gender: ['', Validators.required],
      dateOfBirth: ['', Validators.required],
      securityQuestion: ['', Validators.required],
      securityAnswer: ['', Validators.required],
    });

    // Load last used email from local storage
    if (typeof window !== 'undefined') {
      try {
        const lastEmail = localStorage.getItem('palagai_last_email');
        if (lastEmail) {
          this.signupForm.patchValue({ email: lastEmail });
        }
      } catch (e) {
        console.error('Error loading email from local storage:', e);
      }
    }
  }

  ngOnInit() {
    // Prevent body scroll when signup component is active
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
  }

  ngOnDestroy() {
    // Restore body scroll when component is destroyed
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }

  private showAlert(message: string) {
    queueMicrotask(() => this.alertService.error(message));
  }

  async submitSignup() {
    this.signupForm.markAllAsTouched();
    
    if (this.signupForm.invalid || this.isSubmitting) {
      return;
    }

    // Additional password strength validation
    const password = this.signupForm.value.password!;
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      this.showAlert(passwordValidation.error || 'Password is too weak');
      return;
    }

    this.isSubmitting = true;
    this.cdr.detectChanges();

    try {
      const email = this.signupForm.value.email!.trim().toLowerCase();
      const passwordHash = await hashPassword(password);
      const gender = this.signupForm.value.gender!;
      const dateOfBirth = this.signupForm.value.dateOfBirth as Date;
      const securityQuestion = this.signupForm.value.securityQuestion!;
      const securityAnswer = this.signupForm.value.securityAnswer!.trim();
      const securityAnswerHash = await hashPassword(securityAnswer.toLowerCase());
      
      // Check RTDB for user by email
      console.log('[Signup] Checking RTDB for user with email:', email);
      const existingRecord = await this.boards.findUserByEmail(email);
      
      if (existingRecord) {
        this.showAlert('User already exists. Please log in instead.');
        return;
      }

      // Create user with password hash and additional data in RTDB
      const record = await this.boards.createUser(email, passwordHash, {
        gender: gender,
        dateOfBirth: dateOfBirth.toISOString().split('T')[0], // Format as YYYY-MM-DD
        securityQuestion: securityQuestion,
        securityAnswerHash: securityAnswerHash,
      });
      console.log('[Signup] User created in RTDB with UID:', record.uid);
      
      // Create board for new user
      const { boardKey } = await this.boards.createBoardForUser(record.uid);
      await this.boards.updateUserBoardKey(record.uid, boardKey);
      console.log('[Signup] Board created with key:', boardKey);
      
      // Set user in auth service
      this.auth.setUser({
        uid: record.uid,
        email: record.user.email,
        boardKey: boardKey,
      });
      
      // Store email in local storage for auto-fill
      if (typeof window !== 'undefined') {
        localStorage.setItem('palagai_last_email', email);
        sessionStorage.setItem('palagai_session_board_id', boardKey);
      }
      
      this.alertService.success('Account created successfully. Redirecting to your board…');
      await this.router.navigate(['/mainboard']);
    } catch (err: any) {
      console.error('Signup Error:', err);
      this.showAlert(err?.message || 'Something went wrong. Please try again.');
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }
}

