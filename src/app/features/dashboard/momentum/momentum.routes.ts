import { Routes } from '@angular/router';
import { MomentumShellComponent } from './momentum-shell.component';

export const MOMENTUM_ROUTES: Routes = [
  {
    path: '',
    component: MomentumShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'paper' },
      {
        path: 'paper',
        data: { desk: 'paper' },
        loadComponent: () => import('./tabs/desk-tab.component').then((m) => m.DeskTabComponent),
      },
      {
        path: 'live',
        data: { desk: 'live' },
        loadComponent: () => import('./tabs/desk-tab.component').then((m) => m.DeskTabComponent),
      },
      {
        path: 'dashboard',
        redirectTo: 'paper',
        pathMatch: 'full',
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
        redirectTo: 'paper',
        pathMatch: 'full',
      },
      {
        path: 'live-trading',
        redirectTo: 'live',
        pathMatch: 'full',
      },
      {
        path: 'settings',
        loadComponent: () => import('./tabs/settings-tab.component').then((m) => m.SettingsTabComponent),
      },
    ],
  },
];
