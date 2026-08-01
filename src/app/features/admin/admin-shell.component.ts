import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule],
  template: `
    <div class="shell">
      <header class="bar">
        <div class="brand">
          <strong>Palagai Admin</strong>
          <nav>
            <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
              >Users</a
            >
            <a routerLink="/admin/vault" routerLinkActive="active">Vault</a>
            <a routerLink="/admin/pnl" routerLinkActive="active">P/L</a>
          </nav>
        </div>
        <button mat-stroked-button type="button" (click)="logout()">Admin logout</button>
      </header>
      <main>
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .shell {
      min-height: 100dvh;
      background: #f4faf7;
      color: #0c1f17;
    }
    .bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      padding: 0.85rem 1.25rem;
      background: #fff;
      border-bottom: 1px solid #dfeae4;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      flex-wrap: wrap;
    }
    nav {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    nav a {
      text-decoration: none;
      color: #5a6f66;
      font-weight: 600;
      padding: 0.35rem 0.55rem;
      border-radius: 8px;
    }
    nav a.active,
    nav a:hover {
      color: #0c1f17;
      background: #e8f5ef;
    }
    main {
      padding: 0;
    }
  `,
})
export class AdminShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected logout(): void {
    this.auth.adminLogout();
    void this.router.navigateByUrl('/admin/login');
  }
}
