import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';
import {
  captureKiteRequestTokenFromLocation,
  peekKiteRequestToken,
} from '../../core/kite/kite-request-token.util';
import { firstDashboardPath } from '../../core/auth/auth.guard';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly hidePassword = signal(true);

  protected readonly existingUser = computed(() => this.authService.currentUser());
  protected readonly existingLabel = computed(() => {
    const u = this.existingUser();
    if (!u) return '';
    return u.role === 'owner' ? `Devil (${u.username})` : `Customer (${u.username})`;
  });

  protected readonly loginForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  constructor() {
    // Browser-only: SSR ngOnInit cannot read localStorage / navigate reliably.
    afterNextRender(() => {
      this.resumeKiteIfPossible();
    });
  }

  private resumeKiteIfPossible(): void {
    captureKiteRequestTokenFromLocation();
    this.authService.ensureHydratedFromStorage();
    if (this.authService.isAuthenticated() && peekKiteRequestToken()) {
      void this.router.navigateByUrl('/dashboard/get-token');
    }
  }

  protected continueAsExisting(): void {
    if (peekKiteRequestToken()) {
      void this.router.navigateByUrl('/dashboard/get-token');
      return;
    }
    void this.router.navigateByUrl(firstDashboardPath(this.authService));
  }

  protected switchUser(): void {
    this.authService.logout();
    this.errorMessage.set('');
    this.loginForm.reset();
  }

  protected async onSubmit(): Promise<void> {
    this.errorMessage.set('');

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { username, password } = this.loginForm.getRawValue();
    this.isLoading.set(true);

    // Always replace any previous site session (Devil → customer or vice versa).
    if (this.authService.isAuthenticated()) {
      this.authService.logout();
    }

    const result = await this.authService.login(username, password);

    if (result.ok) {
      await this.authService.refreshMe();
      const u = this.authService.currentUser();
      let next = ['/dashboard/trade-desk'];
      if (peekKiteRequestToken()) {
        next = ['/dashboard/get-token'];
      } else if (u && !this.authService.hasModule('trade')) {
        if (this.authService.hasModule('crude')) next = ['/dashboard/crude-oil'];
        else if (this.authService.hasModule('auto')) next = ['/dashboard/auto-trader'];
        else if (this.authService.hasModule('test')) next = ['/dashboard/order-test'];
        else if (this.authService.hasModule('token')) next = ['/dashboard/get-token'];
      }
      await this.router.navigate(next);
    } else {
      this.errorMessage.set(result.message);
    }

    this.isLoading.set(false);
  }
}
