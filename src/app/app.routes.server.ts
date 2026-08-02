import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * OAuth / login entry paths must not be static prerenders that hard-redirect
 * to /login and drop ?request_token=.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Client },
  { path: 'login', renderMode: RenderMode.Client },
  { path: 'kite-callback', renderMode: RenderMode.Client },
  { path: 'dashboard/get-token', renderMode: RenderMode.Client },
  { path: 'admin/login', renderMode: RenderMode.Client },
  {
    path: 'dashboard/results/:id',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
