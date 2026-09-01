/**
 * NSE Nifty 50 constituents, from the official NSE archives ind_nifty50list.csv.
 *
 * Used as the intraday scan universe. Intraday strategies live or die on liquidity —
 * tight spreads and enough volume to get filled at the price the backtest assumes — so
 * the pool here is deliberately the 50 most liquid names rather than the wider Nifty 500
 * used for swing scanning.
 *
 * Static snapshot; NSE rebalances periodically. Refresh from
 * https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv
 */
export const NIFTY_50_UNIVERSE: readonly string[] = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJFINANCE',
  'BEL', 'BHARTIARTL', 'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 'GRASIM',
  'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDIGO', 'INFY',
  'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'MAXHEALTH',
  'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SBIN', 'SHRIRAMFIN',
  'SUNPHARMA', 'TATACONSUM', 'TATASTEEL', 'TCS', 'TECHM', 'TITAN', 'TMPV', 'TRENT',
  'ULTRACEMCO', 'WIPRO',
];
