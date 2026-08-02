import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * OAuth callback paths must run in the browser (Client), not as a static
 * prerender that hard-redirects to /login and drops ?request_token=.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Client,
  },
  {
    path: 'login',
    renderMode: RenderMode.Client,
  },
  {
    path: 'dashboard/get-token',
    renderMode: RenderMode.Client,
  },
  {
    path: 'dashboard/results/:id',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
