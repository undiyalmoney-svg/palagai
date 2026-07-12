import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AUTH_CREDENTIALS, AUTH_SESSION_KEY } from './auth.constants';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authenticated = signal(this.readSession());

  readonly isAuthenticated = this.authenticated.asReadonly();

  login(username: string, password: string): boolean {
    const isValid =
      username === AUTH_CREDENTIALS.username && password === AUTH_CREDENTIALS.password;

    if (isValid) {
      this.persistSession(true);
      this.authenticated.set(true);
    }

    return isValid;
  }

  logout(): void {
    this.persistSession(false);
    this.authenticated.set(false);
  }

  private readSession(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    return sessionStorage.getItem(AUTH_SESSION_KEY) === 'true';
  }

  private persistSession(value: boolean): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (value) {
      sessionStorage.setItem(AUTH_SESSION_KEY, 'true');
    } else {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    }
  }
}
