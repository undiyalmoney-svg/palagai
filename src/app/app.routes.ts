import { Routes } from '@angular/router';
import { authGuard, guestGuard, moduleGuard, adminGuard } from './core/auth/auth.guard';
import { stashKiteRequestToken } from './core/kite/kite-request-token.util';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
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
    component: AdminPageComponent,
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    component: DashboardComponent,
    children: [
      {
        path: '',
        redirectTo: 'trade-desk',
        pathMatch: 'full',
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
      { path: 'orders', redirectTo: 'pnl-records', pathMatch: 'full' },
      {
        path: 'pnl-records',
        canActivate: [moduleGuard('pnl')],
        component: PnlRecordsComponent,
      },
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
      {
        path: 'vault',
        canActivate: [moduleGuard('vault')],
        component: VaultPageComponent,
      },
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
