import { ChartBookId } from '../live-chart-data.service';
import { ChartInterval, CHART_INTERVALS, chartIntervalMinutes } from '../chart-intervals.util';
import { ChartPnlCaps, defaultPnlCaps, parsePnlCaps } from '../chart-pnl-cap';
import { SmcConfig } from './smc.config';
import { SMC_ALERT_TYPES, SmcAlertType } from './smc.types';

export type SmcAutoTrade = Record<ChartBookId, boolean>;

export const CHART_AUTO_BOOKS: readonly ChartBookId[] = ['nifty', 'bank', 'crude'];

/** Which drawings are on. Signals are always drawn — they are the point. */
export interface SmcLayers {
  swings: boolean;
  structure: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  liquidity: boolean;
  premiumDiscount: boolean;
  fib: boolean;
  levels: boolean;
  /** Day High / Low, HTF IDM, SL–PE–TG and the two post-BOS zones. */
  session: boolean;
}

export interface SmcSettings {
  /** Entry timeframe. */
  ltf: ChartInterval;
  /** Higher-timeframe trend filter. */
  htf: ChartInterval;
  config: Partial<SmcConfig>;
  layers: SmcLayers;
  alerts: Record<SmcAlertType, boolean>;
  browserNotifications: boolean;
  /** Place ATM CE/PE when a confirmed BUY/SELL prints. One switch per book. */
  autoTrade: SmcAutoTrade;
  /** Per-book rupee max profit / max loss for each fill. Null = system stop/target. */
  pnlCaps: ChartPnlCaps;
}

export const SMC_DEFAULT_LTF: ChartInterval = '1m';
export const SMC_DEFAULT_HTF: ChartInterval = '5m';

/** Bumped so a saved 15m / 1h book does not hide the 1-minute pathway. */
export const SMC_STORAGE_KEY = 'palagai.smc.settings.v2';

export function defaultSmcSettings(): SmcSettings {
  return {
    ltf: SMC_DEFAULT_LTF,
    htf: SMC_DEFAULT_HTF,
    config: {},
    layers: {
      swings: false,
      structure: true,
      orderBlocks: false,
      fvg: true,
      liquidity: true,
      premiumDiscount: false,
      fib: false,
      levels: true,
      session: true,
    },
    alerts: Object.fromEntries(SMC_ALERT_TYPES.map((t) => [t, true])) as Record<
      SmcAlertType,
      boolean
    >,
    browserNotifications: false,
    autoTrade: defaultAutoTrade(),
    pnlCaps: defaultPnlCaps(),
  };
}

export function defaultAutoTrade(): SmcAutoTrade {
  return { nifty: false, bank: false, crude: false };
}

/** Old saves stored a single boolean that armed every book. */
export function parseAutoTrade(value: unknown): SmcAutoTrade {
  if (value === true) return { nifty: true, bank: true, crude: true };
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return {
      nifty: row['nifty'] === true,
      bank: row['bank'] === true,
      crude: row['crude'] === true,
    };
  }
  return defaultAutoTrade();
}

export function isAutoTradeOn(settings: Pick<SmcSettings, 'autoTrade'>, book: ChartBookId): boolean {
  return settings.autoTrade[book] === true;
}

/**
 * The trend filter has to be at least as coarse as the entry timeframe. A
 * finer one would just be another entry timeframe, so it falls back to the
 * entry timeframe itself and the logic runs unchanged.
 */
export function effectiveHtf(ltf: ChartInterval, htf: ChartInterval): ChartInterval {
  return chartIntervalMinutes(htf) >= chartIntervalMinutes(ltf) ? htf : ltf;
}

export function loadSmcSettings(storage: Pick<Storage, 'getItem'> | null): SmcSettings {
  const base = defaultSmcSettings();
  if (!storage) return base;
  try {
    const raw = storage.getItem(SMC_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SmcSettings>;
    const known = (v: unknown): v is ChartInterval =>
      typeof v === 'string' && (CHART_INTERVALS as readonly string[]).includes(v);
    return {
      ltf: known(parsed.ltf) ? parsed.ltf : base.ltf,
      htf: known(parsed.htf) ? parsed.htf : base.htf,
      config: parsed.config && typeof parsed.config === 'object' ? parsed.config : {},
      layers: { ...base.layers, ...(parsed.layers ?? {}) },
      alerts: { ...base.alerts, ...(parsed.alerts ?? {}) },
      browserNotifications: parsed.browserNotifications === true,
      autoTrade: parseAutoTrade(parsed.autoTrade),
      pnlCaps: parsePnlCaps(parsed.pnlCaps),
    };
  } catch {
    return base;
  }
}

export function saveSmcSettings(
  storage: Pick<Storage, 'setItem'> | null,
  settings: SmcSettings,
): void {
  try {
    storage?.setItem(SMC_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode / quota: settings just do not persist.
  }
}

export function enabledAlertTypes(settings: SmcSettings): Set<SmcAlertType> {
  return new Set(SMC_ALERT_TYPES.filter((t) => settings.alerts[t]));
}
