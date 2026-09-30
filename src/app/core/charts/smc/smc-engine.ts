/**
 * SMC engine — a single forward pass over closed candles.
 *
 * The pipeline is deliberately split into the stages the desk reasons about,
 * each in its own method so none of them leaks into another:
 *
 *   1. market structure   StructureTracker (swings, HH/HL/LH/LL, BOS, CHoCH)
 *   2. trend              StructureTracker.trend + the HTF timeline
 *   3. setup detection    updateSetup(): POI touch, liquidity, reaction
 *   4. entry confirmation confirmEntry(): structure break + confirming candle
 *   5. stop loss          planStop()
 *   6. take profit        planTargets()
 *   7. exit               manageTrade()
 *   8. statistics         smc-stats.ts
 *
 * `step()` is the ONLY entry point and receives one closed candle at a time.
 * History is just `step()` called in a loop, and live is the same call made
 * when the next candle closes, so both share the exact same decisions.
 */
import { Candle } from '../../models/candle.model';
import { SmcConfig } from './smc.config';
import {
  SmcAlertEvent,
  SmcAlertType,
  SmcArmedSetup,
  SmcEqualLevel,
  SmcExitReason,
  SmcFill,
  SmcFvg,
  SmcLiquidity,
  SmcOrderBlock,
  SmcRange,
  SmcSide,
  SmcSignal,
  SmcStructureEvent,
  SmcSwing,
  SmcTrade,
  SmcTrend,
} from './smc.types';
import { HtfTimeline } from './smc-htf';
import { StructureTracker } from './smc-structure';
import { candleTs } from './smc-utils';

interface PendingTrigger {
  event: SmcStructureEvent;
  expiresAt: number;
}

interface TradePlan {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tpFinal: number;
  risk: number;
  rr: number;
}

interface BarFlags {
  sweptSsl: boolean;
  sweptBsl: boolean;
}

export class SmcEngine {
  readonly tracker: StructureTracker;
  readonly orderBlocks: SmcOrderBlock[] = [];
  readonly fvgs: SmcFvg[] = [];
  readonly liquidity: SmcLiquidity[] = [];
  readonly trades: SmcTrade[] = [];
  readonly signals: SmcSignal[] = [];
  readonly alerts: SmcAlertEvent[] = [];
  readonly htfTrendAt: (SmcTrend | null)[] = [];

  range: SmcRange | null = null;
  setups: Record<SmcSide, SmcArmedSetup | null> = { BUY: null, SELL: null };
  equity: number;

  private readonly pending: Record<SmcSide, PendingTrigger | null> = { BUY: null, SELL: null };
  private readonly lastEntryAt: Record<SmcSide, number> = { BUY: -1e9, SELL: -1e9 };
  private rangeHi = NaN;
  private rangeLo = NaN;
  private tradeSeq = 0;
  private readonly barMs: number;

  constructor(
    private readonly cfg: SmcConfig,
    private readonly htf: HtfTimeline | null,
    barMinutes: number,
  ) {
    this.barMs = barMinutes * 60_000;
    this.equity = cfg.initialCapital;
    this.tracker = new StructureTracker({
      swingLength: cfg.swingLength,
      atrPeriod: cfg.atrPeriod,
      eqTolAtr: cfg.eqTolAtr,
      eqLookbackSwings: cfg.eqLookbackSwings,
      breakBufferAtr: cfg.breakBufferAtr,
      rangeSwings: cfg.rangeSwings,
      sidewaysRangeAtr: cfg.sidewaysRangeAtr,
    });
  }

  get bars(): Candle[] {
    return this.tracker.bars;
  }

  /**
   * Feed the next CLOSED candle. `asOfTs` caps the clock the higher timeframe
   * is read at, and is only used for the preview of a still-forming candle.
   */
  step(bar: Candle, asOfTs?: number): void {
    const st = this.tracker.step(bar);
    const i = this.tracker.bars.length - 1;
    const atr = this.tracker.atr[i]!;
    const ts = candleTs(bar.date);
    const closeTs = ts + this.barMs;
    const htfClock = asOfTs != null ? Math.min(closeTs, asOfTs) : closeTs;
    const htfTrend = this.htf ? this.htf.trendAt(htfClock) : null;
    const prevHtf = i > 0 ? (this.htfTrendAt[i - 1] ?? null) : null;
    this.htfTrendAt.push(htfTrend);

    const flags = this.sweepLiquidity(bar, i);
    for (const swing of st.swings) this.addLiquidity(swing, i);
    for (const eq of st.equalLevels) this.addEqualLiquidity(eq, i);

    this.updateOrderBlocks(bar, i);
    this.updateFvgs(bar, i);

    const event = st.event;
    if (event) {
      this.alertStructure(event, bar);
      this.createOrderBlock(event, i, atr);
    }
    this.detectFvg(i, atr);
    this.updateRange(st.swings, bar, i, atr);

    this.manageTrades(bar, i, ts, event, htfTrend, prevHtf);
    for (const side of ['BUY', 'SELL'] as const) {
      this.updateSetup(side, bar, i, flags, event, htfTrend);
      this.confirmEntry(side, bar, i, ts, atr);
    }
  }

  // ---------------------------------------------------------------- liquidity

  private addLiquidity(swing: SmcSwing, i: number): void {
    this.liquidity.push({
      id: `liq-${swing.id}`,
      side: swing.kind === 'high' ? 'BSL' : 'SSL',
      price: swing.price,
      index: swing.index,
      confirmedAt: i,
      equal: false,
      sweptAt: null,
      rejected: false,
    });
  }

  private addEqualLiquidity(eq: SmcEqualLevel, i: number): void {
    this.liquidity.push({
      id: `liq-${eq.id}`,
      side: eq.kind === 'EQH' ? 'BSL' : 'SSL',
      price: eq.price,
      index: eq.indexB,
      confirmedAt: i,
      equal: true,
      sweptAt: null,
      rejected: false,
    });
  }

  /** Resting stops above highs / below lows that this candle traded through. */
  private sweepLiquidity(bar: Candle, i: number): BarFlags {
    const flags: BarFlags = { sweptSsl: false, sweptBsl: false };
    for (const level of this.liquidity) {
      if (level.sweptAt != null) continue;
      if (level.side === 'BSL' && bar.high > level.price) {
        level.sweptAt = i;
        level.rejected = bar.close < level.price;
        flags.sweptBsl = true;
      } else if (level.side === 'SSL' && bar.low < level.price) {
        level.sweptAt = i;
        level.rejected = bar.close > level.price;
        flags.sweptSsl = true;
      }
    }
    return flags;
  }

  // ------------------------------------------------------------- order blocks

  private createOrderBlock(event: SmcStructureEvent, i: number, atr: number): void {
    const bars = this.tracker.bars;
    const bull = event.dir === 'bull';
    let pick = -1;
    for (let k = Math.max(0, event.swingIndex); k < i; k += 1) {
      if (pick < 0) {
        pick = k;
        continue;
      }
      // Ties go to the later bar, the one nearest the impulse.
      if (bull ? bars[k]!.low <= bars[pick]!.low : bars[k]!.high >= bars[pick]!.high) pick = k;
    }
    if (pick < 0) return;
    const src = bars[pick]!;
    let lo = src.low;
    let hi = src.high;
    const cap = this.cfg.obMaxAtr * atr;
    if (hi - lo > cap) {
      lo = Math.min(src.open, src.close);
      hi = Math.max(src.open, src.close);
      if (hi - lo > cap) return;
    }
    if (!(hi > lo)) return;
    this.orderBlocks.push({
      id: `ob-${event.dir}-${i}`,
      dir: event.dir,
      index: pick,
      confirmedAt: i,
      lo,
      hi,
      touchedAt: null,
      status: 'active',
      endedAt: null,
      eventId: event.id,
    });
  }

  private updateOrderBlocks(bar: Candle, i: number): void {
    for (const ob of this.orderBlocks) {
      if (ob.status !== 'active' || ob.confirmedAt >= i) continue;
      if (ob.dir === 'bull') {
        if (bar.close < ob.lo) {
          ob.status = 'invalidated';
          ob.endedAt = i;
        } else if (ob.touchedAt == null && bar.low <= ob.hi) {
          ob.touchedAt = i;
        }
      } else if (bar.close > ob.hi) {
        ob.status = 'invalidated';
        ob.endedAt = i;
      } else if (ob.touchedAt == null && bar.high >= ob.lo) {
        ob.touchedAt = i;
      }
    }
  }

  // ---------------------------------------------------------------------- FVG

  private detectFvg(i: number, atr: number): void {
    if (i < 2) return;
    const bars = this.tracker.bars;
    const a = bars[i - 2]!;
    const c = bars[i]!;
    const min = this.cfg.fvgMinAtr * atr;
    if (c.low > a.high && c.low - a.high >= min && c.low - a.high > 0) {
      this.fvgs.push({
        id: `fvg-bull-${i - 1}`,
        dir: 'bull',
        index: i - 1,
        confirmedAt: i,
        lo: a.high,
        hi: c.low,
        status: 'active',
        endedAt: null,
      });
    } else if (c.high < a.low && a.low - c.high >= min && a.low - c.high > 0) {
      this.fvgs.push({
        id: `fvg-bear-${i - 1}`,
        dir: 'bear',
        index: i - 1,
        confirmedAt: i,
        lo: c.high,
        hi: a.low,
        status: 'active',
        endedAt: null,
      });
    }
  }

  private updateFvgs(bar: Candle, i: number): void {
    for (const gap of this.fvgs) {
      if (gap.status !== 'active' || gap.confirmedAt >= i) continue;
      if (gap.dir === 'bull' ? bar.close < gap.lo : bar.close > gap.hi) {
        gap.status = 'filled';
        gap.endedAt = i;
      }
    }
  }

  // -------------------------------------------------------- premium / discount

  /**
   * Dealing range: the latest confirmed swing high to the latest confirmed
   * swing low, stretched by any newer extreme. Everything in it is causal.
   */
  private updateRange(newSwings: SmcSwing[], bar: Candle, i: number, atr: number): void {
    const bars = this.tracker.bars;
    for (const swing of newSwings) {
      let value = swing.price;
      for (let k = swing.index + 1; k <= i; k += 1) {
        value = swing.kind === 'high' ? Math.max(value, bars[k]!.high) : Math.min(value, bars[k]!.low);
      }
      if (swing.kind === 'high') this.rangeHi = value;
      else this.rangeLo = value;
    }
    if (Number.isFinite(this.rangeHi)) this.rangeHi = Math.max(this.rangeHi, bar.high);
    if (Number.isFinite(this.rangeLo)) this.rangeLo = Math.min(this.rangeLo, bar.low);
    const hi = this.rangeHi;
    const lo = this.rangeLo;
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi - lo >= atr) {
      const startIndex = Math.min(
        this.lastSwingIndex('high') ?? i,
        this.lastSwingIndex('low') ?? i,
      );
      this.range = { hi, lo, eq: (hi + lo) / 2, since: i, startIndex };
    } else {
      this.range = null;
    }
  }

  private lastSwingIndex(kind: 'high' | 'low'): number | null {
    const swings = this.tracker.swings;
    for (let k = swings.length - 1; k >= 0; k -= 1) {
      if (swings[k]!.kind === kind) return swings[k]!.index;
    }
    return null;
  }

  // ------------------------------------------------------------ setup / entry

  /** The trend an entry is checked against: HTF where it exists. */
  private gateTrend(htfTrend: SmcTrend | null): SmcTrend | null {
    if (this.htf) return htfTrend;
    return this.tracker.trend;
  }

  private updateSetup(
    side: SmcSide,
    bar: Candle,
    i: number,
    flags: BarFlags,
    event: SmcStructureEvent | null,
    htfTrend: SmcTrend | null,
  ): void {
    const long = side === 'BUY';
    const cfg = this.cfg;
    const gate = this.gateTrend(htfTrend);
    const trendOk = !cfg.requireHtfTrend || gate === (long ? 'bullish' : 'bearish');
    if (!trendOk) {
      this.setups[side] = null;
      this.pending[side] = null;
      return;
    }

    let setup = this.setups[side];
    if (setup && i - setup.lastTouchAt > cfg.setupExpiryBars) {
      setup = null;
      this.setups[side] = null;
      this.pending[side] = null;
    }

    const poi: string[] = [];
    let obId: string | null = null;
    if (i - this.lastEntryAt[side] > cfg.cooldownBars) {
      const range = this.range;
      if (cfg.useDiscountPremium && range) {
        const span = range.hi - range.lo;
        const hit = long
          ? bar.low <= range.lo + cfg.pdThreshold * span
          : bar.high >= range.hi - cfg.pdThreshold * span;
        if (hit) poi.push(long ? 'Discount' : 'Premium');
      }
      if (cfg.useOrderBlock) {
        const ob = this.touchedOrderBlock(long ? 'bull' : 'bear', bar, i);
        if (ob) {
          poi.push('Order block');
          obId = ob.id;
        }
      }
      if (cfg.useFvg && this.touchedFvg(long ? 'bull' : 'bear', bar, i)) poi.push('FVG');
      if (cfg.useLiquiditySweep && (long ? flags.sweptSsl : flags.sweptBsl)) {
        poi.push('Liquidity sweep');
      }
    }

    const touching = poi.length >= cfg.minConfluence;
    if (touching) {
      if (!setup) {
        setup = {
          side,
          armedAt: i,
          armedDate: bar.date,
          lastTouchAt: i,
          poi: [],
          reacted: false,
          extreme: long ? bar.low : bar.high,
          obId: null,
        };
        this.setups[side] = setup;
      }
      setup.lastTouchAt = i;
      for (const label of poi) if (!setup.poi.includes(label)) setup.poi.push(label);
      if (obId) setup.obId = obId;
      const sweep = long ? flags.sweptSsl : flags.sweptBsl;
      if (sweep || this.isReaction(long, bar)) setup.reacted = true;
    } else if (setup && (long ? flags.sweptSsl : flags.sweptBsl)) {
      setup.reacted = true;
    }
    if (setup) {
      setup.extreme = long ? Math.min(setup.extreme, bar.low) : Math.max(setup.extreme, bar.high);
      if (setup.obId) {
        const ob = this.orderBlocks.find((o) => o.id === setup!.obId);
        if (ob && ob.status !== 'active') setup.obId = null;
      }
    }

    // A same-direction break arms the trigger only if the setup is ready.
    if (event && setup && event.dir === (long ? 'bull' : 'bear')) {
      const allowed =
        cfg.entryTrigger === 'both' ||
        (cfg.entryTrigger === 'choch' && event.kind === 'CHoCH') ||
        (cfg.entryTrigger === 'bos' && event.kind === 'BOS');
      if (allowed && (!cfg.requireSweepOrReaction || setup.reacted)) {
        this.pending[side] = { event, expiresAt: i + cfg.confirmWindowBars };
      }
    }
  }

  private touchedOrderBlock(dir: 'bull' | 'bear', bar: Candle, i: number): SmcOrderBlock | null {
    let best: SmcOrderBlock | null = null;
    for (const ob of this.orderBlocks) {
      if (ob.dir !== dir || ob.status !== 'active' || ob.confirmedAt >= i) continue;
      if (bar.low <= ob.hi && bar.high >= ob.lo) {
        if (!best || ob.confirmedAt > best.confirmedAt) best = ob;
      }
    }
    return best;
  }

  private touchedFvg(dir: 'bull' | 'bear', bar: Candle, i: number): boolean {
    return this.fvgs.some(
      (g) =>
        g.dir === dir &&
        g.status === 'active' &&
        g.confirmedAt < i &&
        bar.low <= g.hi &&
        bar.high >= g.lo,
    );
  }

  /** Rejection candle: closes in its favour with a long wick into the level. */
  private isReaction(long: boolean, bar: Candle): boolean {
    const range = bar.high - bar.low;
    if (range <= 0) return false;
    if (long) {
      return bar.close > bar.open && (Math.min(bar.open, bar.close) - bar.low) / range >= this.cfg.reactionWickRatio;
    }
    return bar.close < bar.open && (bar.high - Math.max(bar.open, bar.close)) / range >= this.cfg.reactionWickRatio;
  }

  private confirmEntry(
    side: SmcSide,
    bar: Candle,
    i: number,
    ts: number,
    atr: number,
  ): void {
    const pending = this.pending[side];
    const setup = this.setups[side];
    if (!pending || !setup) return;
    const long = side === 'BUY';
    const level = pending.event.level;

    // Price gave the break straight back: the break is void.
    if (long ? bar.close < level : bar.close > level) {
      this.pending[side] = null;
      return;
    }
    const confirming = long
      ? bar.close > bar.open && bar.close > level
      : bar.close < bar.open && bar.close < level;
    if (!confirming) {
      if (i >= pending.expiresAt) this.pending[side] = null;
      return;
    }

    this.pending[side] = null;
    const open = this.trades.filter((t) => t.status === 'open');
    if (open.length >= this.cfg.maxOpenPositions) return;

    const ob = setup.obId ? (this.orderBlocks.find((o) => o.id === setup.obId) ?? null) : null;
    const plan = this.planTrade(side, bar.close, atr, setup, pending.event, ob);
    this.setups[side] = null;
    this.lastEntryAt[side] = i;
    if (!plan) return;
    this.openTrade(side, bar, i, ts, plan, setup, pending.event, ob);
  }

  // -------------------------------------------------- stop loss / take profit

  private planTrade(
    side: SmcSide,
    entry: number,
    atr: number,
    setup: SmcArmedSetup,
    event: SmcStructureEvent,
    ob: SmcOrderBlock | null,
  ): TradePlan | null {
    const sl = this.planStop(side, entry, atr, setup, event, ob);
    if (sl == null) return null;
    const risk = Math.abs(entry - sl);
    if (!(risk > 0) || risk > this.cfg.maxRiskAtr * atr) return null;
    const targets = this.planTargets(side, entry, risk);
    if (!targets) return null;
    return { entry, sl, risk, ...targets };
  }

  private planStop(
    side: SmcSide,
    entry: number,
    atr: number,
    setup: SmcArmedSetup,
    event: SmcStructureEvent,
    ob: SmcOrderBlock | null,
  ): number | null {
    const cfg = this.cfg;
    const long = side === 'BUY';
    const buffer = cfg.slBufferAtr * atr;
    let sl: number;
    if (cfg.slMethod === 'atr') {
      sl = long ? entry - cfg.slAtrMult * atr : entry + cfg.slAtrMult * atr;
    } else if (cfg.slMethod === 'orderBlock' && ob) {
      sl = long ? ob.lo - buffer : ob.hi + buffer;
    } else {
      const bars = this.tracker.bars;
      let extreme = setup.extreme;
      for (let k = Math.max(0, event.swingIndex); k < bars.length; k += 1) {
        extreme = long ? Math.min(extreme, bars[k]!.low) : Math.max(extreme, bars[k]!.high);
      }
      sl = long ? extreme - buffer : extreme + buffer;
    }
    const floor = cfg.minRiskAtr * atr;
    if (long ? entry - sl < floor : sl - entry < floor) {
      sl = long ? entry - floor : entry + floor;
    }
    if (long ? sl >= entry : sl <= entry) return null;
    return sl;
  }

  private planTargets(
    side: SmcSide,
    entry: number,
    risk: number,
  ): { tp1: number; tp2: number; tpFinal: number; rr: number } | null {
    const cfg = this.cfg;
    const long = side === 'BUY';
    const dirSign = long ? 1 : -1;
    let finalDistance = risk * Math.max(cfg.minRR, cfg.minRR * cfg.targetMultiplier);

    if (cfg.tpMethod === 'structure') {
      let best: number | null = null;
      for (const level of this.liquidity) {
        if (level.sweptAt != null) continue;
        if (long ? level.side !== 'BSL' || level.price <= entry : level.side !== 'SSL' || level.price >= entry) {
          continue;
        }
        const distance = Math.abs(level.price - entry);
        if (distance / risk + 1e-9 < cfg.minRR) continue;
        if (best == null || distance < best) best = distance;
      }
      if (best != null) finalDistance = best;
      else if (!cfg.structureFallback) return null;
    }

    const rr = finalDistance / risk;
    if (rr + 1e-9 < cfg.minRR) return null;
    return {
      tp1: entry + dirSign * finalDistance * cfg.tp1Fraction,
      tp2: entry + dirSign * finalDistance * cfg.tp2Fraction,
      tpFinal: entry + dirSign * finalDistance,
      rr,
    };
  }

  private openTrade(
    side: SmcSide,
    bar: Candle,
    i: number,
    ts: number,
    plan: TradePlan,
    setup: SmcArmedSetup,
    event: SmcStructureEvent,
    ob: SmcOrderBlock | null,
  ): void {
    const id = `T${(this.tradeSeq += 1)}-${side}-${i}`;
    const units = (this.equity * (this.cfg.riskPerTradePct / 100)) / plan.risk;
    const trade: SmcTrade = {
      id,
      side,
      entryIndex: i,
      entryDate: bar.date,
      entryTs: ts,
      entryPrice: plan.entry,
      sl: plan.sl,
      slNow: plan.sl,
      tp1: plan.tp1,
      tp2: plan.tp2,
      tpFinal: plan.tpFinal,
      risk: plan.risk,
      rr: plan.rr,
      units,
      poi: [...setup.poi],
      triggerKind: event.kind,
      triggerEventId: event.id,
      obId: ob?.id ?? null,
      status: 'open',
      fills: [],
      remaining: 1,
      exitIndex: null,
      exitDate: null,
      exitTs: null,
      exitPrice: null,
      exitReason: null,
      rMultiple: null,
      returnPct: null,
    };
    this.trades.push(trade);
    this.signals.push({
      id: `sig-${id}`,
      side,
      index: i,
      date: bar.date,
      price: plan.entry,
      tradeId: id,
    });
    this.pushAlert(side, i, bar.date, plan.entry, `Confirmed ${side} @ ${fmtPrice(plan.entry)}`, id);
  }

  // --------------------------------------------------------------------- exit

  private manageTrades(
    bar: Candle,
    i: number,
    ts: number,
    event: SmcStructureEvent | null,
    htfTrend: SmcTrend | null,
    prevHtf: SmcTrend | null,
  ): void {
    for (const trade of this.trades) {
      if (trade.status !== 'open' || trade.entryIndex >= i) continue;
      this.manageTrade(trade, bar, i, ts, event, htfTrend, prevHtf);
    }
  }

  private manageTrade(
    t: SmcTrade,
    bar: Candle,
    i: number,
    ts: number,
    event: SmcStructureEvent | null,
    htfTrend: SmcTrend | null,
    prevHtf: SmcTrend | null,
  ): void {
    const cfg = this.cfg;
    const long = t.side === 'BUY';
    const hit = (level: number) => (long ? bar.high >= level : bar.low <= level);

    // The stop is tested first: when one candle spans both the stop and a
    // target the order inside it is unknowable, so the worst case is assumed.
    if (long ? bar.low <= t.slNow : bar.high >= t.slNow) {
      const price = long ? Math.min(t.slNow, bar.open) : Math.max(t.slNow, bar.open);
      const moved = long ? t.slNow > t.sl : t.slNow < t.sl;
      this.fill(t, 'STOP', i, bar.date, price, t.remaining);
      this.alertForTrade(t, 'STOP_LOSS', i, bar, price, `Stop loss ${t.side} @ ${fmtPrice(price)}`);
      this.close(t, i, bar.date, ts, moved ? 'breakeven_stop' : 'stop_loss');
      return;
    }

    const p = cfg.partialPct;
    if (!t.fills.some((f) => f.kind === 'TP1') && hit(t.tp1)) {
      this.fill(t, 'TP1', i, bar.date, t.tp1, Math.min(t.remaining, p[0] / 100));
      this.alertForTrade(t, 'TP1', i, bar, t.tp1, `TP1 hit ${t.side} @ ${fmtPrice(t.tp1)}`);
      if (cfg.moveStopToBreakeven) t.slNow = t.entryPrice;
    }
    if (
      t.fills.some((f) => f.kind === 'TP1') &&
      !t.fills.some((f) => f.kind === 'TP2') &&
      hit(t.tp2)
    ) {
      this.fill(t, 'TP2', i, bar.date, t.tp2, Math.min(t.remaining, p[1] / 100));
      this.alertForTrade(t, 'TP2', i, bar, t.tp2, `TP2 hit ${t.side} @ ${fmtPrice(t.tp2)}`);
      if (cfg.moveStopToBreakeven) t.slNow = t.tp1;
    }
    if (t.fills.some((f) => f.kind === 'TP2') && hit(t.tpFinal)) {
      this.fill(t, 'FINAL', i, bar.date, t.tpFinal, t.remaining);
      this.alertForTrade(t, 'FINAL_TP', i, bar, t.tpFinal, `Final TP ${t.side} @ ${fmtPrice(t.tpFinal)}`);
      this.close(t, i, bar.date, ts, 'take_profit');
      return;
    }
    if (t.remaining <= 1e-9) {
      this.close(t, i, bar.date, ts, 'take_profit');
      return;
    }

    // Everything below acts on the CLOSE of a confirmed candle, never on a wick.
    const opposite = long ? 'bearish' : 'bullish';
    let reason: SmcExitReason | null = null;
    if (cfg.exitOnTrendReversal && htfTrend === opposite && prevHtf !== opposite) {
      reason = 'trend_reversal';
    } else if (cfg.exitOnObInvalidation && t.obId) {
      const ob = this.orderBlocks.find((o) => o.id === t.obId);
      if (ob && ob.status === 'invalidated' && ob.endedAt === i) reason = 'setup_invalidated';
    }
    if (
      !reason &&
      cfg.exitOnOppositeStructure &&
      event &&
      event.dir === (long ? 'bear' : 'bull')
    ) {
      reason = 'opposite_structure';
    }
    if (reason) {
      this.fill(t, 'EXIT', i, bar.date, bar.close, t.remaining);
      this.close(t, i, bar.date, ts, reason);
    }
  }

  private fill(
    t: SmcTrade,
    kind: SmcFill['kind'],
    index: number,
    date: string,
    price: number,
    fraction: number,
  ): void {
    const share = Math.max(0, Math.min(t.remaining, fraction));
    t.fills.push({ kind, index, date, price, fraction: share });
    t.remaining = Math.max(0, t.remaining - share);
  }

  private close(t: SmcTrade, index: number, date: string, ts: number, reason: SmcExitReason): void {
    const long = t.side === 'BUY';
    let weighted = 0;
    let size = 0;
    let r = 0;
    for (const f of t.fills) {
      weighted += f.price * f.fraction;
      size += f.fraction;
      r += ((long ? f.price - t.entryPrice : t.entryPrice - f.price) / t.risk) * f.fraction;
    }
    t.status = 'closed';
    t.remaining = 0;
    t.exitIndex = index;
    t.exitDate = date;
    t.exitTs = ts;
    t.exitPrice = size > 0 ? weighted / size : t.entryPrice;
    t.exitReason = reason;
    t.rMultiple = r;
    t.returnPct = r * this.cfg.riskPerTradePct;
    this.equity *= 1 + t.returnPct / 100;
    this.pushAlert(
      'EXIT',
      index,
      date,
      t.exitPrice,
      `Exit ${t.side} @ ${fmtPrice(t.exitPrice)} — ${EXIT_TEXT[reason]}`,
      t.id,
    );
  }

  // ------------------------------------------------------------------- alerts

  private alertStructure(event: SmcStructureEvent, bar: Candle): void {
    const type: SmcAlertType =
      event.kind === 'BOS'
        ? event.dir === 'bull'
          ? 'BOS_BULL'
          : 'BOS_BEAR'
        : event.dir === 'bull'
          ? 'CHOCH_BULL'
          : 'CHOCH_BEAR';
    this.pushAlert(
      type,
      event.index,
      bar.date,
      bar.close,
      `${event.dir === 'bull' ? 'Bullish' : 'Bearish'} ${event.kind} @ ${fmtPrice(event.level)}`,
      event.id,
    );
  }

  private alertForTrade(
    t: SmcTrade,
    type: SmcAlertType,
    index: number,
    bar: Candle,
    price: number,
    message: string,
  ): void {
    this.pushAlert(type, index, bar.date, price, message, t.id);
  }

  private pushAlert(
    type: SmcAlertType,
    index: number,
    date: string,
    price: number,
    message: string,
    key: string,
  ): void {
    this.alerts.push({
      id: `${type}|${key}|${index}`,
      type,
      index,
      date,
      ts: candleTs(date),
      price,
      message,
    });
  }
}

const EXIT_TEXT: Record<SmcExitReason, string> = {
  stop_loss: 'stop loss',
  breakeven_stop: 'protective stop',
  take_profit: 'final target',
  opposite_structure: 'opposite structure',
  trend_reversal: 'trend reversal',
  setup_invalidated: 'setup invalidated',
};

function fmtPrice(value: number): string {
  return value.toFixed(2);
}
