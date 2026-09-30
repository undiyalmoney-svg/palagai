/**
 * Single entry point the Charts tab calls. History and live share it: the
 * same closed candles produce the same signals whether they arrived years ago
 * or a second ago.
 *
 * A candle that has not closed yet is never fed to the real run. It only
 * feeds a throw-away preview so a developing setup can be shown as
 * "SETUP — NOT CONFIRMED" and can never become a BUY / SELL until it closes.
 */
import { Candle } from '../../models/candle.model';
import { dropFormingBars } from '../../paper-desk/forming-bar.util';
import { resolveSmcConfig, SmcConfig } from './smc.config';
import {
  SMC_MARKET_NAMES,
  SmcAnalysis,
  SmcMarketId,
  SmcPdZone,
  SmcPositionStatus,
  SmcPreview,
  SmcSnapshot,
  SmcTrade,
  SmcTrend,
} from './smc.types';
import { SmcEngine } from './smc-engine';
import { HtfTimeline, buildHtfTimeline, deriveHtfBars } from './smc-htf';
import { splitSmcStats } from './smc-stats';
import { candleTs } from './smc-utils';

export interface SmcHtfInput {
  candles: Candle[];
  minutes: number;
}

export interface AnalyzeSmcInput {
  market: SmcMarketId;
  /** Entry-timeframe candles, including the one still forming if any. */
  candles: Candle[];
  intervalMinutes: number;
  /** Separate higher-timeframe feed. Derived from `candles` when absent. */
  htf?: SmcHtfInput | null;
  htfMinutes?: number;
  /** Wall clock the candles are read at. */
  now?: Date;
  /** True when `now` is the live session rather than a replayed past date. */
  live?: boolean;
  config?: Partial<SmcConfig>;
}

/** A trade that closed this many bars ago still reads as "Exited". */
const EXITED_BARS = 5;

export function analyzeSmc(input: AnalyzeSmcInput): SmcAnalysis {
  const cfg = resolveSmcConfig(input.market, input.config);
  const now = input.now ?? new Date();
  const closed = dropFormingBars(input.candles, now, input.intervalMinutes);
  const forming = input.candles.length > closed.length ? input.candles[closed.length]! : null;

  const timeline = buildTimeline(input, closed, cfg);
  const engine = runEngine(closed, cfg, timeline, input.intervalMinutes);

  let preview: SmcPreview | null = null;
  if (forming) {
    const ghost = runEngine(
      [...closed, forming],
      cfg,
      timeline,
      input.intervalMinutes,
      now.getTime(),
    );
    preview = derivePreview(ghost, closed.length);
  }

  const liveFromTs = input.live ? istSessionStart(now) : null;
  const stats = splitSmcStats(engine.trades, cfg.riskPerTradePct, liveFromTs);
  const snapshot = buildSnapshot(input.market, engine, preview, cfg);

  return {
    market: input.market,
    config: cfg,
    bars: closed.length,
    swings: engine.tracker.swings,
    structure: engine.tracker.events,
    orderBlocks: engine.orderBlocks,
    fvgs: engine.fvgs,
    liquidity: engine.liquidity,
    equalLevels: engine.tracker.equalLevels,
    range: engine.range,
    zone: snapshot.zone,
    trendAt: engine.tracker.trendAt,
    htfTrendAt: engine.htfTrendAt,
    trades: engine.trades,
    signals: engine.signals,
    alerts: engine.alerts,
    setup: engine.setups.BUY ?? engine.setups.SELL,
    preview,
    snapshot,
    stats,
    atr: engine.tracker.atr.length ? engine.tracker.atr[engine.tracker.atr.length - 1]! : null,
    htfAvailable: timeline != null,
  };
}

function runEngine(
  bars: Candle[],
  cfg: SmcConfig,
  timeline: HtfTimeline | null,
  minutes: number,
  asOfTs?: number,
): SmcEngine {
  const engine = new SmcEngine(cfg, timeline, minutes);
  for (let i = 0; i < bars.length; i += 1) {
    // Only the last (forming) bar of a preview is clocked to "now".
    engine.step(bars[i]!, i === bars.length - 1 ? asOfTs : undefined);
  }
  return engine;
}

function buildTimeline(
  input: AnalyzeSmcInput,
  closed: Candle[],
  cfg: SmcConfig,
): HtfTimeline | null {
  const minutes = input.htfMinutes ?? input.htf?.minutes ?? input.intervalMinutes;
  if (input.htf && input.htf.candles.length) {
    return buildHtfTimeline(input.htf.candles, input.htf.minutes, cfg);
  }
  if (!closed.length) return null;
  if (minutes === input.intervalMinutes) {
    return buildHtfTimeline(closed, minutes, cfg);
  }
  const derived = deriveHtfBars(closed, input.intervalMinutes, minutes);
  return derived ? buildHtfTimeline(derived, minutes, cfg) : null;
}

function derivePreview(ghost: SmcEngine, formingIndex: number): SmcPreview | null {
  const entered = ghost.trades.find((t) => t.entryIndex === formingIndex);
  if (entered) {
    return {
      kind: 'entry',
      side: entered.side,
      index: formingIndex,
      entry: entered.entryPrice,
      sl: entered.sl,
      tp1: entered.tp1,
      tp2: entered.tp2,
      tpFinal: entered.tpFinal,
      rr: entered.rr,
      label: 'SETUP — NOT CONFIRMED',
    };
  }
  const armed = ghost.setups.BUY ?? ghost.setups.SELL;
  if (armed) {
    return {
      kind: 'setup',
      side: armed.side,
      index: formingIndex,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tpFinal: null,
      rr: null,
      label: 'SETUP — NOT CONFIRMED',
    };
  }
  return null;
}

function buildSnapshot(
  market: SmcMarketId,
  engine: SmcEngine,
  preview: SmcPreview | null,
  cfg: SmcConfig,
): SmcSnapshot {
  const tracker = engine.tracker;
  const last = tracker.bars.length - 1;
  const ltfTrend: SmcTrend = last >= 0 ? tracker.trendAt[last]! : 'sideways';
  const htfTrend = last >= 0 ? (engine.htfTrendAt[last] ?? null) : null;
  const events = tracker.events;
  const lastOf = (kind: 'BOS' | 'CHoCH') => {
    for (let k = events.length - 1; k >= 0; k -= 1) {
      if (events[k]!.kind === kind) return events[k]!.dir === 'bull' ? 'Bullish' : 'Bearish';
    }
    return null;
  };

  const trades = engine.trades;
  const open = [...trades].reverse().find((t) => t.status === 'open') ?? null;
  const latest = trades.length ? trades[trades.length - 1]! : null;
  const justExited =
    latest != null &&
    latest.status === 'closed' &&
    latest.exitIndex != null &&
    last - latest.exitIndex < EXITED_BARS;

  let position: SmcPositionStatus = 'Waiting';
  if (open) position = open.side === 'BUY' ? 'Long' : 'Short';
  else if (justExited) position = 'Exited';

  const levelsFrom: SmcTrade | null = open ?? (justExited ? latest : null);
  const armed = preview?.kind === 'setup' ? preview.side : (engine.setups.BUY ?? engine.setups.SELL)?.side;
  const setupSide = preview?.side ?? armed ?? null;

  let signal: SmcSnapshot['signal'] = 'NONE';
  if (open) signal = open.side;
  else if (latest && latest.entryIndex === last) signal = latest.side;

  const lv = levelsFrom;
  const entry = lv?.entryPrice ?? preview?.entry ?? null;
  const range = engine.range;
  const close = last >= 0 ? tracker.bars[last]!.close : null;

  return {
    market,
    marketName: SMC_MARKET_NAMES[market],
    trend: htfTrend ?? ltfTrend,
    ltfTrend,
    htfTrend,
    structure: tracker.structureText(),
    lastBos: lastOf('BOS'),
    lastChoch: lastOf('CHoCH'),
    setup: setupSide === 'BUY' ? 'Buy Setup' : setupSide === 'SELL' ? 'Sell Setup' : 'None',
    setupUnconfirmed: setupSide != null,
    signal,
    entry,
    sl: lv ? lv.slNow : (preview?.sl ?? null),
    tp1: lv?.tp1 ?? preview?.tp1 ?? null,
    tp2: lv?.tp2 ?? preview?.tp2 ?? null,
    tpFinal: lv?.tpFinal ?? preview?.tpFinal ?? null,
    rr: lv?.rr ?? preview?.rr ?? null,
    position,
    zone: range && close != null ? pdZone(close, range.lo, range.hi, cfg.pdThreshold) : null,
    lastPrice: close,
  };
}

function pdZone(price: number, lo: number, hi: number, threshold: number): SmcPdZone {
  const pos = (price - lo) / (hi - lo);
  if (Math.abs(pos - 0.5) <= 0.05) return 'equilibrium';
  if (pos < threshold) return 'discount';
  if (pos > 1 - threshold) return 'premium';
  return 'equilibrium';
}

/** Start of the current IST calendar day, as epoch ms. */
export function istSessionStart(now: Date): number {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return candleTs(`${day}T00:00:00`);
}
