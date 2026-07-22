export const environment = {
  production: true,
  /**
   * Same-origin path — SSR forwards to DigitalOcean Order API.
   * Kite sees the droplet static egress IP.
   */
  orderApiBaseUrl: '/api/order-kite',
  defaultLots: 3,
  allowLiveMoney: true,
  orderEgressIp: '168.144.28.89',
};