import { HeatmapCompany, HeatmapSnapshot, HeatmapTrendId } from '../../features/heatmap/heatmap.models';
import {
  DEFAULT_DESK_SETTINGS,
  MarketBias,
  MarketBreakout,
  MarketDeskSettings,
  MarketDeskSnapshot,
  MarketIndexCard,
  MarketStockTile,
} from './market-desk.models';

const NONE: MarketBreakout = {
  status: 'insufficient',
  direction: null,
  level: null,
  close: null,
  closeTime: null,
  support: null,
  resistance: null,
};

function istNow(now = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(now) + ' IST'
  );
}

function biasFromPublic(trend: HeatmapTrendId | undefined): {
  bias: MarketBias;
  biasLabel: string;
  confirmed: boolean;
  score: number | null;
} {
  switch (trend) {
    case 'strong-up':
      return { bias: 'bullish', biasLabel: 'Bullish', confirmed: true, score: 4 };
    case 'up':
      return { bias: 'mild-bull', biasLabel: 'Mild bullish bias', confirmed: false, score: 2 };
    case 'strong-down':
      return { bias: 'bearish', biasLabel: 'Bearish', confirmed: true, score: -4 };
    case 'down':
      return { bias: 'mild-bear', biasLabel: 'Mild bearish bias', confirmed: false, score: -2 };
    case 'sideways':
      return { bias: 'sideways', biasLabel: 'Sideways', confirmed: false, score: 0 };
    default:
      return { bias: 'insufficient', biasLabel: 'Insufficient data', confirmed: false, score: null };
  }
}

/** Public heatmap has no 15m/1h. Day bias is today's % so index cards are not blank WAIT. */
function dayFromPct(pct: number | null | undefined): {
  bias: MarketBias;
  biasLabel: string;
  dayTrend: string;
  confirmed: boolean;
  score: number | null;
  strength: string;
  strengthLabel: string;
} {
  if (!Number.isFinite(pct)) {
    return {
      bias: 'insufficient',
      biasLabel: 'Waiting for quotes',
      dayTrend: 'insufficient',
      confirmed: false,
      score: null,
      strength: 'insufficient',
      strengthLabel: 'Waiting',
    };
  }
  const n = pct as number;
  const mag = Math.abs(n);
  const strength = mag >= 1 ? 'strong' : mag >= 0.3 ? 'moderate' : 'weak';
  const strengthLabel = mag >= 1 ? 'Strong day move' : mag >= 0.3 ? 'Moderate' : 'Quiet day';
  if (n > 0.15) {
    return {
      bias: n >= 1 ? 'bullish' : 'mild-bull',
      biasLabel: n >= 1 ? 'Bullish' : 'Mild bullish bias',
      dayTrend: 'bullish',
      confirmed: false,
      score: n >= 1 ? 2 : 1,
      strength,
      strengthLabel,
    };
  }
  if (n < -0.15) {
    return {
      bias: n <= -1 ? 'bearish' : 'mild-bear',
      biasLabel: n <= -1 ? 'Bearish' : 'Mild bearish bias',
      dayTrend: 'bearish',
      confirmed: false,
      score: n <= -1 ? -2 : -1,
      strength,
      strengthLabel,
    };
  }
  return {
    bias: 'sideways',
    biasLabel: 'Sideways',
    dayTrend: 'sideways',
    confirmed: false,
    score: 0,
    strength,
    strengthLabel,
  };
}

function indexCard(snap: HeatmapSnapshot | null, fallbackName: string, id: string): MarketIndexCard {
  const idx = snap?.index;
  const pack = dayFromPct(idx?.changePct);
  return {
    id,
    name: idx?.name || fallbackName,
    symbol: id,
    ltp: idx?.ltp ?? null,
    change: idx?.change ?? null,
    changePct: idx?.changePct ?? null,
    bias: pack.bias,
    biasLabel: pack.biasLabel,
    confirmed: pack.confirmed,
    score: pack.score,
    strength: pack.strength,
    strengthLabel: pack.strengthLabel,
    breakout15: { ...NONE, interval: '15minute' },
    breakout60: { ...NONE, interval: '60minute' },
    agreement: 'insufficient',
    m15Trend: 'insufficient',
    h1Trend: 'insufficient',
    dayTrend: pack.dayTrend,
  };
}

/** Same Nifty 50 names as Order-API heatmap/universe.js — shown if the public feed returns no companies. */
const NIFTY50_SYMBOLS = [
  'RELIANCE',
  'ONGC',
  'COALINDIA',
  'NTPC',
  'POWERGRID',
  'TCS',
  'INFY',
  'HCLTECH',
  'WIPRO',
  'TECHM',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'KOTAKBANK',
  'AXISBANK',
  'INDUSINDBK',
  'BAJFINANCE',
  'BAJAJFINSV',
  'HDFCLIFE',
  'SBILIFE',
  'MARUTI',
  'M&M',
  'BAJAJ-AUTO',
  'EICHERMOT',
  'SUNPHARMA',
  'DRREDDY',
  'CIPLA',
  'APOLLOHOSP',
  'HINDUNILVR',
  'ITC',
  'NESTLEIND',
  'BRITANNIA',
  'TATACONSUM',
  'TATASTEEL',
  'JSWSTEEL',
  'HINDALCO',
  'LT',
  'ADANIPORTS',
  'ULTRACEMCO',
  'GRASIM',
  'ASIANPAINT',
  'TITAN',
  'BHARTIARTL',
  'JIOFIN',
  'ETERNAL',
  'SHRIRAMFIN',
  'TRENT',
  'ADANIENT',
  'BEL',
  'HEROMOTOCO',
];

function placeholderTile(symbol: string): MarketStockTile {
  return {
    symbol,
    name: symbol,
    sector: '',
    ltp: null,
    changePct: null,
    bias: 'insufficient',
    biasLabel: 'Waiting for quotes',
    confirmed: false,
    score: null,
    strength: 'insufficient',
    m15Trend: 'insufficient',
    h1Trend: 'insufficient',
    breakout15: { ...NONE, interval: '15minute' },
    breakout60: { ...NONE, interval: '60minute' },
    breakoutAgree: false,
    aboveEma20: null,
    aboveEma50: null,
  };
}

function stockTile(row: HeatmapCompany): MarketStockTile {
  const pack = biasFromPublic(row.trend);
  const close = row.ltp;
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    ltp: row.ltp,
    changePct: row.changePct,
    bias: pack.bias,
    biasLabel: pack.biasLabel,
    confirmed: pack.confirmed,
    score: pack.score,
    strength: Number.isFinite(row.adx) ? (row.adx! >= 25 ? 'strong' : row.adx! >= 18 ? 'moderate' : 'weak') : 'insufficient',
    m15Trend: 'insufficient',
    h1Trend: 'insufficient',
    breakout15: { ...NONE, interval: '15minute' },
    breakout60: { ...NONE, interval: '60minute' },
    breakoutAgree: false,
    aboveEma20: Number.isFinite(close) && Number.isFinite(row.ema20) ? (close as number) > (row.ema20 as number) : null,
    aboveEma50: Number.isFinite(close) && Number.isFinite(row.ema50) ? (close as number) > (row.ema50 as number) : null,
  };
}

function breadthFrom(nifty: MarketIndexCard, tiles: MarketStockTile[]) {
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let above20 = 0;
  let above50 = 0;
  let have20 = 0;
  let have50 = 0;
  for (const t of tiles) {
    if (!Number.isFinite(t.changePct)) continue;
    if ((t.changePct as number) > 0.05) advances += 1;
    else if ((t.changePct as number) < -0.05) declines += 1;
    else unchanged += 1;
    if (t.aboveEma20 != null) {
      have20 += 1;
      if (t.aboveEma20) above20 += 1;
    }
    if (t.aboveEma50 != null) {
      have50 += 1;
      if (t.aboveEma50) above50 += 1;
    }
  }
  const ranked = [...tiles].filter((t) => Number.isFinite(t.changePct)).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const adRatio = declines === 0 ? null : Math.round((advances / declines) * 100) / 100;
  const indexUp = Number.isFinite(nifty.changePct) && (nifty.changePct as number) > 0.15;
  const indexDown = Number.isFinite(nifty.changePct) && (nifty.changePct as number) < -0.15;
  let divergence: string | null = null;
  if (indexUp && declines > advances) divergence = 'Index up while most Nifty 50 stocks are declining';
  if (indexDown && advances > declines) divergence = 'Index down while most Nifty 50 stocks are advancing';
  return {
    advances,
    declines,
    unchanged,
    adRatio,
    adRatioLabel: declines === 0 ? (advances > 0 ? '∞' : 'n/a') : String(adRatio),
    pctAboveEma20: have20 ? Math.round((above20 / have20) * 1000) / 10 : null,
    pctAboveEma50: have50 ? Math.round((above50 / have50) * 1000) / 10 : null,
    strongest: ranked.slice(0, 3).map((s) => ({ symbol: s.symbol, changePct: s.changePct as number })),
    weakest: ranked.slice(-3).reverse().map((s) => ({ symbol: s.symbol, changePct: s.changePct as number })),
    sectors: [] as { sector: string; avgChangePct: number; n: number }[],
    divergence,
    universe: 'NIFTY50',
  };
}

/** Live Yahoo/Groww quotes when the droplet does not yet serve /market-desk. */
export function deskSnapshotFromPublicHeatmaps(
  nifty: HeatmapSnapshot,
  bank: HeatmapSnapshot,
  sensex: HeatmapSnapshot,
  settings: MarketDeskSettings = DEFAULT_DESK_SETTINGS,
  now = new Date(),
): MarketDeskSnapshot {
  const indices = [
    indexCard(nifty, 'NIFTY 50', 'NIFTY50'),
    indexCard(bank, 'NIFTY BANK', 'BANKNIFTY'),
    indexCard(sensex, 'SENSEX', 'SENSEX'),
  ];
  const live = (nifty.companies || []).map(stockTile);
  const stocks = live.length ? live : NIFTY50_SYMBOLS.map(placeholderTile);
  return {
    private: true,
    demo: false,
    needsReauth: false,
    settings,
    session: {
      status: nifty.session?.ok ? 'open' : 'closed',
      label: nifty.session?.ok ? 'Quotes live' : 'No quotes',
      open: Boolean(nifty.session?.ok),
      day: now.toISOString().slice(0, 10),
      istNow: istNow(now),
      lastUpdateAt: nifty.lastUpdatedAt || now.toISOString(),
      lastTickAt: nifty.lastUpdatedAt || null,
      lastConfirmedCandleAt: null,
      connection: 'polling',
      freshness: nifty.session?.ok ? 'fresh' : 'missing',
      timeframe: '15minute',
      message:
        'Trading server is missing /market-desk (404). Live % quotes are the public index feed. 15m/1h Kite breakouts stay insufficient until the droplet pulls Order-API and restarts.',
    },
    indices,
    stocks,
    breadth: breadthFrom(indices[0], stocks),
    setups: [],
    alerts: [],
    warning:
      'Kite market desk is not on the droplet yet. Showing live public quotes. On the server: cd /var/www/Palagai-Order-API && git pull origin main && pm2 restart trading-backend',
  };
}

export function isDeskRouteMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = 'status' in err ? Number((err as { status?: number }).status) : 0;
  const msg = 'message' in err ? String((err as { message?: string }).message) : '';
  return status === 404 || /Route not found: GET \/market-desk/i.test(msg);
}
