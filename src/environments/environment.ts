export const environment = {
  production: false,
  /**
   * Order APIs only — same-origin path.
   * Local: proxy.conf.json → DigitalOcean droplet.
   * Prod: SSR /api/order-kite → droplet (avoids mixed content).
   */
  orderApiBaseUrl: '/api/order-kite',
  /** Default lots (Ruler 1-lot DNA × 3 clears ≥₹15k every historical month with month bank). */
  defaultLots: 3,
  /**
   * When true, Live money checkboxes on Trade Desk / Crude Desk can place real Kite orders.
   */
  allowLiveMoney: true,
  /** DigitalOcean order-backend static egress IP (whitelist in Kite). */
  orderEgressIp: '168.144.28.89',
};