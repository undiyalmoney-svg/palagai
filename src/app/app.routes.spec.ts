import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { HistoricalBacktestComponent } from './features/dashboard/historical-backtest/historical-backtest.component';
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
  });
});
