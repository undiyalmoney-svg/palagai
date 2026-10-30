import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { serverRoutes } from './app.routes.server';
import { routes } from './app.routes';
import { HistoricalBacktestComponent } from './features/dashboard/historical-backtest/historical-backtest.component';
import { CrudeOilComponent } from './features/dashboard/crude-oil/crude-oil.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';

describe('dashboard desk routes', () => {
  const dashboard = routes.find((r) => r.path === 'dashboard');
  const children = dashboard?.children || [];

  it('opens Historical Backtest eagerly like Token and Test', () => {
    const backtest = children.find((r) => r.path === 'historical-backtest');
    expect(backtest?.component).toBe(HistoricalBacktestComponent);
    expect(backtest?.loadComponent).toBeUndefined();
    expect(backtest?.canActivate?.length).toBe(1);

    const test = children.find((r) => r.path === 'order-test');
    expect(test?.component).toBe(OrderTestComponent);
    expect(test?.loadComponent).toBeUndefined();

    const crude = children.find((r) => r.path === 'crude-oil');
    expect(crude?.component).toBe(CrudeOilComponent);
    expect(crude?.loadComponent).toBeUndefined();
    expect(crude?.canActivate?.length).toBe(1);
  });

  it('renders Historical Backtest on the client so SSR cannot bounce a signed-in session to login', () => {
    const hist = serverRoutes.find((r) => r.path === 'dashboard/historical-backtest');
    expect(hist?.renderMode).toBe(RenderMode.Client);
    const token = serverRoutes.find((r) => r.path === 'dashboard/get-token');
    expect(token?.renderMode).toBe(RenderMode.Client);
    const crude = serverRoutes.find((r) => r.path === 'dashboard/crude-oil');
    expect(crude?.renderMode).toBe(RenderMode.Client);
  });
});
