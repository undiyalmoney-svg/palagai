export const environment = {
  production: false,
  orderApiBaseUrl: '/api/order-kite',
  liveApiBaseUrl: '/api/live',
  pnlApiBaseUrl: '/api/pnl',
  defaultLots: 1,
  allowLiveMoney: true,
  orderEgressIp: '168.144.28.89',
  appVersion: '1.3.124',
  appBuild: '2026.08.11-standdown-scale-lots',
  /**
   * Optional local-only session bootstrap. Fill via Get Token — do not commit real tokens.
   */
  // devKiteSession: { apiKey: '', accessToken: '' },
};
