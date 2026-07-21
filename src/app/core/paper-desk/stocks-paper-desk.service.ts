import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import { StocksWatchlistService, StocksWatchItem } from '../services/stocks-watchlist.service';
import { StocksMoversService, StocksMover } from '../services/stocks-movers.service';
import {
  assertKiteHistoricalSuccess,
  extractKiteApiError,
  formatUnknownError,
} from '../utils/kite-error.util';
import {
  chunkInclusiveDateRange,
  DESK_HISTORICAL_CHUNK_DAYS,
} from '../kite/kite-historical-limits';
import {
  STOCKS_CAPITAL_RS,
  STOCKS_DAY_LOSS_RS,
  STOCKS_STRATEGY_OPTIONS,
  ALMOST_GREEN_GAP_PCT,
  ALMOST_GREEN_STOP_PCT,
  ALMOST_GREEN_RISK_PCT,
  ALMOST_GREEN_TARGET_PCT,
  StocksDayTrade,
  StocksStrategyId,
  applyMaxTradesPerDayByGap,
  maxPerDayForStrategy,
  qtyForRisk,
  replayStocksDayStrategy,
  resizeTradesForCapitalSplit,
} from '../strategy-engine/strategies/stocks-equity/stocks-equity.evaluator';
import { PaperDeskMode } from './paper-desk.models';

export interface StocksDeskTotals {
  trades: number;
  wins: number;
  losses: number;
  netRs: number;
  greenDays: number;
  redDays: number;
  days: number;
}

export interface StocksDeskSnapshot {
  mode: PaperDeskMode;
  running: boolean;
  realOrders: boolean;
  message: string;
  trades: StocksDayTrade[];
  totals: StocksDeskTotals;
  strategyId: StocksStrategyId;
  capitalRs: number;
  dayLossRs: number;
  symbols: string[];
  moversNote?: string;
  maxLegs?: number;
}

export interface StocksLiveOptions {
  realOrders: boolean;
  strategyId: StocksStrategyId;
  /** Merge top gainers (+ losers for bounce) into scan */
  includeTopGainers: boolean;
  /** Split ₹60k across up to this many names (2–3 typical) */
  maxLegs: number;
}

@Injectable({ providedIn: 'root' })
export class StocksPaperDeskService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);
  private readonly watchlist = inject(StocksWatchlistService);
  private readonly movers = inject(StocksMoversService);

  private runGeneration = 0;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly livePlacedKeys = new Set<string>();

  readonly snapshot = signal<StocksDeskSnapshot>(emptySnapshot('testing'));
  readonly busy = signal(false);

  cancelRun(): void {
    this.runGeneration += 1;
    this.busy.set(false);
    this.snapshot.update((s) => ({ ...s, running: false, message: 'Cancelled' }));
  }

  stopLive(): void {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    this.snapshot.update((s) => ({ ...s, running: false, message: 'Live stopped' }));
  }

  async runTesting(fromDate: string, toDate: string, strategyId: StocksStrategyId): Promise<void> {
    const gen = ++this.runGeneration;
    this.busy.set(true);
    this.snapshot.set({
      ...emptySnapshot('testing'),
      running: true,
      strategyId,
      message: 'Fetching day candles…',
      symbols: this.watchlist.enabledItems().map((x) => x.symbol),
    });

    try {
      await this.instrumentStore.refreshBestEffort(false);
      const auth = this.requireAuth();
      const items = this.watchlist.enabledItems();
      if (!items.length) {
        throw new Error('Enable at least one stock in the watchlist.');
      }

      const allTrades: StocksDayTrade[] = [];
      for (const item of items) {
        if (gen !== this.runGeneration) return;
        const candles = await this.fetchDayRange(auth, item.instrumentToken, fromDate, toDate);
        const sid =
          strategyId === 'GAP_FADE_500' || strategyId === 'ALMOST_GREEN_MIX'
            ? strategyId
            : ((item.strategyId as StocksStrategyId | undefined) ?? strategyId);
        const trades = replayStocksDayStrategy({
          symbol: item.symbol,
          days: candles,
          strategyId: sid,
          capitalRs: STOCKS_CAPITAL_RS,
        });
        allTrades.push(...trades);
        this.snapshot.update((s) => ({
          ...s,
          message: `Tested ${item.symbol} · ${allTrades.length} trades so far`,
        }));
        await sleep(500);
      }

      if (gen !== this.runGeneration) return;
      const maxN = maxPerDayForStrategy(strategyId);
      const capped =
        maxN != null ? applyMaxTradesPerDayByGap(allTrades, maxN) : allTrades;
      const split =
        maxN != null && capped.length > 1
          ? resizeTradesForCapitalSplit(capped, STOCKS_CAPITAL_RS)
          : capped;
      const totals = summarize(split);
      this.snapshot.set({
        mode: 'testing',
        running: false,
        realOrders: false,
        strategyId,
        capitalRs: STOCKS_CAPITAL_RS,
        dayLossRs: STOCKS_DAY_LOSS_RS,
        symbols: items.map((x) => x.symbol),
        trades: split.sort((a, b) => b.date.localeCompare(a.date)),
        totals,
        maxLegs: maxN ?? 1,
        message: `Testing done · ${totals.trades} trades · net ₹${totals.netRs} · green days ${totals.greenDays}/${totals.days}${
          maxN != null ? ` · split ≤${maxN} legs/day` : ''
        }`,
      });
    } catch (e) {
      this.snapshot.update((s) => ({
        ...s,
        running: false,
        message: formatUnknownError(e),
      }));
      throw e;
    } finally {
      this.busy.set(false);
    }
  }

  async startLive(options: StocksLiveOptions): Promise<void> {
    this.stopLive();
    this.livePlacedKeys.clear();
    const auth = this.requireAuth();
    await this.instrumentStore.refreshBestEffort(false);

    const maxLegs = Math.max(1, Math.min(3, options.maxLegs || 3));

    this.snapshot.set({
      ...emptySnapshot('live'),
      running: true,
      realOrders: options.realOrders,
      strategyId: options.strategyId,
      symbols: this.watchlist.enabledItems().map((x) => x.symbol),
      maxLegs,
      message: options.realOrders
        ? `LIVE MONEY · MIS · max ${maxLegs} legs · ₹${STOCKS_CAPITAL_RS} split`
        : `Live paper · max ${maxLegs} legs · gainers=${options.includeTopGainers ? 'on' : 'off'}`,
    });

    const tick = async () => {
      try {
        const today = todayIso();
        const universe = await this.buildLiveUniverse(options.includeTopGainers);
        let moversNote = '';
        if (options.includeTopGainers) {
          const snap = this.movers.snapshot();
          moversNote = `gainers ${snap.gainers
            .slice(0, 5)
            .map((g) => `${g.symbol} ${(g.dayChangePct * 100).toFixed(1)}%`)
            .join(', ')}`;
        }

        let capped: StocksDayTrade[] = [];

        if (options.strategyId === 'ALMOST_GREEN_MIX' && options.includeTopGainers) {
          // Quote-based entry for movers + watchlist (fast path)
          capped = this.signalsFromMoversAndWatch(
            universe.movers,
            universe.watch,
            maxLegs,
            options.strategyId,
          );
        } else {
          const allTrades: StocksDayTrade[] = [];
          for (const item of universe.watch) {
            const candles = await this.fetchDayRange(
              auth,
              item.instrumentToken,
              shiftDays(-10),
              today,
            );
            const sid =
              options.strategyId === 'GAP_FADE_500' || options.strategyId === 'ALMOST_GREEN_MIX'
                ? options.strategyId
                : ((item.strategyId as StocksStrategyId | undefined) ?? options.strategyId);
            const todayTrades = replayStocksDayStrategy({
              symbol: item.symbol,
              days: candles,
              strategyId: sid,
              capitalRs: STOCKS_CAPITAL_RS,
            }).filter((t) => t.date === today);
            allTrades.push(...todayTrades);
            await sleep(400);
          }
          // Merge mover symbols that aren't in watch — fetch day bars
          for (const m of universe.movers) {
            if (universe.watch.some((w) => w.symbol === m.symbol)) continue;
            const candles = await this.fetchDayRange(auth, m.instrumentToken, shiftDays(-10), today);
            const todayTrades = replayStocksDayStrategy({
              symbol: m.symbol,
              days: candles,
              strategyId: options.strategyId,
              capitalRs: STOCKS_CAPITAL_RS,
            }).filter((t) => t.date === today);
            allTrades.push(...todayTrades);
            await sleep(400);
          }
          const maxN = Math.min(maxLegs, maxPerDayForStrategy(options.strategyId) ?? maxLegs);
          capped = applyMaxTradesPerDayByGap(allTrades, maxN);
        }

        const split = resizeTradesForCapitalSplit(capped, STOCKS_CAPITAL_RS);

        if (options.realOrders) {
          for (const t of split) {
            const key = `${today}:${t.symbol}:${t.direction}`;
            if (!this.livePlacedKeys.has(key)) {
              await this.placeEquityMis(auth, t.symbol, t.direction, t.qty);
              this.livePlacedKeys.add(key);
            }
          }
        }

        const totals = summarize(split);
        const legHint =
          split.length > 1
            ? ` · split ₹${Math.round(STOCKS_CAPITAL_RS / split.length)}/leg × ${split.length}`
            : '';
        this.snapshot.update((s) => ({
          ...s,
          trades: split,
          totals,
          maxLegs,
          symbols: [...new Set([...universe.watch.map((w) => w.symbol), ...split.map((t) => t.symbol)])],
          moversNote,
          message: `${options.realOrders ? 'LIVE MONEY' : 'Live paper'} · ${split.length} leg(s)${legHint} · ₹${totals.netRs}${moversNote ? ` · ${moversNote}` : ''}`,
        }));
      } catch (e) {
        this.snapshot.update((s) => ({
          ...s,
          message: formatUnknownError(e),
        }));
      }
    };

    await tick();
    this.liveTimer = setInterval(() => void tick(), 5 * 60 * 1000);
  }

  strategyOptions() {
    return STOCKS_STRATEGY_OPTIONS;
  }

  /** Build entry signals from live quotes (gap vs prev close). */
  private signalsFromMoversAndWatch(
    movers: StocksMover[],
    watch: StocksWatchItem[],
    maxLegs: number,
    strategyId: StocksStrategyId,
  ): StocksDayTrade[] {
    const today = todayIso();
    const bySym = new Map<string, StocksMover>();
    for (const m of movers) bySym.set(m.symbol, m);

    // Ensure watch names appear even if not in top movers (need quote — use mover if present)
    const candidates: StocksMover[] = [...movers];
    for (const w of watch) {
      if (!bySym.has(w.symbol)) {
        // no quote — skip; will need candle path. Prefer movers refresh covering universe.
        continue;
      }
    }

    const signals: StocksDayTrade[] = [];
    for (const m of candidates) {
      const gap = m.gapPct;
      let dir: 'BUY' | 'SELL' | null = null;
      if (strategyId === 'ALMOST_GREEN_MIX') {
        if (gap >= ALMOST_GREEN_GAP_PCT) dir = 'SELL'; // fade gainer gap-up
        else if (gap <= -ALMOST_GREEN_GAP_PCT) dir = 'BUY'; // bounce loser gap-down
      } else if (strategyId === 'GAP_FADE_500' || strategyId === 'GAP_UP_FADE') {
        if (gap >= (strategyId === 'GAP_FADE_500' ? 0.003 : 0.005)) dir = 'SELL';
      } else if (strategyId === 'GAP_DOWN_BOUNCE') {
        if (gap <= -0.005) dir = 'BUY';
      }
      if (!dir) continue;

      const stopPct =
        strategyId === 'ALMOST_GREEN_MIX' ? ALMOST_GREEN_STOP_PCT : strategyId === 'GAP_FADE_500' ? 0.015 : 0.01;
      const riskPct =
        strategyId === 'ALMOST_GREEN_MIX'
          ? ALMOST_GREEN_RISK_PCT
          : strategyId === 'GAP_FADE_500'
            ? 0.025
            : 0.02;
      const entry = m.open > 0 ? m.open : m.lastPrice;
      const stop = dir === 'BUY' ? entry * (1 - stopPct) : entry * (1 + stopPct);
      const qty = qtyForRisk(entry, stop, STOCKS_CAPITAL_RS, riskPct);
      if (qty < 1) continue;

      // Mark-to-market vs last for paper; live places market
      let exit = m.lastPrice;
      let points = dir === 'BUY' ? exit - entry : entry - exit;
      let reason = 'LIVE';
      const targetPct = strategyId === 'ALMOST_GREEN_MIX' ? ALMOST_GREEN_TARGET_PCT : 0;
      if (targetPct > 0) {
        const tp = dir === 'BUY' ? entry * (1 + targetPct) : entry * (1 - targetPct);
        if (dir === 'BUY' && m.lastPrice >= tp) {
          exit = tp;
          points = exit - entry;
          reason = 'TP';
        } else if (dir === 'SELL' && m.lastPrice <= tp) {
          exit = tp;
          points = entry - exit;
          reason = 'TP';
        }
      }

      signals.push({
        symbol: m.symbol,
        date: today,
        direction: dir,
        entry,
        stop,
        exit,
        qty,
        points,
        pnlRs: points * qty,
        strategyId,
        exitReason: reason,
        gapAbs: Math.abs(gap),
      });
    }

    return applyMaxTradesPerDayByGap(signals, maxLegs);
  }

  private async buildLiveUniverse(includeTopGainers: boolean): Promise<{
    watch: StocksWatchItem[];
    movers: StocksMover[];
  }> {
    const watch = this.watchlist.enabledItems();
    let movers: StocksMover[] = [];
    if (includeTopGainers) {
      const snap = await this.movers.refreshMovers({ topN: 10 });
      // Gainers (fade) + losers (bounce) — both sides of ALMOST_GREEN_MIX
      const merged = new Map<string, StocksMover>();
      for (const g of snap.gainers) merged.set(g.symbol, g);
      for (const l of snap.losers) merged.set(l.symbol, l);
      // Also pull quotes for watchlist names missing from top 10
      movers = [...merged.values()];
    }
    return { watch, movers };
  }

  private async placeEquityMis(
    authorization: string,
    tradingSymbol: string,
    transactionType: 'BUY' | 'SELL',
    quantity: number,
  ): Promise<void> {
    if (quantity < 1) return;
    await firstValueFrom(
      this.kiteApi.placeRegularOrder(authorization, {
        exchange: 'NSE',
        tradingsymbol: tradingSymbol,
        transaction_type: transactionType,
        order_type: 'MARKET',
        quantity: String(quantity),
        product: 'MIS',
        validity: 'DAY',
        tag: 'PALAGAI_EQ',
      }),
    );
  }

  private requireAuth(): string {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Generate token in Get Token tab.');
    }
    return authorization;
  }

  private async fetchDayRange(
    authorization: string,
    token: number,
    fromDate: string,
    toDate: string,
  ): Promise<Candle[]> {
    const chunks = chunkInclusiveDateRange(fromDate, toDate, DESK_HISTORICAL_CHUNK_DAYS);
    const out: Candle[] = [];
    for (const chunk of chunks) {
      const from = `${chunk.fromDate} 09:00:00`;
      const to = `${chunk.toDate} 15:30:00`;
      try {
        const response = await firstValueFrom(
          this.kiteApi
            .getHistoricalData({
              instrumentToken: String(token),
              interval: 'day',
              from,
              to,
              authorization,
            })
            .pipe(timeout(45_000)),
        );
        assertKiteHistoricalSuccess(response as KiteHistoricalResponse, 'day');
        const rows = (response as KiteHistoricalResponse).data?.candles ?? [];
        for (const row of rows) {
          out.push({
            date: String(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5] ?? 0),
          });
        }
      } catch (e) {
        if (e instanceof TimeoutError) {
          throw new Error('Kite historical timed out — retry');
        }
        throw new Error(extractKiteApiError(e, 'day'));
      }
      await sleep(350);
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }
}

function summarize(trades: StocksDayTrade[]): StocksDeskTotals {
  const byDay = new Map<string, number>();
  let wins = 0;
  let losses = 0;
  let net = 0;
  for (const t of trades) {
    net += t.pnlRs;
    if (t.pnlRs > 0) wins += 1;
    else if (t.pnlRs < 0) losses += 1;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.pnlRs);
  }
  let green = 0;
  let red = 0;
  for (const v of byDay.values()) {
    if (v > 0) green += 1;
    else if (v < 0) red += 1;
  }
  return {
    trades: trades.length,
    wins,
    losses,
    netRs: Math.round(net),
    greenDays: green,
    redDays: red,
    days: byDay.size,
  };
}

function emptySnapshot(mode: PaperDeskMode): StocksDeskSnapshot {
  return {
    mode,
    running: false,
    realOrders: false,
    message: 'Idle',
    trades: [],
    totals: { trades: 0, wins: 0, losses: 0, netRs: 0, greenDays: 0, redDays: 0, days: 0 },
    strategyId: 'ALMOST_GREEN_MIX',
    capitalRs: STOCKS_CAPITAL_RS,
    dayLossRs: STOCKS_DAY_LOSS_RS,
    symbols: [],
    maxLegs: 3,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
