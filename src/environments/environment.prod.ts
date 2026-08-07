export const environment = {
  production: true,
  /**
   * Same-origin path — SSR forwards to DigitalOcean Order API.
   * Kite sees the droplet static egress IP.
   */
  orderApiBaseUrl: '/api/order-kite',
  liveApiBaseUrl: '/api/live',
  pnlApiBaseUrl: '/api/pnl',
  defaultLots: 1,
  allowLiveMoney: true,
  orderEgressIp: '168.144.28.89',
  appVersion: '1.3.87',
  appBuild: '2026.08.04-desk-one-profit',
};