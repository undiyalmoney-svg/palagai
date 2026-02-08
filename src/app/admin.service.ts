import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BoardService } from './board.service';
import { hashPassword, verifyPassword } from './password.util';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private readonly ADMIN_SESSION_KEY = 'palagai_admin_session';

  constructor(
    private boards: BoardService,
    private router: Router
  ) {}

  /**
   * Check if admin is logged in
   */
  isAdminLoggedIn(): boolean {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(this.ADMIN_SESSION_KEY) === 'true';
  }

  /**
   * Login as admin
   */
  async login(username: string, password: string): Promise<boolean> {
    try {
      const adminCreds = await this.boards.getAdminCredentials();
      
      if (!adminCreds) {
        // First time setup - create admin account
        if (username && password) {
          const passwordHash = await hashPassword(password);
          await this.boards.setAdminCredentials(username, passwordHash);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(this.ADMIN_SESSION_KEY, 'true');
          }
          return true;
        }
        return false;
      }

      // Verify credentials
      if (adminCreds.username !== username) {
        return false;
      }

      const isValid = await verifyPassword(password, adminCreds.passwordHash);
      if (isValid && typeof window !== 'undefined') {
        sessionStorage.setItem(this.ADMIN_SESSION_KEY, 'true');
      }
      return isValid;
    } catch (err) {
      console.error('Admin login error:', err);
      return false;
    }
  }

  /**
   * Logout admin
   */
  logout(): void {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(this.ADMIN_SESSION_KEY);
    }
    this.router.navigate(['/']);
  }

  /**
   * Require admin login (guard)
   */
  requireAdmin(): boolean {
    if (!this.isAdminLoggedIn()) {
      this.router.navigate(['/admin/login']);
      return false;
    }
    return true;
  }
}
















