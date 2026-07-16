import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { kiteSessionGuard } from './core/auth/kite-session.guard';
import { stashKiteRequestToken } from './core/kite/kite-request-token.util';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TradeDeskComponent } from './features/dashboard/trade-desk/trade-desk.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';
import { GetTokenComponent } from './features/dashboard/get-token/get-token.component';
import { SettingsComponent } from './features/dashboard/settings/settings.component';
import { CrudeOilDeskComponent } from './features/dashboard/crude-oil-desk/crude-oil-desk.component';

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
        canActivate: [kiteSessionGuard],
        component: TradeDeskComponent,
      },
      {
        path: 'order-test',
        canActivate: [kiteSessionGuard],
        component: OrderTestComponent,
      },
      {
        path: 'crude-oil',
        canActivate: [kiteSessionGuard],
        component: CrudeOilDeskComponent,
      },
      {
        path: 'get-token',
        component: GetTokenComponent,
      },
      {
        path: 'settings',
        canActivate: [kiteSessionGuard],
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
