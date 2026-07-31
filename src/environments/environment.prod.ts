export const environment = {
  production: true,
  /**
   * Same-origin path — SSR forwards to DigitalOcean Order API.
   * Kite sees the droplet static egress IP.
   */
  orderApiBaseUrl: '/api/order-kite',
  defaultLots: 1,
  allowLiveMoney: true,
  orderEgressIp: '168.144.28.89',
  appVersion: '1.3.31',
  appBuild: '2026.07.31-three-books',
};