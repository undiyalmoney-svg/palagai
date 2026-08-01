import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ADMIN_TOKEN_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  SiteModule,
  SiteUser,
} from './auth.constants';
import { KiteSessionService } from '../kite/kite-session.service';
import { KiteCredentialsService } from '../kite/kite-credentials.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly kiteCredentials = inject(KiteCredentialsService);
  private readonly apiBase = '/api/auth';

  private readonly authenticated = signal(false);
  private readonly user = signal<SiteUser | null>(null);
  private readonly adminAuthenticated = signal(false);

  readonly isAuthenticated = this.authenticated.asReadonly();
  readonly currentUser = this.user.asReadonly();

  constructor() {
    this.hydrate();
  }

  /** Devil (owner) vs customer (friend) helpers for UI copy. */
  isDevil(): boolean {
    return this.user()?.role === 'owner';
  }

  isCustomer(): boolean {
    const u = this.user();
    return !!u && u.role !== 'owner';
  }

  hasModule(mod: SiteModule): boolean {
    const u = this.user();
    if (!u) return false;
    if (u.role === 'owner') return true;
    return (u.modules || []).includes(mod);
  }

  getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  getAdminToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  }

  async login(username: string, password: string): Promise<
    { ok: true } | { ok: false; message: string; blocked?: boolean }
  > {
    const user = String(username || '').trim();
    const pass = String(password || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    try {
      const res = await firstValueFrom(
        this.http.post<{ status: string; token: string; user: SiteUser }>(
          `${this.apiBase}/login`,
          { username: user, password: pass },
        ),
      );
      if (!res?.token || !res?.user) {
        return { ok: false, message: 'Login failed — empty response from auth API' };
      }
      // Switching account (Devil ↔ customer): drop previous in-memory kite before binding.
      this.kiteSession.detach();
      this.kiteCredentials.detach();
      this.persistSite(res.token, res.user);
      return { ok: true };
    } catch (err: unknown) {
      const status = err instanceof HttpErrorResponse ? err.status : undefined;
      const body = err instanceof HttpErrorResponse ? err.error : null;
      const apiMsg =
        body && typeof body === 'object' && 'message' in body
          ? String((body as { message?: unknown }).message || '')
          : '';
      const code =
        body && typeof body === 'object' && 'code' in body
          ? String((body as { code?: unknown }).code || '')
          : '';
      if (code === 'BLOCKED' || status === 403) {
        return { ok: false, message: 'Contact admin', blocked: true };
      }
      return {
        ok: false,
        message: apiMsg || 'Invalid username or password',
      };
    }
  }

  async refreshMe(): Promise<boolean> {
    const token = this.getToken();
    if (!token) {
      this.logout();
      return false;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{ user: SiteUser }>(`${this.apiBase}/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      this.persistSite(token, res.user);
      return true;
    } catch {
      // Keep local session if API briefly unreachable — only clear on 401.
      return this.isAuthenticated();
    }
  }

  /** Force re-login when token is rejected. */
  async refreshMeStrict(): Promise<boolean> {
    const token = this.getToken();
    if (!token) {
      this.logout();
      return false;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{ user: SiteUser }>(`${this.apiBase}/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      this.persistSite(token, res.user);
      return true;
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        this.logout();
        return false;
      }
      return this.isAuthenticated();
    }
  }

  logout(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
    }
    this.authenticated.set(false);
    this.user.set(null);
    this.kiteSession.detach();
    this.kiteCredentials.detach();
  }

  async adminLogin(
    username: string,
    password: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const user = String(username || '').trim();
    const pass = String(password || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    try {
      const res = await firstValueFrom(
        this.http.post<{ status?: string; token?: string; message?: string }>(
          `${this.apiBase}/admin/login`,
          { username: user, password: pass },
        ),
      );
      if (!res?.token) {
        return {
          ok: false,
          message: 'Auth API returned no token — is Order-API /auth deployed?',
        };
      }
      this.persistAdmin(res.token);
      return { ok: true };
    } catch (err: unknown) {
      const status = err instanceof HttpErrorResponse ? err.status : undefined;
      const body = err instanceof HttpErrorResponse ? err.error : null;
      const apiMsg =
        typeof body === 'string'
          ? body
          : body && typeof body === 'object' && 'message' in body
            ? String((body as { message?: unknown }).message || '')
            : '';
      if (status === 401) {
        return { ok: false, message: apiMsg || 'Invalid admin credentials' };
      }
      if (status === 404 || status === 502 || status === 0) {
        return {
          ok: false,
          message:
            'Admin API unreachable. Pull+restart Order-API on droplet and wait for Vercel deploy.',
        };
      }
      return {
        ok: false,
        message: apiMsg || (err instanceof Error ? err.message : 'Admin login failed'),
      };
    }
  }

  adminLogout(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
    this.adminAuthenticated.set(false);
  }

  isAdminSession(): boolean {
    return this.adminAuthenticated() || !!this.getAdminToken();
  }

  private hydrate(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (localStorage.getItem(ADMIN_TOKEN_KEY)) {
      this.adminAuthenticated.set(true);
    }
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!token || !raw) {
      this.kiteSession.detach();
      this.kiteCredentials.detach();
      return;
    }
    try {
      const user = JSON.parse(raw) as SiteUser;
      this.authenticated.set(true);
      this.user.set(user);
      this.bindKiteForUser(user);
    } catch {
      this.logout();
    }
  }

  private persistAdmin(token: string): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    }
    this.adminAuthenticated.set(true);
  }

  private persistSite(token: string, user: SiteUser): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }
    this.authenticated.set(true);
    this.user.set(user);
    this.bindKiteForUser(user);
  }

  private bindKiteForUser(user: SiteUser): void {
    this.kiteSession.bindSiteUser(user.id);
    this.kiteCredentials.bindSiteUser(user.id);
  }
}
