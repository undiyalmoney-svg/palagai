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
          <a routerLink="/admin/vault" routerLinkActive="active">Vault</a>
          <a routerLink="/admin/pnl" routerLinkActive="active">P/L</a>
        </nav>
        <button type="button" class="logout" (click)="logout()">
          <app-pg-icon name="log-out" [size]="16" />
          Admin logout
        </button>
      </aside>
      <main>
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .shell {
      min-height: 100dvh;
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      background: var(--pg-bg);
      color: var(--pg-ink);
    }
    .sidebar {
      background: #fff;
      border-right: 1px solid var(--pg-line);
      padding: 1.15rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .brand {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      padding: 0.35rem 0.55rem 0.5rem;
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
      gap: 0.5rem;
      border: 1px solid var(--pg-line);
      background: #fff;
      border-radius: 12px;
      padding: 0.65rem 0.8rem;
      font: inherit;
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--pg-muted);
      cursor: pointer;
    }
    main {
      min-width: 0;
      padding: 1.25rem 1.5rem 2rem;
      max-width: var(--pg-content-max);
    }
    @media (max-width: 800px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: none;
        border-bottom: 1px solid var(--pg-line);
      }
      nav {
        flex-direction: row;
        flex-wrap: wrap;
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
      message: 'You will need to sign in again to manage users, vault, and P/L.',
      confirmLabel: 'Logout',
      cancelLabel: 'Stay',
    });
    if (!ok) return;
    this.auth.adminLogout();
    void this.router.navigateByUrl('/admin/login');
  }
}
