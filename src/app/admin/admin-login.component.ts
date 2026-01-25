import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '../admin.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { AlertService } from '../shared/alert.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatSnackBarModule,
    MatIconModule,
  ],
  templateUrl: './admin-login.component.html',
  styleUrl: './admin-login.component.css',
})
export class AdminLoginComponent {
  username = '';
  password = '';
  loading = false;
  hidePassword = true;

  constructor(
    private admin: AdminService,
    private router: Router,
    private snackBar: MatSnackBar,
    private alertService: AlertService
  ) {}

  async login() {
    if (!this.username.trim() || !this.password.trim()) {
      this.alertService.error('Please enter username and password');
      return;
    }

    this.loading = true;
    try {
      const success = await this.admin.login(this.username.trim(), this.password);
      if (success) {
        this.loading = false; // Reset loading BEFORE showing success message
        this.alertService.success('Login successful');
        await this.router.navigate(['/admin']);
      } else {
        this.loading = false; // Reset loading immediately
        // Show alert after ensuring UI updates
          Promise.resolve().then(() => {
          this.alertService.error('Invalid username or password');
        });
      }
    } catch (err: any) {
      console.error('Admin login error:', err);
      this.loading = false; // Reset loading immediately
      // Show alert after ensuring UI updates
        Promise.resolve().then(() => {
        this.alertService.error(err?.message || 'Login failed');
      });
    }
  }
}

