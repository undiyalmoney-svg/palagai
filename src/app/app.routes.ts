import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  moduleGuard,
  adminGuard,
  dashboardIndexGuard,
} from './core/auth/auth.guard';
import { stashKiteRequestToken } from './core/kite/kite-request-token.util';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { DashboardHomeComponent } from './features/dashboard/dashboard-home.component';
import { TradeDeskComponent } from './features/dashboard/trade-desk/trade-desk.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';
import { GetTokenComponent } from './features/dashboard/get-token/get-token.component';
import { SettingsComponent } from './features/dashboard/settings/settings.component';
import { CrudeOilDeskComponent } from './features/dashboard/crude-oil-desk/crude-oil-desk.component';
import { AutoTraderComponent } from './features/dashboard/auto-trader/auto-trader.component';
import { PnlRecordsComponent } from './features/dashboard/pnl-records/pnl-records.component';
import { StrategyManagerPageComponent } from './features/dashboard/strategy-manager/strategy-manager-page.component';
import { VaultPageComponent } from './features/dashboard/vault/vault-page.component';
import { AdminLoginComponent } from './features/admin/admin-login.component';
import { AdminShellComponent } from './features/admin/admin-shell.component';
import { AdminPageComponent } from './features/admin/admin-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: ({ queryParams }) => {
      const requestToken = queryParams['request_token'];
      if (typeof requestToken === 'string' && requestToken.trim()) {
        stashKiteRequestToken(requestToken);
        return '/dashboard/get-token';
      }
      return '/login';
    },
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    component: LoginComponent,
  },
  {
    path: 'admin/login',
    component: AdminLoginComponent,
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    component: AdminShellComponent,
    children: [
      { path: '', pathMatch: 'full', component: AdminPageComponent },
      { path: 'vault', component: VaultPageComponent },
      { path: 'pnl', component: PnlRecordsComponent },
    ],
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    component: DashboardComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [dashboardIndexGuard],
        component: DashboardHomeComponent,
      },
      {
        path: 'home',
        component: DashboardHomeComponent,
      },
      {
        path: 'trade-desk',
        canActivate: [moduleGuard('trade')],
        component: TradeDeskComponent,
      },
      {
        path: 'order-test',
        component: OrderTestComponent,
      },
      { path: 'orders', redirectTo: '/admin/pnl', pathMatch: 'full' },
      { path: 'pnl-records', redirectTo: '/admin/pnl', pathMatch: 'full' },
      {
        path: 'crude-oil',
        canActivate: [moduleGuard('crude')],
        component: CrudeOilDeskComponent,
      },
      { path: 'stocks', redirectTo: 'auto-trader', pathMatch: 'full' },
      {
        path: 'auto-trader',
        canActivate: [moduleGuard('auto')],
        component: AutoTraderComponent,
      },
      {
        path: 'strategy-manager',
        canActivate: [moduleGuard('strat')],
        component: StrategyManagerPageComponent,
      },
      {
        path: 'get-token',
        canActivate: [moduleGuard('token')],
        component: GetTokenComponent,
      },
      { path: 'vault', redirectTo: '/admin/vault', pathMatch: 'full' },
      {
        path: 'settings',
        component: SettingsComponent,
      },
      { path: 'historical-tester', redirectTo: 'trade-desk', pathMatch: 'full' },
      { path: 'strategy', redirectTo: 'trade-desk', pathMatch: 'full' },
      { path: 'strategies', redirectTo: 'trade-desk', pathMatch: 'full' },
      { path: 'results', redirectTo: 'trade-desk', pathMatch: 'full' },
      { path: 'results/:id', redirectTo: 'trade-desk' },
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
