/**
 * Canvas painter for the SMC overlay.
 *
 * Kept apart from the candle chart so the chart stays about scrolling, zoom
 * and the axes. It paints two passes around the candles:
 *
 *   under  premium / discount, order blocks, fair value gaps
 *   over   liquidity, BOS / CHoCH, swing labels, trades and signals
 *
 * Clutter control: geometry is drawn first, then text labels are placed in a
 * fixed priority order (signals, exits, structure, zones, swings) and any label
 * that would land on one already placed is dropped, never stacked.
 */
import { Candle } from '../../../core/models/candle.model';
import { SmcLayers } from '../../../core/charts/smc/smc-settings';
import {
  SmcAnalysis,
  SmcFill,
  SmcOrderBlock,
  SmcTrade,
} from '../../../core/charts/smc/smc.types';

export interface PaintFrame {
  ctx: CanvasRenderingContext2D;
  bars: Candle[];
  smc: SmcAnalysis;
  layers: SmcLayers;
  xOf: (index: number) => number;
  yOf: (price: number) => number;
  slotW: number;
  first: number;
  last: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const C = {
  bull: '#00897b',
  bear: '#d32f2f',
  bullFill: 'rgba(38, 166, 154, 0.16)',
  bearFill: 'rgba(239, 83, 80, 0.16)',
  bullEdge: 'rgba(0, 137, 123, 0.7)',
  bearEdge: 'rgba(211, 47, 47, 0.7)',
  fvgBull: 'rgba(38, 166, 154, 0.10)',
  fvgBear: 'rgba(239, 83, 80, 0.10)',
  premium: 'rgba(239, 83, 80, 0.06)',
  discount: 'rgba(38, 166, 154, 0.07)',
  eq: 'rgba(120, 123, 134, 0.7)',
  liquidity: '#b45309',
  liquiditySwept: 'rgba(180, 83, 9, 0.35)',
  swing: '#787b86',
  ink: '#0f172a',
  halo: 'rgba(255, 255, 255, 0.88)',
  pending: '#b45309',
  riskBand: 'rgba(239, 83, 80, 0.16)',
  rewardBand: 'rgba(34, 184, 207, 0.16)',
  golden: 'rgba(120, 123, 134, 0.22)',
  goldenEdge: 'rgba(71, 85, 105, 0.6)',
  fibLine: 'rgba(120, 123, 134, 0.55)',
  neutral: '#475569',
} as const;

const FONT = '600 9px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_H = 9;
const ARROW_W = 9;
const ARROW_H = 8;
const ARROW_GAP = 6;

const EXIT_SHORT: Record<string, string> = {
  stop_loss: 'SL',
  breakeven_stop: 'BE',
  take_profit: 'TP',
  opposite_structure: 'CHoCH',
  trend_reversal: 'TREND',
  setup_invalidated: 'OB',
};

/** Open trades and the most recent one — the only ones that get full level lines. */
export function focusTrades(smc: SmcAnalysis): SmcTrade[] {
  const open = smc.trades.filter((t) => t.status === 'open');
  const latest = smc.trades.length ? smc.trades[smc.trades.length - 1]! : null;
  if (latest && !open.includes(latest)) open.push(latest);
  return open;
}

/** Text lines describing what happened on bar `index`, for the hover legend. */
export function smcNoteAt(smc: SmcAnalysis | null, index: number): string[] {
  if (!smc) return [];
  const out: string[] = [];
  for (const e of smc.structure) {
    if (e.index === index) out.push(`${e.dir === 'bull' ? 'Bullish' : 'Bearish'} ${e.kind}`);
  }
  for (const t of smc.trades) {
    if (t.entryIndex === index) out.push(`${t.side} @ ${t.entryPrice.toFixed(2)} · RR ${t.rr.toFixed(1)}`);
    for (const f of t.fills) {
      if (f.index === index) out.push(`${fillLabel(f)} @ ${f.price.toFixed(2)}`);
    }
  }
  return out;
}

export function paintSmcUnder(f: PaintFrame): void {
  const { ctx, smc, layers } = f;
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.left, f.top, f.right - f.left, f.bottom - f.top);
  ctx.clip();

  if (layers.premiumDiscount && smc.range) paintPremiumDiscount(f);
  if (layers.fib) paintFibonacci(f);
  if (layers.fvg) paintFvgs(f);
  if (layers.orderBlocks) paintOrderBlocks(f);
  ctx.restore();
}

export function paintSmcOver(f: PaintFrame): void {
  const { ctx, smc, layers } = f;
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.left, f.top, f.right - f.left, f.bottom - f.top);
  ctx.clip();
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  const placed: Box[] = [];

  if (layers.levels) paintTradeLevels(f);
  if (layers.liquidity) paintLiquidityLines(f);
  if (layers.structure) paintStructureLines(f);

  // Text, most important first: a dropped label is always the least useful.
  paintSignals(f, placed);
  paintFills(f, placed);
  if (layers.levels) paintLevelLabels(f, placed);
  paintPreview(f, placed);
  if (layers.structure) paintStructureLabels(f, placed);
  if (layers.orderBlocks) paintZoneLabels(f, placed);
  if (layers.liquidity) paintLiquidityLabels(f, placed);
  if (layers.fib) paintFibLabels(f, placed);
  if (layers.premiumDiscount && smc.range) paintPdLabels(f, placed);
  if (layers.swings) paintSwingLabels(f, placed);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ------------------------------------------------------------------ zones

function clampX(f: PaintFrame, x: number): number {
  return Math.min(f.right, Math.max(f.left, x));
}

function paintPremiumDiscount(f: PaintFrame): void {
  const { ctx, smc } = f;
  const r = smc.range!;
  const th = smc.config.pdThreshold;
  const span = r.hi - r.lo;
  const x0 = clampX(f, f.xOf(Math.max(f.first, r.startIndex)) - f.slotW / 2);
  const x1 = f.right;
  const premiumTop = f.yOf(r.hi);
  const premiumBot = f.yOf(r.hi - th * span);
  const discountTop = f.yOf(r.lo + th * span);
  const discountBot = f.yOf(r.lo);
  ctx.fillStyle = C.premium;
  ctx.fillRect(x0, premiumTop, x1 - x0, premiumBot - premiumTop);
  ctx.fillStyle = C.discount;
  ctx.fillRect(x0, discountTop, x1 - x0, discountBot - discountTop);
  ctx.strokeStyle = C.eq;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  const y = Math.round(f.yOf(r.eq)) + 0.5;
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintFvgs(f: PaintFrame): void {
  const { ctx, smc } = f;
  const shown = smc.fvgs.filter((g) => g.status === 'active').slice(-smc.config.maxFvgs);
  for (const g of shown) {
    const x0 = clampX(f, f.xOf(g.index) - f.slotW / 2);
    const y0 = f.yOf(g.hi);
    const y1 = f.yOf(g.lo);
    ctx.fillStyle = g.dir === 'bull' ? C.fvgBull : C.fvgBear;
    ctx.fillRect(x0, y0, f.right - x0, Math.max(2, y1 - y0));
    ctx.strokeStyle = g.dir === 'bull' ? C.bullEdge : C.bearEdge;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, f.right - x0, Math.max(2, y1 - y0));
    ctx.setLineDash([]);
  }
}

/** Active blocks (latest few per side) plus any block a shown trade used. */
function visibleOrderBlocks(f: PaintFrame): SmcOrderBlock[] {
  const { smc } = f;
  const cap = smc.config.maxOrderBlocks;
  const active = smc.orderBlocks.filter((o) => o.status === 'active');
  const pick = (dir: 'bull' | 'bear') => active.filter((o) => o.dir === dir).slice(-cap);
  const used = new Set(smc.trades.map((t) => t.obId).filter((id): id is string => !!id));
  const shown = new Map<string, SmcOrderBlock>();
  for (const o of [...pick('bull'), ...pick('bear')]) shown.set(o.id, o);
  for (const o of smc.orderBlocks) if (used.has(o.id)) shown.set(o.id, o);
  return [...shown.values()];
}

function paintOrderBlocks(f: PaintFrame): void {
  const { ctx } = f;
  for (const o of visibleOrderBlocks(f)) {
    const end = o.endedAt != null ? f.xOf(o.endedAt) : f.right;
    if (end < f.left) continue;
    const x0 = clampX(f, f.xOf(o.index) - f.slotW / 2);
    const x1 = clampX(f, end);
    if (x1 <= x0) continue;
    const y0 = f.yOf(o.hi);
    const y1 = f.yOf(o.lo);
    const h = Math.max(3, y1 - y0);
    ctx.fillStyle = o.dir === 'bull' ? C.bullFill : C.bearFill;
    ctx.fillRect(x0, y0, x1 - x0, h);
    ctx.strokeStyle = o.dir === 'bull' ? C.bullEdge : C.bearEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, h - 1);
  }
}

// --------------------------------------------------------------- liquidity

function paintLiquidityLines(f: PaintFrame): void {
  const { ctx } = f;
  for (const l of visibleLiquidity(f)) {
    const swept = l.sweptAt != null;
    const x0 = clampX(f, f.xOf(l.index));
    const x1 = swept ? clampX(f, f.xOf(l.sweptAt!)) : f.right;
    if (x1 <= x0) continue;
    ctx.strokeStyle = swept ? C.liquiditySwept : C.liquidity;
    ctx.lineWidth = l.equal ? 1.4 : 1;
    ctx.setLineDash(l.equal ? [1, 3] : [3, 4]);
    const y = Math.round(f.yOf(l.price)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (swept && x1 < f.right) {
      ctx.fillStyle = C.liquidity;
      ctx.beginPath();
      ctx.arc(x1, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function visibleLiquidity(f: PaintFrame) {
  const { smc } = f;
  const cap = smc.config.maxLiquidityLines;
  const price = f.bars[f.bars.length - 1]?.close ?? 0;
  // A single swing that is part of an equal pair is drawn once, as the pair.
  const paired = new Set<string>();
  for (const e of smc.equalLevels) {
    paired.add(`${e.kind === 'EQH' ? 'BSL' : 'SSL'}|${e.indexA}`);
    paired.add(`${e.kind === 'EQH' ? 'BSL' : 'SSL'}|${e.indexB}`);
  }
  const live = smc.liquidity.filter(
    (l) => l.sweptAt == null && (l.equal || !paired.has(`${l.side}|${l.index}`)),
  );
  const nearest = (side: 'BSL' | 'SSL') =>
    live
      .filter((l) => l.side === side && (side === 'BSL' ? l.price >= price : l.price <= price))
      .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
      .slice(0, cap);
  const recentlySwept = smc.liquidity
    .filter((l) => l.sweptAt != null && l.sweptAt >= f.first && l.sweptAt <= f.last)
    .slice(-2);
  return [...nearest('BSL'), ...nearest('SSL'), ...recentlySwept];
}

function paintLiquidityLabels(f: PaintFrame, placed: Box[]): void {
  for (const l of visibleLiquidity(f)) {
    if (l.sweptAt != null) continue;
    const text = l.equal ? (l.side === 'BSL' ? 'EQH' : 'EQL') : l.side;
    pill(f, placed, text, f.right - 4, f.yOf(l.price), C.liquidity, '#ffffff', 'right');
  }
}

// --------------------------------------------------------------- structure

function paintStructureLines(f: PaintFrame): void {
  const { ctx, smc } = f;
  for (const e of smc.structure) {
    if (e.index < f.first || e.swingIndex > f.last) continue;
    const bull = e.dir === 'bull';
    const y = Math.round(f.yOf(e.level)) + 0.5;
    ctx.strokeStyle = bull ? C.bull : C.bear;
    ctx.lineWidth = e.kind === 'CHoCH' ? 1.4 : 1;
    ctx.setLineDash(e.kind === 'CHoCH' ? [6, 3] : [2, 3]);
    ctx.beginPath();
    ctx.moveTo(clampX(f, f.xOf(e.swingIndex)), y);
    ctx.lineTo(clampX(f, f.xOf(e.index)), y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function paintStructureLabels(f: PaintFrame, placed: Box[]): void {
  for (const e of f.smc.structure) {
    if (e.index < f.first || e.swingIndex > f.last) continue;
    const bull = e.dir === 'bull';
    const mid = (f.xOf(Math.max(e.swingIndex, f.first)) + f.xOf(Math.min(e.index, f.last))) / 2;
    const y = f.yOf(e.level) + (bull ? -8 : 8);
    pill(f, placed, e.kind, mid, y, bull ? C.bull : C.bear, '#ffffff', 'center');
  }
}

function paintSwingLabels(f: PaintFrame, placed: Box[]): void {
  const { ctx } = f;
  ctx.fillStyle = C.swing;
  for (const s of f.smc.swings) {
    if (!s.label || s.index < f.first || s.index > f.last) continue;
    const text = s.label;
    const w = ctx.measureText(text).width;
    const x = f.xOf(s.index);
    const y = f.yOf(s.price) + (s.kind === 'high' ? -8 : 8);
    const box = { x0: x - w / 2 - 1, x1: x + w / 2 + 1, y0: y - FONT_H / 2, y1: y + FONT_H / 2 };
    if (collides(placed, box) || y < f.top || y > f.bottom) continue;
    placed.push(box);
    ctx.textAlign = 'center';
    ctx.fillStyle = s.label.startsWith('E') ? C.liquidity : C.swing;
    ctx.fillText(text, x, y);
  }
}

function paintZoneLabels(f: PaintFrame, placed: Box[]): void {
  for (const o of visibleOrderBlocks(f)) {
    if (o.endedAt != null && o.endedAt < f.first) continue;
    const x = clampX(f, f.xOf(Math.max(o.index, f.first)));
    const y = (f.yOf(o.hi) + f.yOf(o.lo)) / 2;
    pill(f, placed, 'OB', x + 3, y, o.dir === 'bull' ? C.bull : C.bear, '#ffffff', 'left');
  }
  const gaps = f.smc.fvgs.filter((g) => g.status === 'active').slice(-f.smc.config.maxFvgs);
  for (const g of gaps) {
    const x = clampX(f, f.xOf(Math.max(g.index, f.first)));
    const y = (f.yOf(g.hi) + f.yOf(g.lo)) / 2;
    pill(f, placed, 'FVG', x + 3, y, g.dir === 'bull' ? C.bull : C.bear, '#ffffff', 'left');
  }
}

function paintPdLabels(f: PaintFrame, placed: Box[]): void {
  const r = f.smc.range!;
  const th = f.smc.config.pdThreshold;
  const span = r.hi - r.lo;
  const x = f.right - 4;
  pill(f, placed, 'PREMIUM', x, f.yOf(r.hi - (th * span) / 2), 'rgba(211,47,47,0.55)', '#ffffff', 'right');
  pill(f, placed, 'EQ', x, f.yOf(r.eq), 'rgba(71,85,105,0.75)', '#ffffff', 'right');
  pill(f, placed, 'DISCOUNT', x, f.yOf(r.lo + (th * span) / 2), 'rgba(0,137,123,0.55)', '#ffffff', 'right');
}


// --------------------------------------------------------------- fibonacci

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const GOLDEN_FROM = 0.5;
const GOLDEN_TO = 0.618;
/** Legs smaller than this many ATRs are noise, not a swing worth retracing. */
const FIB_MIN_LEG_ATR = 1.5;

interface FibLeg {
  /** True when the leg fell, so the retracement is a supply zone. */
  down: boolean;
  startIndex: number;
  price: (ratio: number) => number;
}

/**
 * Retracement of the latest confirmed leg: the two most recent opposite
 * swings. Only confirmed pivots are used, so the grid appears after the swing
 * is known and never moves back.
 */
function fibLeg(smc: SmcAnalysis): FibLeg | null {
  const s = smc.swings;
  if (s.length < 2) return null;
  const end = s[s.length - 1]!;
  let start: (typeof s)[number] | null = null;
  for (let i = s.length - 2; i >= 0; i -= 1) {
    if (s[i]!.kind !== end.kind) {
      start = s[i]!;
      break;
    }
  }
  if (!start) return null;
  const down = end.kind === 'low';
  const hi = down ? start.price : end.price;
  const lo = down ? end.price : start.price;
  if (hi - lo < (smc.atr ?? 0) * FIB_MIN_LEG_ATR || hi <= lo) return null;
  return {
    down,
    startIndex: end.index,
    price: (ratio) => (down ? lo + ratio * (hi - lo) : hi - ratio * (hi - lo)),
  };
}

function paintFibonacci(f: PaintFrame): void {
  const leg = fibLeg(f.smc);
  if (!leg) return;
  const { ctx } = f;
  const x0 = clampX(f, f.xOf(leg.startIndex));
  const a = f.yOf(leg.price(GOLDEN_FROM));
  const b = f.yOf(leg.price(GOLDEN_TO));
  ctx.fillStyle = C.golden;
  ctx.fillRect(x0, Math.min(a, b), f.right - x0, Math.max(2, Math.abs(b - a)));
  ctx.strokeStyle = C.fibLine;
  ctx.lineWidth = 1;
  for (const ratio of FIB_LEVELS) {
    const y = Math.round(f.yOf(leg.price(ratio))) + 0.5;
    const golden = ratio === GOLDEN_FROM || ratio === GOLDEN_TO;
    ctx.strokeStyle = golden ? C.goldenEdge : C.fibLine;
    ctx.setLineDash(ratio === 0 || ratio === 1 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(f.right, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function paintFibLabels(f: PaintFrame, placed: Box[]): void {
  const leg = fibLeg(f.smc);
  if (!leg) return;
  const { ctx } = f;
  const x0 = clampX(f, f.xOf(leg.startIndex));
  ctx.textAlign = 'left';
  for (const ratio of FIB_LEVELS) {
    const y = f.yOf(leg.price(ratio)) - 5;
    if (y < f.top + 4 || y > f.bottom - 4) continue;
    const text = String(ratio);
    const w = ctx.measureText(text).width;
    const box = { x0: x0 + 2, x1: x0 + 4 + w, y0: y - FONT_H / 2, y1: y + FONT_H / 2 };
    if (collides(placed, box)) continue;
    placed.push(box);
    ctx.fillStyle = C.neutral;
    ctx.fillText(text, x0 + 3, y);
  }
  const mid = (f.yOf(leg.price(GOLDEN_FROM)) + f.yOf(leg.price(GOLDEN_TO))) / 2;
  pill(
    f,
    placed,
    leg.down ? 'SUPPLY + GOLDEN ZONE' : 'DEMAND + GOLDEN ZONE',
    Math.max(x0 + 26, f.left),
    mid,
    'rgba(71,85,105,0.8)',
    '#ffffff',
    'left',
  );
}

// ------------------------------------------------------------------ trades

function paintTradeLevels(f: PaintFrame): void {
  const { ctx } = f;
  for (const t of focusTrades(f.smc)) {
    const endIndex = t.status === 'open' ? f.bars.length - 1 : (t.exitIndex ?? f.bars.length - 1);
    if (endIndex < f.first || t.entryIndex > f.last) continue;
    const x0 = clampX(f, f.xOf(t.entryIndex));
    const x1 = t.status === 'open' ? f.right : clampX(f, f.xOf(endIndex));
    if (x1 <= x0) continue;
    const yEntry = f.yOf(t.entryPrice);
    const ySl = f.yOf(t.sl);
    const yFinal = f.yOf(t.tpFinal);

    ctx.fillStyle = C.riskBand;
    ctx.fillRect(x0, Math.min(yEntry, ySl), x1 - x0, Math.abs(ySl - yEntry));
    ctx.fillStyle = C.rewardBand;
    ctx.fillRect(x0, Math.min(yEntry, yFinal), x1 - x0, Math.abs(yFinal - yEntry));

    const line = (price: number, color: string, dash: number[], width = 1) => {
      const y = Math.round(f.yOf(price)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(t.entryPrice, C.ink, [], 1.3);
    line(t.sl, C.bear, [5, 3], 1.1);
    line(t.tp1, C.bull, [2, 3], 1);
    line(t.tp2, C.bull, [2, 3], 1);
    line(t.tpFinal, C.bull, [], 1.2);
  }
}

function paintLevelLabels(f: PaintFrame, placed: Box[]): void {
  for (const t of focusTrades(f.smc)) {
    const endIndex = t.status === 'open' ? f.bars.length - 1 : (t.exitIndex ?? f.bars.length - 1);
    if (endIndex < f.first || t.entryIndex > f.last) continue;
    const anchor = t.status === 'open' ? f.right - 4 : clampX(f, f.xOf(endIndex)) - 2;
    const long = t.side === 'BUY';
    pill(f, placed, long ? 'ENTRY LONG' : 'ENTRY SHORT', anchor, f.yOf(t.entryPrice), C.ink, '#ffffff', 'right');
    pill(f, placed, 'STOP LOSS', anchor, f.yOf(t.sl), C.bear, '#ffffff', 'right');
    pill(f, placed, 'FINAL TP', anchor, f.yOf(t.tpFinal), C.bull, '#ffffff', 'right');
    pill(f, placed, 'TP2', anchor, f.yOf(t.tp2), 'rgba(0,137,123,0.8)', '#ffffff', 'right');
    pill(f, placed, 'TP1', anchor, f.yOf(t.tp1), 'rgba(0,137,123,0.8)', '#ffffff', 'right');
    paintRiskRewardBoxes(f, placed, t, anchor);
  }
}

function pctOf(distance: number, entry: number): string {
  return entry > 0 ? `${((distance / entry) * 100).toFixed(2)}%` : '—';
}

/** Distance boxes at the stop and target edges and a central R/R + open P&L box. */
function paintRiskRewardBoxes(f: PaintFrame, placed: Box[], t: SmcTrade, anchor: number): void {
  const risk = Math.abs(t.entryPrice - t.sl);
  const reward = Math.abs(t.tpFinal - t.entryPrice);
  const x = anchor - 64;
  pill(f, placed, `${risk.toFixed(2)} (${pctOf(risk, t.entryPrice)})`, x, f.yOf(t.sl) + (t.side === 'BUY' ? -8 : 8), 'rgba(211,47,47,0.75)', '#ffffff', 'right');
  pill(f, placed, `${reward.toFixed(2)} (${pctOf(reward, t.entryPrice)})`, x, f.yOf(t.tpFinal) + (t.side === 'BUY' ? 8 : -8), 'rgba(14,116,144,0.8)', '#ffffff', 'right');

  const mid = (f.yOf(t.entryPrice) + f.yOf(t.tpFinal)) / 2;
  let text = `R/R ${t.rr.toFixed(2)}`;
  if (t.status === 'open' && risk > 0) {
    const last = f.bars[f.bars.length - 1]!.close;
    const open = (t.side === 'BUY' ? last - t.entryPrice : t.entryPrice - last);
    text += ` · P&L ${open >= 0 ? '+' : ''}${open.toFixed(2)} (${(open / risk).toFixed(2)}R)`;
  }
  pill(f, placed, text, x, mid, 'rgba(0,137,123,0.85)', '#ffffff', 'right');
}

function paintSignals(f: PaintFrame, placed: Box[]): void {
  const { ctx } = f;
  for (const t of f.smc.trades) {
    if (t.entryIndex < f.first || t.entryIndex > f.last) continue;
    const bar = f.bars[t.entryIndex]!;
    const buy = t.side === 'BUY';
    const x = f.xOf(t.entryIndex);
    const color = buy ? C.bull : C.bear;
    let tip = buy ? f.yOf(bar.low) + ARROW_GAP : f.yOf(bar.high) - ARROW_GAP;
    const flip = tip > f.bottom - ARROW_H - 12 || tip < f.top + ARROW_H + 12;
    if (flip) tip = buy ? f.yOf(bar.high) - ARROW_GAP : f.yOf(bar.low) + ARROW_GAP;
    const pointsUp = flip ? !buy : buy;
    arrow(ctx, x, tip, pointsUp, color);
    const labelY = pointsUp ? tip + ARROW_H + 8 : tip - ARROW_H - 8;
    pill(f, placed, buy ? 'BUY' : 'SELL', x, labelY, color, '#ffffff', 'center');
  }
}

function fillLabel(fill: SmcFill): string {
  switch (fill.kind) {
    case 'TP1':
      return 'TP1';
    case 'TP2':
      return 'TP2';
    case 'FINAL':
      return 'FINAL TP';
    case 'STOP':
      return 'SL';
    default:
      return 'EXIT';
  }
}

function paintFills(f: PaintFrame, placed: Box[]): void {
  const { ctx } = f;
  for (const t of f.smc.trades) {
    for (const fill of t.fills) {
      if (fill.index < f.first || fill.index > f.last) continue;
      const x = f.xOf(fill.index);
      const y = f.yOf(fill.price);
      const partial = fill.kind === 'TP1' || fill.kind === 'TP2';
      ctx.fillStyle = fill.kind === 'STOP' ? C.bear : partial ? C.bull : C.neutral;
      ctx.beginPath();
      ctx.arc(x, y, partial ? 2.6 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (partial) {
        pill(f, placed, fillLabel(fill), x, y + (t.side === 'BUY' ? -9 : 9), C.bull, '#ffffff', 'center');
      }
    }
    if (t.status === 'closed' && t.exitIndex != null && t.exitIndex >= f.first && t.exitIndex <= f.last) {
      const x = f.xOf(t.exitIndex);
      const y = f.yOf(t.exitPrice ?? t.entryPrice);
      const why = EXIT_SHORT[t.exitReason ?? ''] ?? '';
      const win = (t.rMultiple ?? 0) > 0;
      pill(
        f,
        placed,
        `EXIT ${why}`.trim(),
        x,
        y + (t.side === 'BUY' ? 10 : -10),
        win ? C.bull : t.exitReason === 'stop_loss' ? C.bear : C.neutral,
        '#ffffff',
        'center',
      );
    }
  }
}

function paintPreview(f: PaintFrame, placed: Box[]): void {
  const p = f.smc.preview;
  if (!p || p.index > f.last || p.index < f.first || p.index >= f.bars.length) return;
  const { ctx } = f;
  const bar = f.bars[p.index]!;
  const buy = p.side === 'BUY';
  const x = f.xOf(p.index);
  const tip = buy ? f.yOf(bar.low) + ARROW_GAP : f.yOf(bar.high) - ARROW_GAP;
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = C.pending;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const dir = buy ? 1 : -1;
  ctx.moveTo(x, tip);
  ctx.lineTo(x - ARROW_W / 2, tip + dir * ARROW_H);
  ctx.lineTo(x + ARROW_W / 2, tip + dir * ARROW_H);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  if (p.kind === 'entry' && p.entry != null) {
    const dash = (price: number | null) => {
      if (price == null) return;
      const y = Math.round(f.yOf(price)) + 0.5;
      ctx.save();
      ctx.strokeStyle = C.pending;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(f.right, y);
      ctx.stroke();
      ctx.restore();
    };
    dash(p.entry);
    dash(p.sl);
    dash(p.tpFinal);
  }
  pill(f, placed, p.label, x, tip + dir * (ARROW_H + 9), C.pending, '#ffffff', 'center');
}

// ---------------------------------------------------------------- helpers

function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  tipY: number,
  pointsUp: boolean,
  color: string,
): void {
  const dir = pointsUp ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - ARROW_W / 2, tipY + dir * ARROW_H);
  ctx.lineTo(x + ARROW_W / 2, tipY + dir * ARROW_H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function collides(placed: Box[], box: Box): boolean {
  return placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1);
}

/**
 * A filled text tag. Returns false, drawing nothing, when it would sit on a
 * tag already placed or outside the plot. Callers place the most important
 * tags first, so the ones dropped are always the least useful.
 */
function pill(
  f: PaintFrame,
  placed: Box[],
  text: string,
  x: number,
  y: number,
  bg: string,
  ink: string,
  align: 'left' | 'center' | 'right',
): boolean {
  const { ctx } = f;
  ctx.font = FONT;
  const w = ctx.measureText(text).width + 6;
  const h = FONT_H + 4;
  let left = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  left = Math.min(Math.max(left, f.left + 1), f.right - w - 1);
  const top = y - h / 2;
  if (top < f.top || top + h > f.bottom) return false;
  const box = { x0: left, x1: left + w, y0: top, y1: top + h };
  if (collides(placed, box)) return false;
  placed.push(box);
  ctx.fillStyle = bg;
  ctx.fillRect(box.x0, box.y0, w, h);
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.fillText(text, left + 3, top + h / 2 + 0.5);
  return true;
}
