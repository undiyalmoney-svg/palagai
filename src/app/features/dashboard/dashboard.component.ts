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
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../core/auth/auth.service';
import { SiteModule } from '../../core/auth/auth.constants';
import { PgIconComponent } from '../../shared/ui/icon/pg-icon.component';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { KiteFundsService } from '../../core/services/kite-funds.service';

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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PgIconComponent, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly uiDialog = inject(UiDialogService);
  protected readonly kiteFunds = inject(KiteFundsService);
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private navSub: Subscription | null = null;

  protected readonly clockLabel = signal('');
  protected readonly pageTitle = signal('Palagai');
  protected readonly pageSubtitle = signal('Trade Bot, Token, and Test.');
  protected readonly sidebarOpen = signal(true);
  protected readonly profileOpen = signal(false);

  private readonly allNav: NavItem[] = [
    {
      label: 'Trade Bot',
      shortLabel: 'Bot',
      route: '/dashboard/trade-bot',
      icon: 'bot',
      module: 'auto',
    },
    {
      label: 'Test',
      shortLabel: 'Test',
      route: '/dashboard/order-test',
      icon: 'flask',
      module: 'test',
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
    '/dashboard/trade-bot': {
      title: 'Trade Bot',
      subtitle: 'Kite funds on this bar. Pick dates, then Run paper.',
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

  /** Bottom tab bar on phone/tablet — Token stays in the side menu only. */
  protected readonly mobileTabItems = computed(() =>
    this.navItems().filter((item) => item.route !== '/dashboard/get-token'),
  );

  protected readonly username = computed(() => {
    const u = this.authService.currentUser();
    if (!u) return 'User';
    return u.role === 'owner' ? `Devil · ${u.username}` : u.username;
  });

  protected readonly adminNotice = computed(() =>
    String(this.authService.currentUser()?.adminMessage || '').trim(),
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
    if (this.isMobileViewport()) {
      this.sidebarOpen.set(false);
    }
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.syncTitle(e.urlAfterRedirects);
        // Only auto-close the drawer on mobile; desktop collapse is user-controlled.
        if (this.isMobileViewport()) {
          this.sidebarOpen.set(false);
        }
        this.profileOpen.set(false);
      });
    void this.bootAuth();
  }

  private async bootAuth(): Promise<void> {
    const { peekKiteRequestToken } = await import('../../core/kite/kite-request-token.util');
    const onGetToken = this.router.url.includes('/dashboard/get-token');
    const pendingKite = !!peekKiteRequestToken();

    this.authService.ensureHydratedFromStorage();

    // Get Token / mid-OAuth: never bounce to login (consume race used to trip this).
    if (onGetToken || pendingKite) {
      await this.authService.refreshMe();
      void this.kiteFunds.refresh();
      if (pendingKite && !onGetToken) {
        void this.router.navigateByUrl('/dashboard/get-token');
      }
      return;
    }

    const ok = await this.authService.refreshMeStrict();
    if (!ok) {
      void this.router.navigateByUrl('/login');
      return;
    }
    void this.kiteFunds.refresh();
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

  protected dismissNotice(): void {
    void this.authService.dismissAdminMessage();
  }

  private isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches;
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
