import { Component, inject, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);

  protected readonly sidenav = viewChild.required(MatSidenav);

  protected readonly isHandset = toSignal(
    this.breakpointObserver.observe(Breakpoints.Handset).pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  protected readonly navItems = [
    { label: 'Trade Desk', route: '/dashboard/trade-desk', icon: 'calculate' },
    { label: 'Historical Tester', route: '/dashboard/historical-tester', icon: 'play_circle' },
    { label: 'Results', route: '/dashboard/results', icon: 'assessment' },
    { label: 'Strategy', route: '/dashboard/strategies', icon: 'insights' },
    { label: 'Get Token', route: '/dashboard/get-token', icon: 'vpn_key' },
    { label: 'Settings', route: '/dashboard/settings', icon: 'settings' },
  ];

  protected toggleSidenav(): void {
    this.sidenav().toggle();
  }

  protected closeSidenavOnNavigate(): void {
    if (this.isHandset()) {
      this.sidenav().close();
    }
  }

  protected logout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }
}
