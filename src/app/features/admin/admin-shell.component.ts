import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { PgIconComponent } from '../../shared/ui/icon/pg-icon.component';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PgIconComponent],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="mark">A</span>
          <div>
            <strong>Palagai Admin</strong>
            <small>Control plane</small>
          </div>
        </div>
        <nav>
          <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            Users
          </a>
          <a routerLink="/admin/actions" routerLinkActive="active">Actions</a>
          <a routerLink="/admin/payments" routerLinkActive="active">Payments</a>
          <a routerLink="/admin/vault" routerLinkActive="active">Vault</a>
          <a routerLink="/admin/pnl" routerLinkActive="active">P/L</a>
        </nav>
        <button type="button" class="logout side-logout" (click)="logout()">
          <app-pg-icon name="log-out" [size]="16" />
          Logout
        </button>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div>
            <h1>Admin</h1>
            <p>Manage Devil, customers, actions, payments, vault and P/L</p>
          </div>
          <button type="button" class="logout top-logout" (click)="logout()">
            <app-pg-icon name="log-out" [size]="16" />
            Logout
          </button>
        </header>
        <main>
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
    .shell {
      min-height: 100dvh;
      display: block;
      background: var(--pg-bg);
      color: var(--pg-ink);
    }
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 220px;
      background: #fff;
      border-right: 1px solid var(--pg-line);
      padding: 1.15rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      overflow: hidden;
      z-index: 100;
      box-sizing: border-box;
    }
    .workspace {
      min-width: 0;
      min-height: 100dvh;
      margin-left: 220px;
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      padding: 0.35rem 0.55rem 0.5rem;
      flex-shrink: 0;
    }
    .mark {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: var(--pg-bull);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 800;
    }
    .brand strong {
      display: block;
      font-size: 0.92rem;
      letter-spacing: -0.02em;
    }
    .brand small {
      color: var(--pg-muted);
      font-size: 0.7rem;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;
      min-height: 0;
    }
    nav a {
      text-decoration: none;
      color: var(--pg-muted);
      font-weight: 600;
      font-size: 0.875rem;
      padding: 0.6rem 0.8rem;
      border-radius: 12px;
    }
    nav a.active,
    nav a:hover {
      color: var(--pg-bull-deep);
      background: var(--pg-bull-soft);
    }
    .logout {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      border: 1px solid #fecdd3;
      background: #fff;
      border-radius: 12px;
      padding: 0.65rem 0.9rem;
      font: inherit;
      font-weight: 650;
      font-size: 0.85rem;
      color: var(--pg-bear-deep);
      cursor: pointer;
      flex-shrink: 0;
    }
    .logout:hover {
      background: var(--pg-bear-soft);
    }
    .side-logout {
      width: 100%;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.95rem 1.5rem;
      background: #fff;
      border-bottom: 1px solid var(--pg-line);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .topbar h1 {
      margin: 0;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }
    .topbar p {
      margin: 0.15rem 0 0;
      font-size: 0.8rem;
      color: var(--pg-muted);
    }
    main {
      min-width: 0;
      padding: 1.25rem 1.5rem 2rem;
      max-width: none;
    }
    @media (max-width: 800px) {
      .sidebar {
        position: sticky;
        top: 0;
        width: 100%;
        height: auto;
        bottom: auto;
        border-right: none;
        border-bottom: 1px solid var(--pg-line);
        overflow: visible;
      }
      .workspace {
        margin-left: 0;
      }
      nav {
        flex-direction: row;
        flex-wrap: wrap;
      }
      .side-logout {
        width: auto;
      }
      .topbar p {
        display: none;
      }
    }
  `,
})
export class AdminShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly uiDialog = inject(UiDialogService);

  protected async logout(): Promise<void> {
    const ok = await this.uiDialog.confirm({
      title: 'Admin logout?',
      message: 'You will need to sign in again to manage Devil, customers, vault, and P/L.',
      confirmLabel: 'Logout',
      cancelLabel: 'Stay',
    });
    if (!ok) return;
    this.auth.adminLogout();
    void this.router.navigateByUrl('/admin/login');
  }
}
