import { ChartInterval, CHART_INTERVALS, chartIntervalMinutes } from '../chart-intervals.util';
import { SmcConfig } from './smc.config';
import { SMC_ALERT_TYPES, SmcAlertType } from './smc.types';

/** Which drawings are on. Signals are always drawn — they are the point. */
export interface SmcLayers {
  swings: boolean;
  structure: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  liquidity: boolean;
  premiumDiscount: boolean;
  levels: boolean;
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
}

export const SMC_DEFAULT_LTF: ChartInterval = '15m';
export const SMC_DEFAULT_HTF: ChartInterval = '1h';

export const SMC_STORAGE_KEY = 'palagai.smc.settings.v1';

export function defaultSmcSettings(): SmcSettings {
  return {
    ltf: SMC_DEFAULT_LTF,
    htf: SMC_DEFAULT_HTF,
    config: {},
    layers: {
      swings: true,
      structure: true,
      orderBlocks: true,
      fvg: true,
      liquidity: true,
      premiumDiscount: true,
      levels: true,
    },
    alerts: Object.fromEntries(SMC_ALERT_TYPES.map((t) => [t, true])) as Record<
      SmcAlertType,
      boolean
    >,
    browserNotifications: false,
  };
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
