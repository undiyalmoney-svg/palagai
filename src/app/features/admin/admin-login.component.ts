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
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <section class="wrap">
      <div class="card">
        <div class="mark">A</div>
        <h1>Admin portal</h1>
        <p>
          Create / block site users and set modules. This is
          <strong>not</strong> the trading desk login.
        </p>
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
            <mat-label>Admin password</mat-label>
            <input
              matInput
              type="text"
              formControlName="password"
              autocomplete="off"
              spellcheck="false"
              (paste)="onPaste($event)"
            />
          </mat-form-field>
          <button mat-flat-button color="primary" type="submit" class="submit" [disabled]="busy()">
            Admin sign in
          </button>
        </form>
      </div>
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
      align-items: center;
      justify-content: center;
      padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem;
      margin: 0;
      background: var(--pg-bg);
    }
    .card {
      width: min(100%, 420px);
      padding: 2rem 1.85rem;
      border-radius: 22px;
      border: 1px solid var(--pg-line);
      background: #fff;
      box-shadow: var(--pg-shadow);
      text-align: center;
    }
    .mark {
      width: 48px;
      height: 48px;
      margin: 0 auto 1rem;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: var(--pg-bull);
      color: #fff;
      font-weight: 800;
      font-size: 1.2rem;
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.45rem;
      letter-spacing: -0.03em;
    }
    p {
      color: var(--pg-muted);
      font-size: 0.9rem;
      margin: 0 0 1.25rem;
    }
    form {
      text-align: left;
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
    .submit {
      width: 100%;
      min-height: 48px;
      border-radius: 12px !important;
    }
    .err {
      color: var(--pg-bear-deep);
      white-space: pre-wrap;
      background: var(--pg-bear-soft);
      border: 1px solid #fecdd3;
      border-radius: 12px;
      padding: 0.75rem 1rem;
      text-align: left;
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
    username: ['Admin', Validators.required],
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
      await this.router.navigateByUrl('/admin', { replaceUrl: true });
    } else {
      this.error.set(result.message);
    }
  }
}
