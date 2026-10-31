import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  moduleGuard,
  adminGuard,
  dashboardIndexGuard,
} from './core/auth/auth.guard';
import { stashKiteRequestToken } from './core/kite/kite-request-token.util';
import { KiteCallbackComponent } from './features/kite-callback/kite-callback.component';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { DashboardHomeComponent } from './features/dashboard/dashboard-home.component';
import { Paper14kComponent } from './features/dashboard/paper-14k/paper-14k.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';
import { HistoricalBacktestComponent } from './features/dashboard/historical-backtest/historical-backtest.component';
import { GetTokenComponent } from './features/dashboard/get-token/get-token.component';
import { CrudeBestComponent } from './features/dashboard/crude-best/crude-best.component';
import { CrudeOilComponent } from './features/dashboard/crude-oil/crude-oil.component';
import { SettingsComponent } from './features/dashboard/settings/settings.component';
import { PnlRecordsComponent } from './features/dashboard/pnl-records/pnl-records.component';
import { VaultPageComponent } from './features/dashboard/vault/vault-page.component';
import { AdminLoginComponent } from './features/admin/admin-login.component';
import { AdminShellComponent } from './features/admin/admin-shell.component';
import { AdminPageComponent } from './features/admin/admin-page.component';
import { AdminActionsPageComponent } from './features/admin/admin-actions-page.component';
import { AdminPaymentsPageComponent } from './features/admin/admin-payments-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: ({ queryParams }) => {
      const raw = queryParams['request_token'];
      const requestToken = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim();
      if (requestToken) {
        stashKiteRequestToken(requestToken);
        return `/kite-callback?request_token=${encodeURIComponent(requestToken)}`;
      }
      return '/login';
    },
  },
  {
    path: 'kite-callback',
    component: KiteCallbackComponent,
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    component: LoginComponent,
  },
  {
    path: 'heatmap',
    redirectTo: 'login',
    pathMatch: 'full',
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
      { path: 'actions', component: AdminActionsPageComponent },
      { path: 'payments', component: AdminPaymentsPageComponent },
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
        path: 'historical-backtest',
        canActivate: [moduleGuard('backtest')],
        component: HistoricalBacktestComponent,
      },
      {
        path: 'crude-best',
        canActivate: [moduleGuard('crude')],
        component: CrudeBestComponent,
      },
      {
        path: 'crude-oil',
        canActivate: [moduleGuard('crude')],
        component: CrudeOilComponent,
      },
      { path: 'momentum', redirectTo: 'get-token', pathMatch: 'prefix' },
      { path: 'research', redirectTo: 'get-token', pathMatch: 'full' },
      { path: 'charts', redirectTo: 'get-token', pathMatch: 'full' },
      { path: 'sl-buddy', redirectTo: 'get-token', pathMatch: 'full' },
      {
        path: 'paper-14k',
        canActivate: [moduleGuard('test')],
        component: Paper14kComponent,
      },
      {
        path: 'order-test',
        canActivate: [moduleGuard('test')],
        component: OrderTestComponent,
      },
      {
        path: 'sr-breakout',
        redirectTo: 'get-token',
        pathMatch: 'full',
      },
      { path: 'orders', redirectTo: '/admin/pnl', pathMatch: 'full' },
      { path: 'pnl-records', redirectTo: '/admin/pnl', pathMatch: 'full' },
      {
        path: 'auto-trader',
        redirectTo: 'get-token',
        pathMatch: 'full',
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
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
