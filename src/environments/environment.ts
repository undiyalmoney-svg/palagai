export const environment = {
  production: false,
  /**
   * Order APIs only — same-origin path.
   * Local: proxy.conf.json → DigitalOcean droplet.
   * Prod: SSR /api/order-kite → droplet (avoids mixed content).
   */
  orderApiBaseUrl: '/api/order-kite',
  /** Auto Trader control plane — local proxy / prod SSR → droplet /live. */
  liveApiBaseUrl: '/api/live',
  /** Manual daily P/L — local proxy / prod SSR → droplet /pnl. */
  pnlApiBaseUrl: '/api/pnl',
  /** Default lots multiplier across desks (exchange lot × this). */
  defaultLots: 1,
  /**
   * When true, Live money checkboxes on Trade Desk / Crude Desk can place real Kite orders.
   */
  allowLiveMoney: true,
  /** DigitalOcean order-backend static egress IP (whitelist in Kite). */
  orderEgressIp: '168.144.28.89',
  /** Must match src/app/core/config/app-build.ts — shown in UI. */
  appVersion: '1.3.120',
  appBuild: '2026.08.11-crude-qty-1lot',
};