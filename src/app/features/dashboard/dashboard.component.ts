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
    { label: 'Trade Desk', route: '/dashboard/trade-desk', icon: 'calculate' },
    { label: 'Crude Oil Mini', route: '/dashboard/crude-oil', icon: 'oil_barrel' },
    { label: 'Order Test', route: '/dashboard/order-test', icon: 'bolt' },
    { label: 'Get Token', route: '/dashboard/get-token', icon: 'vpn_key' },
    { label: 'Settings', route: '/dashboard/settings', icon: 'settings' },
  ];

  protected logout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }
}
