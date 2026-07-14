export const environment = {
  production: false,
  /**
   * Order APIs only (place/modify/cancel/orders/positions/trades).
   * Local/dev can hit the DigitalOcean droplet directly.
   * Quotes / historical / token stay on `/api/kite` (Vercel or ng proxy).
   */
  orderApiBaseUrl: 'http://168.144.28.89:3000/api/kite',
  /** Droplet origin for health checks from the Order Test tab. */
  orderApiOrigin: 'http://168.144.28.89:3000',
};
