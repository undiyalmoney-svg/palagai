import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from '../../core/auth/auth.service';

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
export class DashboardComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly navItems = [
    { label: 'Trade Desk', shortLabel: 'Trade', route: '/dashboard/trade-desk', icon: 'calculate' },
    { label: 'Ruler / Stocks', shortLabel: 'Ruler', route: '/dashboard/strategy-manager', icon: 'tune' },
    { label: 'Crude Oil Mini', shortLabel: 'Crude', route: '/dashboard/crude-oil', icon: 'water_drop' },
    { label: 'Stocks Desk', shortLabel: 'Stocks', route: '/dashboard/stocks', icon: 'show_chart' },
    { label: 'Order Test', shortLabel: 'Orders', route: '/dashboard/order-test', icon: 'bolt' },
    { label: 'Get Token', shortLabel: 'Token', route: '/dashboard/get-token', icon: 'vpn_key' },
  ];

  /** Explicit navigate — more reliable than routerLink alone after SSR hydration. */
  protected go(route: string, event?: Event): void {
    event?.preventDefault();
    void this.router.navigateByUrl(route);
  }

  protected logout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }
}
