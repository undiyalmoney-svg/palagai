import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from '../../core/auth/auth.service';
import { SiteModule } from '../../core/auth/auth.constants';

interface NavItem {
  label: string;
  shortLabel: string;
  route: string;
  icon: string;
  module: SiteModule;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly clockLabel = signal('');

  private readonly allNav: NavItem[] = [
    { label: 'Trade Desk', shortLabel: 'Trade', route: '/dashboard/trade-desk', icon: 'calculate', module: 'trade' },
    { label: 'Strategy Manager', shortLabel: 'Strat', route: '/dashboard/strategy-manager', icon: 'tune', module: 'strat' },
    { label: 'Crude Oil Mini', shortLabel: 'Crude', route: '/dashboard/crude-oil', icon: 'water_drop', module: 'crude' },
    { label: 'Auto Trader', shortLabel: 'Auto', route: '/dashboard/auto-trader', icon: 'smart_toy', module: 'auto' },
    { label: 'Get Token', shortLabel: 'Token', route: '/dashboard/get-token', icon: 'vpn_key', module: 'token' },
  ];

  protected readonly navItems = computed(() =>
    this.allNav.filter((item) => this.authService.hasModule(item.module)),
  );

  ngOnInit(): void {
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    void this.bootAuth();
  }

  private async bootAuth(): Promise<void> {
    const ok = await this.authService.refreshMeStrict();
    if (!ok) {
      void this.router.navigateByUrl('/login');
      return;
    }
    // If somehow landed with empty outlet path, go to first desk.
    const url = this.router.url.replace(/\?.*$/, '');
    if (url === '/dashboard' || url === '/dashboard/') {
      const { firstDashboardPath } = await import('../../core/auth/auth.guard');
      void this.router.navigateByUrl(firstDashboardPath(this.authService));
    }
  }

  ngOnDestroy(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  protected go(route: string, event?: Event): void {
    event?.preventDefault();
    void this.router.navigateByUrl(route);
  }

  protected goHome(event?: Event): void {
    event?.preventDefault();
    void import('../../core/auth/auth.guard').then(({ firstDashboardPath }) => {
      void this.router.navigateByUrl(firstDashboardPath(this.authService));
    });
  }

  protected logout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }

  private tickClock(): void {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(now);
    const time = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    this.clockLabel.set(`${date} · ${time} IST`);
  }
}
