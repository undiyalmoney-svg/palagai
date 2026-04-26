import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Dynamic routes with parameters should use Server instead of Prerender
  {
    path: 'board/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'preview',
    renderMode: RenderMode.Server
  },
  {
    path: 'punch/:data',
    renderMode: RenderMode.Server
  },
  {
    path: 'poll/:boardKey/results',
    renderMode: RenderMode.Server
  },
  {
    path: 'share/image',
    renderMode: RenderMode.Server,
  },
  // Static routes can be prerendered
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];
