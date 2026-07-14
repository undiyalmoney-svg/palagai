export const environment = {
  production: true,
  /**
   * Same-origin path — SSR on Vercel forwards to the DigitalOcean Order API
   * so https://palagai.app is not blocked by mixed content (http droplet IP).
   * Kite still sees the droplet static egress IP.
   */
  orderApiBaseUrl: '/api/order-kite',
  orderApiOrigin: '/api/order-kite',
};
