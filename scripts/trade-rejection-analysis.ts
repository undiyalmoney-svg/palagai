/**
 * Trade Rejection Analysis — replay champion DNA on today's market data and
 * list every skipped / rejected potential entry with the exact failed condition.
 *
 * Usage:
 *   python3 scripts/fetch-yahoo-intraday.py > /tmp/market-today.json
 *   npx tsx scripts/trade-rejection-analysis.ts /tmp/market-today.json
 *
 * Optional: DATE=2026-07-21 to force the trading date.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Candle } from '../src/app/core/models/candle.model.ts';
import { NSE_SESSION } from '../src/app/core/config/session.config.ts';
import { extractTradeDate } from '../src/app/core/utils/trade-date.util.ts';
import { extractHhMm } from '../src/app/core/strategy-engine/utils/market-session.util.ts';
import { StrategyContext } from '../src/app/core/strategy-engine/models/strategy-context.model.ts';
import {
  createPdhlOrState,
  emaLast,
  PDHL_EMA_EXIT_PERIOD,
  PdhlOrState,
  recordPdhlTradeClosed,
  runPdhlOpeningRange,
  PDHL_SWING_LOOKBACK,
  mergePdhlOrParams,
  effectivePdhlEarliestEntry,
  pdhlWeekdayLabel,
} from '../src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator.ts';

/** Mirrors evaluator openingRange (not exported). */
function openingRange(
  dayBars: Candle[],
  marketOpen: string,
  firstHourEnd: string,
): { high: number; low: number; mid: number; range: number } | null {
  const bars = dayBars.filter((c) => {
    const t = extractHhMm(c.date);
    return t >= marketOpen && t < firstHourEnd;
  });
  if (!bars.length) return null;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, mid: (high + low) / 2, range: high - low };
}
import {
  ALMOST_GREEN_GAP_PCT,
  ALMOST_GREEN_MAX_PER_DAY,
  GAP_FADE_500_GAP_PCT,
  GAP_FADE_500_MAX_PER_DAY,
  StocksStrategyId,
  applyMaxTradesPerDayByGap,
  replayStocksDayStrategy,
  STOCKS_STRATEGY_OPTIONS,
} from '../src/app/core/strategy-engine/strategies/stocks-equity/stocks-equity.evaluator.ts';

type MarketPayload = {
  asOf: string;
  indexes: Record<string, { ticker: string; candles: Candle[]; todayCount: number }>;
  stocks: Record<string, { ticker: string; candles: Candle[] }>;
};

type RejectionEvent = {
  instrument: string;
  time: string;
  action: string;
  failedCondition: string;
  reason: string;
  details: Record<string, string | number | boolean | null>;
  category: 'NO_TRADE' | 'WAITING' | 'SKIPPED_OPEN' | 'NEAR_MISS';
};

type TakenTrade = {
  instrument: string;
  direction: string;
  entryTime: string;
  entry: number;
  stop: number;
  target: number;
  exitTime: string;
  exit: number;
  exitReason: string;
  points: number;
};

function stubCandle(from: Candle): Candle {
  return { ...from };
}

function buildContext(candles: Candle[], index: number, instrumentId: string): StrategyContext {
  const candle5m = candles[index]!;
  return {
    candle60m: stubCandle(candle5m),
    candle30m: stubCandle(candle5m),
    candle15m: stubCandle(candle5m),
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(0, index),
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candles.at(-1)?.date ?? candle5m.date,
    session: NSE_SESSION,
    instrumentId,
    series5m: candles,
  };
}

type OpenPaper = {
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  entryTime: string;
};

function checkIndexExit(
  candle: Candle,
  open: OpenPaper,
  closesForEma: number[],
): { exitPrice: number; reason: string } | null {
  const time = extractHhMm(candle.date);
  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) return { exitPrice: open.stop, reason: 'Stop loss hit' };
    if (candle.high >= open.target) return { exitPrice: open.target, reason: 'Target hit' };
  } else {
    if (candle.high >= open.stop) return { exitPrice: open.stop, reason: 'Stop loss hit' };
    if (candle.low <= open.target) return { exitPrice: open.target, reason: 'Target hit' };
  }
  const ema20 = emaLast(closesForEma, PDHL_EMA_EXIT_PERIOD);
  if (ema20 != null) {
    if (open.direction === 'BUY' && candle.close < ema20) {
      return { exitPrice: candle.close, reason: 'EMA-20 exit' };
    }
    if (open.direction === 'SELL' && candle.close > ema20) {
      return { exitPrice: candle.close, reason: 'EMA-20 exit' };
    }
  }
  if (time >= NSE_SESSION.sessionCloseCandle) {
    return { exitPrice: candle.close, reason: NSE_SESSION.sessionCloseLabel };
  }
  return null;
}

/** Classify why this bar did not produce an entry — exact failed condition. */
function classifyRejection(
  instrumentId: string,
  candle: Candle,
  state: PdhlOrState,
  action: string,
  reason: string,
  analysis: Record<string, unknown>,
): RejectionEvent | null {
  const time = extractHhMm(candle.date);
  const p = mergePdhlOrParams(instrumentId, null);
  const tradingDate = extractTradeDate(candle.date);
  const earliest = effectivePdhlEarliestEntry(tradingDate, p);
  const dayLabel = pdhlWeekdayLabel(tradingDate);

  // Skip pre-OR warm-up noise (still list once via summary).
  const boring =
    reason.startsWith('Before market open') ||
    reason.startsWith('Waiting for opening range');
  if (boring) return null;

  let category: RejectionEvent['category'] = action === 'NO_TRADE' ? 'NO_TRADE' : 'WAITING';
  let failedCondition = reason;

  // Near-miss: bias + swing breakout present but risk / day budget blocked.
  if (reason.startsWith('Risk ') && reason.includes('< min')) {
    category = 'NEAR_MISS';
    failedCondition = `minStopPts: risk must be ≥ ${p.minStopPts} pts (actual below floor)`;
  } else if (reason.includes('Next SL would breach day max loss')) {
    category = 'NEAR_MISS';
    failedCondition = `dailyMaxLossPts: dayNet − risk would breach −${p.dailyMaxLossPts}`;
  } else if (reason.includes('trade cap reached')) {
    failedCondition = `${dayLabel} maxTrades cap (weekdayRules)`;
  } else if (reason.includes('OR width')) {
    failedCondition = `${dayLabel} maxOrWidth filter`;
  } else if (reason.includes('Outside entry window')) {
    if (time < earliest) {
      failedCondition = `earliestEntry: ${time} < ${earliest} (${dayLabel} weekdayRules.earliestEntry)`;
    } else {
      failedCondition = `lastEntry: ${time} > ${p.lastEntry} (PdhlOrParams.lastEntry)`;
    }
  } else if (reason.includes('Waiting for OR bias + swing breakout')) {
    const bias = String(analysis['bias'] ?? '?');
    const sh = Number(analysis['swingHigh'] ?? NaN);
    const sl = Number(analysis['swingLow'] ?? NaN);
    if (bias === 'BUY') {
      failedCondition = `swingBreakout: close (${candle.close.toFixed(2)}) ≤ swingHigh (${Number.isFinite(sh) ? sh.toFixed(2) : 'n/a'}) while bias=BUY`;
    } else if (bias === 'SELL') {
      failedCondition = `swingBreakout: close (${candle.close.toFixed(2)}) ≥ swingLow (${Number.isFinite(sl) ? sl.toFixed(2) : 'n/a'}) while bias=SELL`;
    } else {
      failedCondition = 'swingBreakout: OR bias + close beyond last confirmed swing not met';
    }
  } else if (reason.includes('Swing high/low not ready')) {
    failedCondition = `swingLookback: need ${PDHL_SWING_LOOKBACK * 2 + 1}+ bars with confirmed pivots`;
  } else if (reason.includes('Day profit lock') || reason.includes('Day max loss')) {
    failedCondition = reason;
    category = 'NO_TRADE';
  }

  return {
    instrument: instrumentId,
    time: candle.date,
    action,
    failedCondition,
    reason,
    category,
    details: {
      close: Number(candle.close.toFixed(2)),
      bias: (analysis['bias'] as string) ?? null,
      orHigh: analysis['orHigh'] != null ? Number(Number(analysis['orHigh']).toFixed(2)) : null,
      orLow: analysis['orLow'] != null ? Number(Number(analysis['orLow']).toFixed(2)) : null,
      swingHigh: analysis['swingHigh'] != null ? Number(Number(analysis['swingHigh']).toFixed(2)) : null,
      swingLow: analysis['swingLow'] != null ? Number(Number(analysis['swingLow']).toFixed(2)) : null,
      dayNetPts: state.dayNetPts,
      tradesToday: state.tradesToday,
      earliestEntry: earliest,
      weekday: dayLabel,
    },
  };
}

function analyzeIndex(params: {
  instrumentId: string;
  instrumentName: string;
  candles: Candle[];
  tradingDate: string;
}): {
  taken: TakenTrade[];
  rejections: RejectionEvent[];
  skippedOpen: RejectionEvent[];
  lastSignal: string;
  orSummary: Record<string, string | number | null>;
} {
  const { instrumentId, candles, tradingDate } = params;
  const state = createPdhlOrState();
  const taken: TakenTrade[] = [];
  const rejections: RejectionEvent[] = [];
  const skippedOpen: RejectionEvent[] = [];
  let open: OpenPaper | null = null;
  let lastSignal = 'Waiting';
  let orSummary: Record<string, string | number | null> = {
    tradingDate,
    weekday: pdhlWeekdayLabel(tradingDate),
    orHigh: null,
    orLow: null,
    orWidth: null,
    earliestEntry: effectivePdhlEarliestEntry(tradingDate, mergePdhlOrParams(instrumentId, null)),
  };

  for (let i = 40; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const day = extractTradeDate(candle.date);
    if (day !== tradingDate) continue;

    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const dayBars = candles
      .slice(0, i + 1)
      .filter((c) => extractTradeDate(c.date) === tradingDate);
    const or = openingRange(dayBars, NSE_SESSION.marketOpen, NSE_SESSION.firstHourEnd);
    if (or && orSummary.orHigh == null) {
      orSummary = {
        ...orSummary,
        orHigh: Number(or.high.toFixed(2)),
        orLow: Number(or.low.toFixed(2)),
        orWidth: Number(or.range.toFixed(2)),
        orMid: Number(or.mid.toFixed(2)),
      };
    }

    if (open) {
      // Would-be signal while flat is blocked by open position — detect near entries.
      const ctxPeek = buildContext(candles, i, instrumentId);
      const peekState = { ...state };
      const peek = runPdhlOpeningRange(ctxPeek, peekState, mergePdhlOrParams(instrumentId, null));
      if (peek.action === 'BUY' || peek.action === 'SELL') {
        skippedOpen.push({
          instrument: instrumentId,
          time: candle.date,
          action: 'SKIPPED',
          category: 'SKIPPED_OPEN',
          reason: peek.reason,
          failedCondition: 'activeTrade: Maximum one open trade at a time — wait for exit',
          details: {
            wouldBe: peek.action,
            close: Number(candle.close.toFixed(2)),
            openEntry: open.entry,
            openDirection: open.direction,
          },
        });
      }

      const exit = checkIndexExit(candle, open, closes);
      if (exit) {
        const points =
          open.direction === 'BUY' ? exit.exitPrice - open.entry : open.entry - exit.exitPrice;
        taken.push({
          instrument: instrumentId,
          direction: open.direction,
          entryTime: open.entryTime,
          entry: open.entry,
          stop: open.stop,
          target: open.target,
          exitTime: candle.date,
          exit: exit.exitPrice,
          exitReason: exit.reason,
          points,
        });
        recordPdhlTradeClosed(state, points, mergePdhlOrParams(instrumentId, null));
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }

    const ctx = buildContext(candles, i, instrumentId);
    const signal = runPdhlOpeningRange(ctx, state, mergePdhlOrParams(instrumentId, null));
    lastSignal = signal.reason;

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      open = {
        direction: signal.action,
        entry: signal.entryPrice,
        stop: signal.stopLoss,
        target: signal.target,
        entryTime: candle.date,
      };
      continue;
    }

    const event = classifyRejection(
      instrumentId,
      candle,
      state,
      signal.action,
      signal.reason,
      signal.analysis,
    );
    if (event) rejections.push(event);
  }

  if (open) {
    // Force-close at end of data for reporting completeness.
    const last = candles.filter((c) => extractTradeDate(c.date) === tradingDate).at(-1)!;
    const points = open.direction === 'BUY' ? last.close - open.entry : open.entry - last.close;
    taken.push({
      instrument: instrumentId,
      direction: open.direction,
      entryTime: open.entryTime,
      entry: open.entry,
      stop: open.stop,
      target: open.target,
      exitTime: last.date,
      exit: last.close,
      exitReason: 'Still open at last bar (forced mark)',
      points,
    });
  }

  return { taken, rejections, skippedOpen, lastSignal, orSummary };
}

type StockReject = {
  symbol: string;
  strategyId: string;
  failedCondition: string;
  details: Record<string, string | number | boolean | null>;
};

function analyzeStocks(
  stocks: MarketPayload['stocks'],
  tradingDate: string,
): { accepted: ReturnType<typeof replayStocksDayStrategy>; rejected: StockReject[] } {
  const strategies: StocksStrategyId[] = [
    'ALMOST_GREEN_MIX',
    'GAP_FADE_500',
    'GAP_UP_FADE',
    'GAP_DOWN_BOUNCE',
  ];
  const acceptedAll: ReturnType<typeof replayStocksDayStrategy> = [];
  const rejected: StockReject[] = [];

  for (const strategyId of strategies) {
    const dayCandidates: ReturnType<typeof replayStocksDayStrategy> = [];
    for (const [symbol, pack] of Object.entries(stocks)) {
      const days = pack.candles;
      const idx = days.findIndex((c) => extractTradeDate(c.date) === tradingDate);
      if (idx < 0) {
        rejected.push({
          symbol,
          strategyId,
          failedCondition: 'noDailyBar: Yahoo has no daily bar for today',
          details: { tradingDate },
        });
        continue;
      }
      if (idx === 0) {
        rejected.push({
          symbol,
          strategyId,
          failedCondition: 'prevCloseUnavailable: need prior day close for gap calc',
          details: { tradingDate },
        });
        continue;
      }
      const d = days[idx]!;
      const prev = days[idx - 1]!;
      const gap = (d.open - prev.close) / prev.close;
      const gapPct = gap * 100;

      let wouldTrade = false;
      let dir: 'BUY' | 'SELL' | null = null;
      let needGap = 0;
      let gate = '';

      if (strategyId === 'ALMOST_GREEN_MIX') {
        needGap = ALMOST_GREEN_GAP_PCT;
        if (gap >= needGap) {
          wouldTrade = true;
          dir = 'SELL';
          gate = `gapUp ≥ ${needGap * 100}%`;
        } else if (gap <= -needGap) {
          wouldTrade = true;
          dir = 'BUY';
          gate = `gapDown ≤ −${needGap * 100}%`;
        } else {
          gate = `|gap| ≥ ${needGap * 100}% (ALMOST_GREEN_GAP_PCT)`;
        }
      } else if (strategyId === 'GAP_FADE_500' || strategyId === 'GAP_UP_FADE') {
        needGap = strategyId === 'GAP_FADE_500' ? GAP_FADE_500_GAP_PCT : 0.005;
        if (gap >= needGap) {
          wouldTrade = true;
          dir = 'SELL';
          gate = `gapUp ≥ ${needGap * 100}%`;
        } else {
          gate = `open > prevClose × (1 + ${needGap})  [gap-up fade]`;
        }
      } else if (strategyId === 'GAP_DOWN_BOUNCE') {
        needGap = 0.005;
        if (gap <= -needGap) {
          wouldTrade = true;
          dir = 'BUY';
          gate = `gapDown ≤ −${needGap * 100}%`;
        } else {
          gate = `open < prevClose × (1 − ${needGap})  [gap-down bounce]`;
        }
      }

      if (!wouldTrade) {
        rejected.push({
          symbol,
          strategyId,
          failedCondition: gate,
          details: {
            open: Number(d.open.toFixed(2)),
            prevClose: Number(prev.close.toFixed(2)),
            gapPct: Number(gapPct.toFixed(3)),
            required: `${(needGap * 100).toFixed(2)}%`,
          },
        });
        continue;
      }

      // Replay single-day via full series to get qty/levels.
      const trades = replayStocksDayStrategy({
        symbol,
        days,
        strategyId,
      }).filter((t) => t.date === tradingDate);
      if (!trades.length) {
        rejected.push({
          symbol,
          strategyId,
          failedCondition: 'qtyForRisk: position size rounded to 0 (stop too wide vs capital)',
          details: {
            direction: dir,
            open: Number(d.open.toFixed(2)),
            gapPct: Number(gapPct.toFixed(3)),
            gate,
          },
        });
        continue;
      }
      dayCandidates.push(...trades);
    }

    const maxN =
      strategyId === 'GAP_FADE_500'
        ? GAP_FADE_500_MAX_PER_DAY
        : strategyId === 'ALMOST_GREEN_MIX'
          ? ALMOST_GREEN_MAX_PER_DAY
          : null;

    if (maxN != null) {
      const kept = applyMaxTradesPerDayByGap(dayCandidates, maxN);
      const keptKeys = new Set(kept.map((t) => `${t.symbol}|${t.strategyId}`));
      for (const t of dayCandidates) {
        if (!keptKeys.has(`${t.symbol}|${t.strategyId}`)) {
          rejected.push({
            symbol: t.symbol,
            strategyId,
            failedCondition: `maxPerDayByGap: only top ${maxN} |gap| names kept (ranked out)`,
            details: {
              gapAbs: t.gapAbs ?? null,
              direction: t.direction,
              entry: t.entry,
            },
          });
        } else {
          acceptedAll.push(t);
        }
      }
    } else {
      acceptedAll.push(...dayCandidates);
    }
  }

  return { accepted: acceptedAll, rejected };
}

function summarizeReasons(events: RejectionEvent[]): Array<{ reason: string; count: number; failedCondition: string }> {
  const map = new Map<string, { reason: string; count: number; failedCondition: string }>();
  for (const e of events) {
    const key = e.reason;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { reason: e.reason, count: 1, failedCondition: e.failedCondition });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function main(): void {
  const path = process.argv[2] ?? '/tmp/market-today.json';
  const tradingDate = process.env.DATE ?? '';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as MarketPayload;
  const day = tradingDate || raw.asOf;

  const indexIds: Array<{ id: string; name: string; key: string }> = [
    { id: 'nifty', name: 'Nifty 50', key: 'nifty' },
    { id: 'bank-nifty', name: 'Bank Nifty', key: 'bank-nifty' },
  ];

  const report: {
    tradingDate: string;
    weekday: string;
    indexes: unknown[];
    stocks: unknown;
  } = {
    tradingDate: day,
    weekday: pdhlWeekdayLabel(day),
    indexes: [],
    stocks: null,
  };

  const lines: string[] = [];
  lines.push(`# Trade Rejection Analysis — ${day} (${pdhlWeekdayLabel(day)})`);
  lines.push('');
  lines.push('Source: Yahoo Finance 5m (indexes) / 1d (stocks), replayed with champion PDHL + Stocks Desk DNA.');
  lines.push('');

  for (const meta of indexIds) {
    const pack = raw.indexes[meta.key];
    if (!pack?.candles?.length) {
      lines.push(`## ${meta.name}`);
      lines.push('No candle data.');
      lines.push('');
      continue;
    }
    const result = analyzeIndex({
      instrumentId: meta.id,
      instrumentName: meta.name,
      candles: pack.candles,
      tradingDate: day,
    });

    lines.push(`## ${meta.name} (PDHL Opening Range)`);
    lines.push('');
    lines.push('### Session / OR');
    lines.push(
      `- Weekday rule earliest entry: **${result.orSummary.earliestEntry}** · OR ${result.orSummary.orLow}–${result.orSummary.orHigh} (width ${result.orSummary.orWidth})`,
    );
    lines.push(`- Last signal: ${result.lastSignal}`);
    lines.push('');

    lines.push('### Taken trades');
    if (!result.taken.length) {
      lines.push('_None_');
    } else {
      for (const t of result.taken) {
        lines.push(
          `- **${t.direction}** @ ${t.entry.toFixed(2)} (${t.entryTime.slice(11, 16)}) → exit ${t.exit.toFixed(2)} (${t.exitTime.slice(11, 16)}) · ${t.exitReason} · ${t.points.toFixed(1)} pts`,
        );
      }
    }
    lines.push('');

    lines.push('### Skipped while position open');
    if (!result.skippedOpen.length) {
      lines.push('_None_');
    } else {
      for (const e of result.skippedOpen) {
        lines.push(
          `- **${e.time.slice(11, 16)}** — would-be ${e.details['wouldBe']}: \`${e.failedCondition}\` (evaluator: ${e.reason})`,
        );
      }
    }
    lines.push('');

    const near = result.rejections.filter((r) => r.category === 'NEAR_MISS');
    const hard = result.rejections.filter((r) => r.category === 'NO_TRADE');
    const waiting = result.rejections.filter((r) => r.category === 'WAITING');

    lines.push('### Near-misses (setup fired, later gate failed)');
    if (!near.length) {
      lines.push('_None_');
    } else {
      for (const e of near) {
        lines.push(
          `- **${e.time.slice(11, 16)}** · \`${e.failedCondition}\` · reason: ${e.reason} · close=${e.details.close} bias=${e.details.bias}`,
        );
      }
    }
    lines.push('');

    lines.push('### Hard NO_TRADE bars');
    if (!hard.length) {
      lines.push('_None_');
    } else {
      for (const e of hard) {
        lines.push(`- **${e.time.slice(11, 16)}** · \`${e.failedCondition}\` · ${e.reason}`);
      }
    }
    lines.push('');

    lines.push('### Every skipped bar in window (WAITING) — exact failed condition');
    if (!waiting.length) {
      lines.push('_None_');
    } else {
      for (const e of waiting) {
        lines.push(
          `- **${e.time.slice(11, 16)}** · **failed:** \`${e.failedCondition}\` · raw: ${e.reason}`,
        );
      }
    }
    lines.push('');

    lines.push('### Rejection reason tallies');
    for (const row of summarizeReasons(result.rejections)) {
      lines.push(`- ${row.count}× — ${row.reason} → \`${row.failedCondition}\``);
    }
    lines.push('');

    report.indexes.push({
      instrumentId: meta.id,
      orSummary: result.orSummary,
      taken: result.taken,
      skippedOpen: result.skippedOpen,
      nearMisses: near,
      hardNoTrade: hard,
      waiting,
      tallies: summarizeReasons(result.rejections),
    });
  }

  // Stocks
  const stockResult = analyzeStocks(raw.stocks, day);
  lines.push('## Stocks Desk — treasure watchlist');
  lines.push('');
  lines.push('### Accepted (passed gap + size + max-N filters)');
  if (!stockResult.accepted.length) {
    lines.push('_None_');
  } else {
    for (const t of stockResult.accepted) {
      const label = STOCKS_STRATEGY_OPTIONS.find((s) => s.id === t.strategyId)?.label ?? t.strategyId;
      lines.push(
        `- **${t.symbol}** ${t.direction} · ${t.strategyId} (${label}) · entry ${t.entry.toFixed(2)} · gap ${(100 * (t.gapAbs ?? 0)).toFixed(2)}% · ${t.exitReason} PnL ₹${t.pnlRs.toFixed(0)}`,
      );
    }
  }
  lines.push('');
  lines.push('### Rejected potential trades — exact failed condition');
  // Deduplicate identical symbol+strategy+condition noise for gap fails: keep all strategies
  for (const r of stockResult.rejected) {
    lines.push(
      `- **${r.symbol}** / ${r.strategyId} — \`${r.failedCondition}\` · gap=${r.details.gapPct ?? 'n/a'}% open=${r.details.open ?? 'n/a'} prevClose=${r.details.prevClose ?? 'n/a'}`,
    );
  }
  lines.push('');

  report.stocks = stockResult;

  const outDir = join(process.cwd(), 'docs/owner-private');
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `11-TRADE-REJECTION-${day}.md`);
  const jsonPath = join(process.cwd(), 'reports');
  mkdirSync(jsonPath, { recursive: true });
  writeFileSync(mdPath, lines.join('\n'));
  writeFileSync(join(jsonPath, `trade-rejection-${day}.json`), JSON.stringify(report, null, 2));
  console.log(lines.join('\n'));
  console.error(`\nWrote ${mdPath}`);
  console.error(`Wrote reports/trade-rejection-${day}.json`);
}

main();
