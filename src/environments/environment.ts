export const environment = {
  production: false,
  /**
   * Order APIs only — same-origin path.
   * Local: proxy.conf.json → DigitalOcean droplet.
   * Prod: SSR /api/order-kite → droplet (avoids mixed content).
   */
  orderApiBaseUrl: '/api/order-kite',
  /** Momentum Portfolio Manager + broker session — local proxy / prod SSR → droplet /momentum. */
  momentumApiBaseUrl: '/api/momentum',
  /** Intraday paper research — local proxy / prod SSR → droplet /research. */
  researchApiBaseUrl: '/api/research',
  slBuddyApiBaseUrl: '/api/sl-buddy',
  heatmapApiBaseUrl: '/api/heatmap',
  marketDeskApiBaseUrl: '/api/market-desk',
  /** Manual daily P/L — local proxy / prod SSR → droplet /pnl. */
  pnlApiBaseUrl: '/api/pnl',
  /** Default lots multiplier across desks (exchange lot × this). */
  defaultLots: 1,
  allowLiveMoney: true,
  /** DigitalOcean order-backend static egress IP (whitelist in Kite). */
  orderEgressIp: '168.144.28.89',
  /** Must match src/app/core/config/app-build.ts — shown in UI. */
  appVersion: '1.3.126',
  appBuild: '2026.10.14-market-desk-404',
};