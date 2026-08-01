import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  template: `
    <section class="wrap">
      <h1>Admin</h1>
      <p>Separate from site login. Username: <strong>angel</strong></p>
      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" autocomplete="off">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Admin username</mat-label>
          <input
            matInput
            formControlName="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Password</mat-label>
          <input
            matInput
            [type]="hide() ? 'password' : 'text'"
            formControlName="password"
            autocomplete="current-password"
            (paste)="onPaste($event)"
          />
          <button
            mat-icon-button
            matSuffix
            type="button"
            (click)="hide.set(!hide())"
            [attr.aria-label]="hide() ? 'Show password' : 'Hide password'"
          >
            <mat-icon>{{ hide() ? 'visibility' : 'visibility_off' }}</mat-icon>
          </button>
        </mat-form-field>
        <button mat-flat-button color="primary" type="submit" [disabled]="busy()">Sign in</button>
      </form>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .wrap {
      position: fixed;
      inset: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem;
      margin: 0;
      max-width: none;
      width: 100%;
    }
    .wrap > * {
      width: min(100%, 420px);
    }
    .full {
      width: 100%;
      display: block;
      margin-bottom: 0.75rem;
    }
    .full input {
      user-select: text;
      -webkit-user-select: text;
    }
    .err {
      color: #b42318;
      white-space: pre-wrap;
    }
  `,
})
export class AdminLoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly hide = signal(true);
  protected readonly form = this.fb.nonNullable.group({
    username: ['angel', Validators.required],
    password: ['', Validators.required],
  });

  protected onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text');
    if (text == null) return;
    event.preventDefault();
    this.form.controls.password.setValue(text.replace(/^\uFEFF/, '').trim());
    this.form.controls.password.markAsDirty();
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) return;
    this.busy.set(true);
    const { username, password } = this.form.getRawValue();
    const result = await this.auth.adminLogin(username, password);
    this.busy.set(false);
    if (result.ok) {
      await this.router.navigateByUrl('/admin');
    } else {
      this.error.set(result.message);
    }
  }
}
