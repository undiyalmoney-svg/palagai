import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ADMIN_TOKEN_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  SiteModule,
  SiteUser,
} from './auth.constants';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly apiBase = '/api/auth';

  private readonly authenticated = signal(false);
  private readonly user = signal<SiteUser | null>(null);

  readonly isAuthenticated = this.authenticated.asReadonly();
  readonly currentUser = this.user.asReadonly();

  constructor() {
    this.hydrate();
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
    try {
      const res = await firstValueFrom(
        this.http.post<{ status: string; token: string; user: SiteUser }>(
          `${this.apiBase}/login`,
          { username, password },
        ),
      );
      this.persistSite(res.token, res.user);
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { error?: { message?: string; code?: string }; status?: number };
      if (e?.error?.code === 'BLOCKED' || e?.status === 403) {
        return { ok: false, message: 'Contact admin', blocked: true };
      }
      return {
        ok: false,
        message: e?.error?.message || 'Invalid username or password',
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
  }

  async adminLogin(username: string, password: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ token: string }>(`${this.apiBase}/admin/login`, {
          username,
          password,
        }),
      );
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
      }
      return true;
    } catch {
      return false;
    }
  }

  adminLogout(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  }

  isAdminSession(): boolean {
    return !!this.getAdminToken();
  }

  private hydrate(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!token || !raw) return;
    try {
      const user = JSON.parse(raw) as SiteUser;
      this.authenticated.set(true);
      this.user.set(user);
    } catch {
      this.logout();
    }
  }

  private persistSite(token: string, user: SiteUser): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }
    this.authenticated.set(true);
    this.user.set(user);
  }
}
