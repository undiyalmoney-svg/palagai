export const environment = {
  production: true,
  /**
   * Same-origin path — SSR forwards to DigitalOcean Order API.
   * Kite sees the droplet static egress IP.
   */
  orderApiBaseUrl: '/api/order-kite',
  momentumApiBaseUrl: '/api/momentum',
  researchApiBaseUrl: '/api/research',
  slBuddyApiBaseUrl: '/api/sl-buddy',
  heatmapApiBaseUrl: '/api/heatmap',
  marketDeskApiBaseUrl: '/api/market-desk',
  orbBacktestApiBaseUrl: '/api/orb-backtest',
  dailyProfitApiBaseUrl: '/api/daily-profit',
  pnlApiBaseUrl: '/api/pnl',
  defaultLots: 1,
  allowLiveMoney: true,
  orderEgressIp: '168.144.28.89',
  appVersion: '1.3.141',
  appBuild: '2026.10.29-live-lock',
};