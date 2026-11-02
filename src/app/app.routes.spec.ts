import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { serverRoutes } from './app.routes.server';
import { routes } from './app.routes';
import { CrudeBestComponent } from './features/dashboard/crude-best/crude-best.component';
import { CrudeOilComponent } from './features/dashboard/crude-oil/crude-oil.component';
import { Paper14kComponent } from './features/dashboard/paper-14k/paper-14k.component';
import { OrderTestComponent } from './features/dashboard/order-test/order-test.component';

describe('dashboard desk routes', () => {
  const dashboard = routes.find((r) => r.path === 'dashboard');
  const children = dashboard?.children || [];

  it('has no Historical Backtest desk; the old URL goes to Token', () => {
    const backtest = children.find((r) => r.path === 'historical-backtest');
    expect(backtest?.component).toBeUndefined();
    expect(backtest?.redirectTo).toBe('get-token');

    const paper = children.find((r) => r.path === 'paper-14k');
    expect(paper?.component).toBe(Paper14kComponent);
    expect(paper?.loadComponent).toBeUndefined();

    const test = children.find((r) => r.path === 'order-test');
    expect(test?.component).toBe(OrderTestComponent);
    expect(test?.loadComponent).toBeUndefined();

    const crudeBest = children.find((r) => r.path === 'crude-best');
    expect(crudeBest?.component).toBe(CrudeBestComponent);
    expect(crudeBest?.loadComponent).toBeUndefined();
    expect(crudeBest?.canActivate?.length).toBe(1);

    const crude = children.find((r) => r.path === 'crude-oil');
    expect(crude?.component).toBe(CrudeOilComponent);
    expect(crude?.loadComponent).toBeUndefined();
    expect(crude?.canActivate?.length).toBe(1);
  });

  it('renders desks on the client so SSR cannot bounce a signed-in session to login', () => {
    expect(serverRoutes.find((r) => r.path === 'dashboard/historical-backtest')).toBeUndefined();
    const token = serverRoutes.find((r) => r.path === 'dashboard/get-token');
    expect(token?.renderMode).toBe(RenderMode.Client);
    const crudeBest = serverRoutes.find((r) => r.path === 'dashboard/crude-best');
    expect(crudeBest?.renderMode).toBe(RenderMode.Client);
    const crude = serverRoutes.find((r) => r.path === 'dashboard/crude-oil');
    expect(crude?.renderMode).toBe(RenderMode.Client);
    const paper = serverRoutes.find((r) => r.path === 'dashboard/paper-14k');
    expect(paper?.renderMode).toBe(RenderMode.Client);
  });
});
