import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { MomentumShellComponent } from './momentum-shell.component';
import { MomentumStateService } from './momentum-state.service';

/** Live Trading exists only while a broker session is configured. */
const liveTradingGuard: CanActivateFn = async () => {
  const state = inject(MomentumStateService);
  const router = inject(Router);
  const status = state.status() ?? (await state.refreshStatus());
  return status?.broker.configured ? true : router.parseUrl('/dashboard/momentum/settings');
};

export const MOMENTUM_ROUTES: Routes = [
  {
    path: '',
    component: MomentumShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./tabs/dashboard-tab.component').then((m) => m.DashboardTabComponent),
      },
      {
        path: 'screener',
        loadComponent: () => import('./tabs/screener-tab.component').then((m) => m.ScreenerTabComponent),
      },
      {
        path: 'portfolio',
        loadComponent: () => import('./tabs/portfolio-tab.component').then((m) => m.PortfolioTabComponent),
      },
      {
        path: 'decision-center',
        loadComponent: () => import('./tabs/decision-center-tab.component').then((m) => m.DecisionCenterTabComponent),
      },
      {
        path: 'backtest',
        loadComponent: () => import('./tabs/backtest-tab.component').then((m) => m.BacktestTabComponent),
      },
      {
        path: 'strategy-lab',
        loadComponent: () => import('./tabs/strategy-lab-tab.component').then((m) => m.StrategyLabTabComponent),
      },
      {
        path: 'paper-trading',
        loadComponent: () => import('./tabs/paper-trading-tab.component').then((m) => m.PaperTradingTabComponent),
      },
      {
        path: 'live-trading',
        canActivate: [liveTradingGuard],
        loadComponent: () => import('./tabs/live-trading-tab.component').then((m) => m.LiveTradingTabComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./tabs/settings-tab.component').then((m) => m.SettingsTabComponent),
      },
    ],
  },
];
