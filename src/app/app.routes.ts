import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { stashKiteRequestToken } from './core/kite/kite-request-token.util';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TradeDeskComponent } from './features/dashboard/trade-desk/trade-desk.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';
import { GetTokenComponent } from './features/dashboard/get-token/get-token.component';
import { SettingsComponent } from './features/dashboard/settings/settings.component';
import { CrudeOilDeskComponent } from './features/dashboard/crude-oil-desk/crude-oil-desk.component';
import { StocksDeskComponent } from './features/dashboard/stocks-desk/stocks-desk.component';
import { StrategyManagerPageComponent } from './features/dashboard/strategy-manager/strategy-manager-page.component';

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
        component: TradeDeskComponent,
      },
      {
        path: 'order-test',
        component: OrderTestComponent,
      },
      {
        path: 'crude-oil',
        component: CrudeOilDeskComponent,
      },
      {
        path: 'stocks',
        component: StocksDeskComponent,
      },
      {
        path: 'strategy-manager',
        component: StrategyManagerPageComponent,
      },
      {
        path: 'get-token',
        component: GetTokenComponent,
      },
      {
        path: 'settings',
        component: SettingsComponent,
      },
      // Removed tabs — keep old URLs from breaking
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
