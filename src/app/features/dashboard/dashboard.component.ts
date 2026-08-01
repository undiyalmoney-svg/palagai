import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SiteModule } from '../../core/auth/auth.constants';
import { PgIconComponent } from '../../shared/ui/icon/pg-icon.component';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';

interface NavItem {
  label: string;
  shortLabel: string;
  route: string;
  icon: string;
  module: SiteModule | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PgIconComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly uiDialog = inject(UiDialogService);
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private navSub: Subscription | null = null;

  protected readonly clockLabel = signal('');
  protected readonly pageTitle = signal('Trade Desk');
  protected readonly pageSubtitle = signal('Manage live trading, testing and paper trading.');
  protected readonly sidebarOpen = signal(false);
  protected readonly profileOpen = signal(false);

  private readonly allNav: NavItem[] = [
    {
      label: 'Trade',
      shortLabel: 'Trade',
      route: '/dashboard/trade-desk',
      icon: 'layout-dashboard',
      module: 'trade',
    },
    {
      label: 'Strategy',
      shortLabel: 'Strat',
      route: '/dashboard/strategy-manager',
      icon: 'sliders',
      module: 'strat',
    },
    {
      label: 'Crude',
      shortLabel: 'Crude',
      route: '/dashboard/crude-oil',
      icon: 'droplet',
      module: 'crude',
    },
    {
      label: 'Auto',
      shortLabel: 'Auto',
      route: '/dashboard/auto-trader',
      icon: 'bot',
      module: 'auto',
    },
    {
      label: 'Token',
      shortLabel: 'Token',
      route: '/dashboard/get-token',
      icon: 'key',
      module: 'token',
    },
  ];

  private readonly titles: Record<string, { title: string; subtitle: string }> = {
    '/dashboard/trade-desk': {
      title: 'Trade Desk',
      subtitle: 'Manage live trading, testing and paper trading from one place.',
    },
    '/dashboard/strategy-manager': {
      title: 'Strategy Manager',
      subtitle: 'Assign and configure strategies for paper and live desks.',
    },
    '/dashboard/crude-oil': {
      title: 'Crude Oil Mini',
      subtitle: 'MCX crude desk — testing and live paper in one place.',
    },
    '/dashboard/auto-trader': {
      title: 'Auto Trader',
      subtitle: 'Automated session runner with live order checks.',
    },
    '/dashboard/order-test': {
      title: 'Order Test',
      subtitle: 'Safe order probes against your connected Kite session.',
    },
    '/dashboard/get-token': {
      title: 'Get Token',
      subtitle: 'Connect Kite, copy redirect URLs, and refresh access tokens.',
    },
    '/dashboard/settings': {
      title: 'Settings',
      subtitle: 'Lots preference, instruments, and local data tools.',
    },
    '/dashboard/home': {
      title: 'Home',
      subtitle: 'Welcome to Palagai.',
    },
  };

  protected readonly navItems = computed(() =>
    this.allNav.filter((item) => item.module == null || this.authService.hasModule(item.module)),
  );

  protected readonly username = computed(
    () => this.authService.currentUser()?.username ?? 'User',
  );

  protected readonly liveBadge = computed(() => {
    const u = this.authService.currentUser();
    if (!u) return { label: 'Offline', tone: 'gray' as const };
    return { label: 'Signed in', tone: 'green' as const };
  });

  ngOnInit(): void {
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    this.syncTitle(this.router.url);
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.syncTitle(e.urlAfterRedirects);
        this.sidebarOpen.set(false);
        this.profileOpen.set(false);
      });
    void this.bootAuth();
  }

  private async bootAuth(): Promise<void> {
    const ok = await this.authService.refreshMeStrict();
    if (!ok) {
      void this.router.navigateByUrl('/login');
      return;
    }
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
    this.navSub?.unsubscribe();
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

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  protected toggleProfile(): void {
    this.profileOpen.update((v) => !v);
  }

  protected async logout(): Promise<void> {
    this.profileOpen.set(false);
    const ok = await this.uiDialog.confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to access the desk.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay',
      tone: 'default',
    });
    if (!ok) return;
    this.authService.logout();
    void this.router.navigate(['/login']);
  }

  private syncTitle(url: string): void {
    const path = url.replace(/\?.*$/, '').replace(/\/$/, '') || '/dashboard';
    const hit =
      this.titles[path] ??
      Object.entries(this.titles).find(([key]) => path.startsWith(key))?.[1];
    this.pageTitle.set(hit?.title ?? 'Palagai');
    this.pageSubtitle.set(hit?.subtitle ?? '');
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
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(now);
    this.clockLabel.set(`${date} · ${time} IST`);
  }
}
