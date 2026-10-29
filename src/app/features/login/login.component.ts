import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
import { firstDashboardPath, safeDashboardReturnUrl } from '../../core/auth/auth.guard';

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
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly hidePassword = signal(true);

  protected readonly existingUser = computed(() => this.authService.currentUser());
  protected readonly existingLabel = computed(() => {
    const u = this.existingUser();
    if (!u) return '';
    if (u.role === 'owner') return `Devil (${u.username})`;
    return u.username;
  });

  protected readonly loginForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  constructor() {
    // Browser-only: SSR ngOnInit cannot read localStorage / navigate reliably.
    afterNextRender(() => {
      this.resumeKiteIfPossible();
      this.resumeDeskIfPossible();
    });
  }

  private resumeKiteIfPossible(): void {
    captureKiteRequestTokenFromLocation();
    this.authService.ensureHydratedFromStorage();
    if (this.authService.isAuthenticated() && peekKiteRequestToken()) {
      void this.router.navigateByUrl('/dashboard/get-token');
    }
  }

  /** Full-page desk clicks SSR-bounce to /login; localStorage still has the session. */
  private resumeDeskIfPossible(): void {
    this.authService.ensureHydratedFromStorage();
    if (!this.authService.isAuthenticated() || this.authService.isPublic()) return;
    if (peekKiteRequestToken()) {
      void this.router.navigateByUrl('/dashboard/get-token');
      return;
    }
    const dest = this.nextAfterAuth();
    if (dest === firstDashboardPath(this.authService) && !safeDashboardReturnUrl(this.returnUrl())) {
      return;
    }
    void this.router.navigateByUrl(dest);
  }

  private returnUrl(): string | null {
    return (
      this.route.snapshot.queryParamMap.get('returnUrl') ||
      new URLSearchParams(
        typeof window === 'undefined' ? '' : window.location.search,
      ).get('returnUrl')
    );
  }

  private nextAfterAuth(): string {
    if (peekKiteRequestToken()) return '/dashboard/get-token';
    return safeDashboardReturnUrl(this.returnUrl()) || firstDashboardPath(this.authService);
  }

  protected continueAsExisting(): void {
    void this.router.navigateByUrl(this.nextAfterAuth());
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
      await this.router.navigateByUrl(this.nextAfterAuth());
    } else {
      this.errorMessage.set(result.message);
    }

    this.isLoading.set(false);
  }
}
