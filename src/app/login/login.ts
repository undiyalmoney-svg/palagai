import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { hashPassword, verifyPassword, validateEmail, validatePasswordStrength } from '../password.util';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatSnackBarModule,
    MatIconModule,
    MatCheckboxModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  email = '';
  password = '';
  message = '';
  loading = false;
  isSignUp = false; // Toggle between login and signup
  hidePassword = true; // Password visibility toggle - always hidden by default
  rememberMe = false; // Remember me checkbox

  constructor(
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
  ) {
    // Load last used email from local storage
    if (typeof window !== 'undefined') {
      try {
        const lastEmail = localStorage.getItem('palagai_last_email');
        if (lastEmail) {
          this.email = lastEmail;
        }
      } catch (e) {
        console.error('Error loading email from local storage:', e);
      }
    }
  }

  async submitEmail() {
    // Validate email
    if (!this.email || !this.email.trim()) {
      this.message = 'Please enter your email';
      this.snackBar.open('Please enter your email', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Validate email format
    if (!validateEmail(this.email)) {
      this.message = 'Please enter a valid email address';
      this.snackBar.open('Please enter a valid email address', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Validate password
    if (!this.password || !this.password.trim()) {
      this.message = 'Please enter your password';
      this.snackBar.open('Please enter your password', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Validate password strength for signup
    if (this.isSignUp) {
      const passwordValidation = validatePasswordStrength(this.password);
      if (!passwordValidation.isValid) {
        this.message = passwordValidation.error || 'Password is too weak';
        this.snackBar.open(passwordValidation.error || 'Password is too weak', 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
        return;
      }
    }

    this.loading = true;
    this.message = '';

    try {
      const normalizedEmail = this.email.trim().toLowerCase();
      
      // Step 1: Find existing user by email (one user per email)
      let record = await this.boards.findUserByEmail(normalizedEmail);
      
      if (!record) {
        // User not registered - sign up and create board
        if (!this.isSignUp) {
          throw new Error('User not found. Please sign up first.');
        }

        // Hash password before storing
        const passwordHash = await hashPassword(this.password);
        
        // Create user with password hash
        record = await this.boards.createUser(normalizedEmail, passwordHash);
        
        // Create board for new user
        const { boardKey, board } = await this.boards.createBoardForUser(record.uid);
        record.user.boardKey = boardKey;
        
        // Update user record with boardKey
        await this.boards.updateUserBoardKey(record.uid, boardKey);
        
        this.auth.setUser({
          uid: record.uid,
          email: record.user.email,
          boardKey: boardKey,
        });
        
        // Store email in local storage for auto-fill
        // Store boardKey in sessionStorage for subboard access
        if (typeof window !== 'undefined') {
          localStorage.setItem('palagai_last_email', normalizedEmail);
          sessionStorage.setItem('palagai_session_board_id', boardKey);
        }
        
        this.snackBar.open('Account created successfully. Redirecting to your board…', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
        
        await this.router.navigate(['/mainboard']);
        return;
      }

      // Step 2: User is registered - verify password
      const { uid, user } = record;
      
      // Check if user has a password hash (for existing users without password)
      if (!user.passwordHash) {
        if (this.isSignUp) {
          throw new Error('User already exists. Please log in instead.');
        } else {
          throw new Error('This account does not have a password set. Please contact support.');
        }
      }

      // Verify password
      const passwordValid = await verifyPassword(this.password, user.passwordHash);
      if (!passwordValid) {
        throw new Error('Invalid email or password');
      }

      // Step 3: Check if board exists
      let boardKey = user.boardKey;
      let boardContent = '';
      
      if (!boardKey) {
        // User registered but board not created - create board
        const { boardKey: newBoardKey, board } = await this.boards.createBoardForUser(uid);
        boardKey = newBoardKey;
        user.boardKey = newBoardKey;
        
        // Update user record with boardKey
        await this.boards.updateUserBoardKey(uid, newBoardKey);
      } else {
        // User registered and board created - load board content
        try {
          const board = await this.boards.getBoard(boardKey);
          if (board?.message?.html) {
            boardContent = board.message.html;
          }
        } catch (e) {
          // If board doesn't exist, create a new one
          const { boardKey: newBoardKey } = await this.boards.createBoardForUser(uid);
          boardKey = newBoardKey;
          user.boardKey = newBoardKey;
          await this.boards.updateUserBoardKey(uid, newBoardKey);
        }
      }

      this.auth.setUser({
        uid,
        email: user.email,
        boardKey: boardKey,
      });

      // Store email in local storage for auto-fill
      // Store boardKey in sessionStorage for subboard access
      if (typeof window !== 'undefined') {
        localStorage.setItem('palagai_last_email', normalizedEmail);
        sessionStorage.setItem('palagai_session_board_id', boardKey);
        if (boardContent) {
          localStorage.setItem(`palagai_board_${normalizedEmail}`, boardContent);
        }
      }

      this.snackBar.open('Login successful. Redirecting to your board…', 'OK', {
        duration: 2000,
        panelClass: ['success-snackbar'],
      });

      await this.router.navigate(['/mainboard']);
    } catch (err: any) {
      const errorMsg = err?.message || 'Something went wrong. Please try again.';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
      // Reset loading state so user can try again
      this.loading = false;
    }
  }

  onForgotPassword() {
    // TODO: Implement forgot password functionality
    this.snackBar.open('Forgot password feature coming soon. Please contact support if you need assistance.', 'OK', {
      duration: 4000,
      panelClass: ['info-snackbar'],
    });
  }
}
