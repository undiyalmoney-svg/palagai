import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { kiteSessionGuard } from './core/auth/kite-session.guard';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HistoricalTesterComponent } from './features/dashboard/historical-tester/historical-tester.component';
import { ResultsComponent } from './features/dashboard/results/results.component';
import { ResultDetailComponent } from './features/dashboard/results/result-detail/result-detail.component';
import { StrategiesComponent } from './features/dashboard/strategies/strategies.component';
import { TradeDeskComponent } from './features/dashboard/trade-desk/trade-desk.component';
import { GetTokenComponent } from './features/dashboard/get-token/get-token.component';
import { SettingsComponent } from './features/dashboard/settings/settings.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
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
        path: 'historical-tester',
        canActivate: [kiteSessionGuard],
        component: HistoricalTesterComponent,
      },
      {
        path: 'strategy',
        redirectTo: 'trade-desk',
        pathMatch: 'full',
      },
      {
        path: 'results',
        canActivate: [kiteSessionGuard],
        component: ResultsComponent,
      },
      {
        path: 'results/:id',
        canActivate: [kiteSessionGuard],
        component: ResultDetailComponent,
      },
      {
        path: 'strategies',
        canActivate: [kiteSessionGuard],
        component: StrategiesComponent,
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
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
