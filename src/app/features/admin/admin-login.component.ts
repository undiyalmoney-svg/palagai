import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="wrap">
      <h1>Admin</h1>
      <p>Separate from site login. Manage friends’ access.</p>
      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Admin username</mat-label>
          <input matInput formControlName="username" autocomplete="username" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Password</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>
        <button mat-flat-button color="primary" type="submit" [disabled]="busy()">Sign in</button>
      </form>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
    .wrap {
      box-sizing: border-box;
      min-height: 100dvh;
      max-width: 420px;
      margin: 0 auto;
      padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .full {
      width: 100%;
      display: block;
      margin-bottom: 0.75rem;
    }
    .err {
      color: #b42318;
    }
  `,
})
export class AdminLoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) return;
    this.busy.set(true);
    const { username, password } = this.form.getRawValue();
    const ok = await this.auth.adminLogin(username, password);
    this.busy.set(false);
    if (ok) {
      await this.router.navigateByUrl('/admin');
    } else {
      this.error.set('Invalid admin credentials');
    }
  }
}
