# Annotated — pdhl-opening-range.evaluator.ts
Every line of the Nifty/Bank **secret entry** evaluator, mapped for owner reference.
**Source:** `src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator.ts`
---
| Line | Code | Comment |
|------|------|--------|
| 1 | `import { Candle } from '../../../models/candle.model';` | Import dependency |
| 2 | `import { StrategyContext } from '../../models/strategy-context.model';` | Import dependency |
| 3 | `import { extractTradeDate } from '../../../utils/trade-date.util';` | Import dependency |
| 4 | `import { extractHhMm, resolveSessionFromContext } from '../../utils/market-session.util';` | Import dependency |
| 5 | `import { buildSignalDebug } from '../../utils/signal-debug.util';` | Import dependency |
| 6 | `` | Blank — section break |
| 7 | `export type PdhlSignalAction = 'BUY' \| 'SELL' \| 'NO_TRADE' \| 'WAITING' \| 'SKIPPED';` | No entry yet |
| 8 | `` | Blank — section break |
| 9 | `export interface PdhlOrResult {` | Exported symbol (used by desks/engines) |
| 10 | `  action: PdhlSignalAction;` | Statement |
| 11 | `  entryPrice: number;` | Statement |
| 12 | `  stopLoss: number;` | Statement |
| 13 | `  target: number;` | Statement |
| 14 | `  riskRewardRatio: number;` | Statement |
| 15 | `  reason: string;` | Statement |
| 16 | `  analysis: Record<string, unknown>;` | Statement |
| 17 | `}` | Statement |
| 18 | `` | Blank — section break |
| 19 | `export interface PdhlOrState {` | Exported symbol (used by desks/engines) |
| 20 | `  tradingDate: string \| null;` | Statement |
| 21 | `  /** Running day P&L in points (closed trades only). */` | Block comment start |
| 22 | `  dayNetPts: number;` | Statement |
| 23 | `  tradesToday: number;` | Statement |
| 24 | `  lossesToday: number;` | Statement |
| 25 | `  winsToday: number;` | Statement |
| 26 | `  dayStoppedReason: string \| null;` | Statement |
| 27 | `}` | Statement |
| 28 | `` | Blank — section break |
| 29 | `export function createPdhlOrState(): PdhlOrState {` | Exported symbol (used by desks/engines) |
| 30 | `  return {` | Return value / early exit |
| 31 | `    tradingDate: null,` | Statement |
| 32 | `    dayNetPts: 0,` | Statement |
| 33 | `    tradesToday: 0,` | Statement |
| 34 | `    lossesToday: 0,` | Statement |
| 35 | `    winsToday: 0,` | Statement |
| 36 | `    dayStoppedReason: null,` | Statement |
| 37 | `  };` | Statement |
| 38 | `}` | Statement |
| 39 | `` | Blank — section break |
| 40 | `/** User capital plan: 1 point = ₹65 */` | Block comment start |
| 41 | `export const PDHL_RUPEES_PER_POINT = 65;` | Exported symbol (used by desks/engines) |
| 42 | `` | Blank — section break |
| 43 | `/**` | Block comment start |
| 44 | ` * Per-index risk profile (champion pair, 2020–2026 hunt):` | Block comment body |
| 45 | ` * same DNA on both — 1R target, no day profit lock, day stop −60, EMA exit.` | Block comment body |
| 46 | ` * Nifty SL cap 30; Bank SL cap 45 (wider for volatility).` | Block comment body |
| 47 | ` */` | Block comment end |
| 48 | `export interface PdhlOrParams {` | Exported symbol (used by desks/engines) |
| 49 | `  maxStopPts: number;` | Statement |
| 50 | `  minStopPts: number;` | Statement |
| 51 | `  targetRMultiple: number;` | Statement |
| 52 | `  /** 0 = disabled (no day profit lock). */` | Block comment start |
| 53 | `  dailyProfitLockPts: number;` | Statement |
| 54 | `  /** 0 = disabled. */` | Block comment start |
| 55 | `  dailyMaxLossPts: number;` | Statement |
| 56 | `  earliestEntry: string;` | Earliest entry clock |
| 57 | `  lastEntry: string;` | Last entry clock |
| 58 | `  dna: string;` | Statement |
| 59 | `}` | Statement |
| 60 | `` | Blank — section break |
| 61 | `/** Nifty champion: cap30 \| r_1 \| whole_day \| ema_exit \| L0 \| S60 */` | Block comment start |
| 62 | `export const PDHL_NIFTY_PARAMS: PdhlOrParams = {` | Nifty champion parameter block |
| 63 | `  maxStopPts: 30,` | Nifty SL cap 30 |
| 64 | `  minStopPts: 3,` | Statement |
| 65 | `  targetRMultiple: 1,` | 1R target |
| 66 | `  dailyProfitLockPts: 0,` | L0 — day profit lock disabled |
| 67 | `  dailyMaxLossPts: 60,` | Day stop −60 pts |
| 68 | `  earliestEntry: '09:20',` | Earliest entry clock |
| 69 | `  lastEntry: '15:10',` | Last entry clock |
| 70 | `  dna: 'opening_range\|swing\|breakout\|cap30\|r_1\|whole_day\|ema_exit\|L0\|S60',` | Statement |
| 71 | `};` | Statement |
| 72 | `` | Blank — section break |
| 73 | `/** Bank champion: cap45 \| r_1 \| whole_day \| ema_exit \| L0 \| S60 */` | Block comment start |
| 74 | `export const PDHL_BANK_PARAMS: PdhlOrParams = {` | Bank champion parameter block |
| 75 | `  maxStopPts: 45,` | Bank SL cap 45 |
| 76 | `  minStopPts: 3,` | Statement |
| 77 | `  targetRMultiple: 1,` | 1R target |
| 78 | `  dailyProfitLockPts: 0,` | L0 — day profit lock disabled |
| 79 | `  dailyMaxLossPts: 60,` | Day stop −60 pts |
| 80 | `  earliestEntry: '09:20',` | Earliest entry clock |
| 81 | `  lastEntry: '15:10',` | Last entry clock |
| 82 | `  dna: 'opening_range\|swing\|breakout\|cap45\|r_1\|whole_day\|ema_exit\|L0\|S60',` | Statement |
| 83 | `};` | Statement |
| 84 | `` | Blank — section break |
| 85 | `/** @deprecated Use PDHL_NIFTY_PARAMS.maxStopPts — kept for callers */` | Nifty champion parameter block |
| 86 | `export const PDHL_MAX_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.maxStopPts;` | Nifty champion parameter block |
| 87 | `export const PDHL_MIN_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.minStopPts;` | Nifty champion parameter block |
| 88 | `export const PDHL_TARGET_R_MULTIPLE = PDHL_NIFTY_PARAMS.targetRMultiple;` | Nifty champion parameter block |
| 89 | `export const PDHL_DAILY_PROFIT_LOCK_PTS = PDHL_NIFTY_PARAMS.dailyProfitLockPts;` | Nifty champion parameter block |
| 90 | `export const PDHL_DAILY_MAX_LOSS_PTS = PDHL_NIFTY_PARAMS.dailyMaxLossPts;` | Nifty champion parameter block |
| 91 | `/** Matches hunt whole_day window upper bound */` | Block comment start |
| 92 | `export const PDHL_LAST_ENTRY_TIME = PDHL_NIFTY_PARAMS.lastEntry;` | Nifty champion parameter block |
| 93 | `export const PDHL_SWING_LOOKBACK = 3;` | Exported symbol (used by desks/engines) |
| 94 | `export const PDHL_EMA_EXIT_PERIOD = 20;` | Exported symbol (used by desks/engines) |
| 95 | `` | Blank — section break |
| 96 | `export function resolvePdhlOrParams(instrumentId?: string \| null): PdhlOrParams {` | Pick Nifty vs Bank params |
| 97 | `  const id = (instrumentId ?? '').toLowerCase();` | Statement |
| 98 | `  if (id === 'bank-nifty' \|\| id.includes('banknifty') \|\| id.includes('bank-nifty')) {` | Branch / gate |
| 99 | `    return PDHL_BANK_PARAMS;` | Bank champion parameter block |
| 100 | `  }` | Statement |
| 101 | `  return PDHL_NIFTY_PARAMS;` | Nifty champion parameter block |
| 102 | `}` | Statement |
| 103 | `` | Blank — section break |
| 104 | `export function recordPdhlTradeClosed(` | Update day P&L after close |
| 105 | `  state: PdhlOrState,` | Statement |
| 106 | `  points: number,` | Statement |
| 107 | `  params: PdhlOrParams = PDHL_NIFTY_PARAMS,` | Nifty champion parameter block |
| 108 | `): void {` | Statement |
| 109 | `  state.dayNetPts += points;` | Statement |
| 110 | `  state.tradesToday += 1;` | Statement |
| 111 | `  if (points < 0) {` | Branch / gate |
| 112 | `    state.lossesToday += 1;` | Statement |
| 113 | `  } else if (points > 0) {` | Branch / gate |
| 114 | `    state.winsToday += 1;` | Statement |
| 115 | `  }` | Statement |
| 116 | `` | Blank — section break |
| 117 | `  if (params.dailyProfitLockPts > 0 && state.dayNetPts >= params.dailyProfitLockPts) {` | Branch / gate |
| 118 | `    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 119 | `  } else if (params.dailyMaxLossPts > 0 && state.dayNetPts <= -params.dailyMaxLossPts) {` | Branch / gate |
| 120 | `    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 121 | `  }` | Statement |
| 122 | `}` | Statement |
| 123 | `` | Blank — section break |
| 124 | `function openingRange(` | Build first-hour OR high/low/mid |
| 125 | `  dayBars: Candle[],` | Statement |
| 126 | `  marketOpen: string,` | Statement |
| 127 | `  firstHourEnd: string,` | Statement |
| 128 | `): { high: number; low: number; mid: number; range: number } \| null {` | Statement |
| 129 | `  const bars = dayBars.filter((c) => {` | Statement |
| 130 | `    const t = extractHhMm(c.date);` | Statement |
| 131 | `    return t >= marketOpen && t < firstHourEnd;` | Return value / early exit |
| 132 | `  });` | Statement |
| 133 | `  if (!bars.length) {` | Branch / gate |
| 134 | `    return null;` | Return value / early exit |
| 135 | `  }` | Statement |
| 136 | `  const high = Math.max(...bars.map((b) => b.high));` | Statement |
| 137 | `  const low = Math.min(...bars.map((b) => b.low));` | Statement |
| 138 | `  return { high, low, mid: (high + low) / 2, range: high - low };` | Return value / early exit |
| 139 | `}` | Statement |
| 140 | `` | Blank — section break |
| 141 | `/**` | Block comment start |
| 142 | ` * Hunt-compatible swing at `index` (lookback=3, forward-fill).` | Block comment body |
| 143 | ` * Pass full backtest `series5m` so pivot confirmation can use bars after `index`` | Block comment body |
| 144 | ` * (same as analyst research). For live, pass only history+current for causal swings.` | Block comment body |
| 145 | ` */` | Block comment end |
| 146 | `export function swingAtIndex(` | Confirm swing high/low pivots |
| 147 | `  series: Candle[],` | Statement |
| 148 | `  index: number,` | Statement |
| 149 | `  lookback: number = PDHL_SWING_LOOKBACK,` | Statement |
| 150 | `): { high: number; low: number } \| null {` | Statement |
| 151 | `  if (index < 0 \|\| index >= series.length \|\| series.length < lookback * 2 + 1) {` | Branch / gate |
| 152 | `    return null;` | Return value / early exit |
| 153 | `  }` | Statement |
| 154 | `  let lastH = NaN;` | Statement |
| 155 | `  let lastL = NaN;` | Statement |
| 156 | `  const maxPivot = Math.min(index, series.length - 1 - lookback);` | Statement |
| 157 | `  for (let i = lookback; i <= maxPivot; i += 1) {` | Loop |
| 158 | `    const bar = series[i]!;` | Statement |
| 159 | `    let isHigh = true;` | Statement |
| 160 | `    let isLow = true;` | Statement |
| 161 | `    for (let j = 1; j <= lookback; j += 1) {` | Loop |
| 162 | `      if (bar.high <= series[i - j]!.high \|\| bar.high <= series[i + j]!.high) {` | Branch / gate |
| 163 | `        isHigh = false;` | Statement |
| 164 | `      }` | Statement |
| 165 | `      if (bar.low >= series[i - j]!.low \|\| bar.low >= series[i + j]!.low) {` | Branch / gate |
| 166 | `        isLow = false;` | Statement |
| 167 | `      }` | Statement |
| 168 | `    }` | Statement |
| 169 | `    if (isHigh) {` | Branch / gate |
| 170 | `      lastH = bar.high;` | Statement |
| 171 | `    }` | Statement |
| 172 | `    if (isLow) {` | Branch / gate |
| 173 | `      lastL = bar.low;` | Statement |
| 174 | `    }` | Statement |
| 175 | `  }` | Statement |
| 176 | `  if (!Number.isFinite(lastH) \|\| !Number.isFinite(lastL)) {` | Branch / gate |
| 177 | `    return null;` | Return value / early exit |
| 178 | `  }` | Statement |
| 179 | `  return { high: lastH, low: lastL };` | Return value / early exit |
| 180 | `}` | Statement |
| 181 | `` | Blank — section break |
| 182 | `export function lastConfirmedSwing(` | Exported symbol (used by desks/engines) |
| 183 | `  candles: Candle[],` | Statement |
| 184 | `  lookback: number = PDHL_SWING_LOOKBACK,` | Statement |
| 185 | `): { high: number; low: number } \| null {` | Statement |
| 186 | `  return swingAtIndex(candles, candles.length - 1, lookback);` | Confirm swing high/low pivots |
| 187 | `}` | Statement |
| 188 | `` | Blank — section break |
| 189 | `/** SMA-seeded EMA (matches analyst hunt). */` | Block comment start |
| 190 | `export function emaLast(closes: number[], period: number = PDHL_EMA_EXIT_PERIOD): number \| null {` | EMA for exit (used by paper engine) |
| 191 | `  if (closes.length < period) {` | Branch / gate |
| 192 | `    return null;` | Return value / early exit |
| 193 | `  }` | Statement |
| 194 | `  let sum = 0;` | Statement |
| 195 | `  for (let i = 0; i < period; i += 1) {` | Loop |
| 196 | `    sum += closes[i]!;` | Statement |
| 197 | `  }` | Statement |
| 198 | `  let prev = sum / period;` | Statement |
| 199 | `  const k = 2 / (period + 1);` | Statement |
| 200 | `  for (let i = period; i < closes.length; i += 1) {` | Loop |
| 201 | `    prev = closes[i]! * k + prev * (1 - k);` | Statement |
| 202 | `  }` | Statement |
| 203 | `  return prev;` | Return value / early exit |
| 204 | `}` | Statement |
| 205 | `` | Blank — section break |
| 206 | `/**` | Block comment start |
| 207 | ` * OR bias + swing breakout, SL cap + 1.5R, multi-entry until day lock/stop.` | Block comment body |
| 208 | ` * Params resolve from ctx.instrumentId (Bank vs Nifty).` | Block comment body |
| 209 | ` */` | Block comment end |
| 210 | `export function runPdhlOpeningRange(ctx: StrategyContext, state: PdhlOrState): PdhlOrResult {` | MAIN Nifty/Bank entry evaluator |
| 211 | `  const p = resolvePdhlOrParams(ctx.instrumentId);` | Pick Nifty vs Bank params |
| 212 | `  const session = resolveSessionFromContext(ctx);` | Statement |
| 213 | `  const current = ctx.candle5m;` | Statement |
| 214 | `  const tradingDate = extractTradeDate(current.date);` | Statement |
| 215 | `  const time = extractHhMm(current.date, session.timezone);` | Statement |
| 216 | `  const all5m = [...ctx.previous5m, current];` | Statement |
| 217 | `  const series5m = ctx.series5m?.length ? ctx.series5m : all5m;` | Statement |
| 218 | `  const seriesIndex = ctx.series5m?.length ? ctx.candleIndex5m : all5m.length - 1;` | Statement |
| 219 | `  const dayBars = all5m.filter((c) => extractTradeDate(c.date) === tradingDate);` | Statement |
| 220 | `` | Blank — section break |
| 221 | `  if (state.tradingDate !== tradingDate) {` | Branch / gate |
| 222 | `    state.tradingDate = tradingDate;` | Statement |
| 223 | `    state.dayNetPts = 0;` | Statement |
| 224 | `    state.tradesToday = 0;` | Statement |
| 225 | `    state.lossesToday = 0;` | Statement |
| 226 | `    state.winsToday = 0;` | Statement |
| 227 | `    state.dayStoppedReason = null;` | Statement |
| 228 | `  }` | Statement |
| 229 | `` | Blank — section break |
| 230 | `  const base = {` | Statement |
| 231 | `    tradingDate,` | Statement |
| 232 | `    time,` | Statement |
| 233 | `    strategy: 'OR Swing Breakout',` | Statement |
| 234 | `    dna: p.dna,` | Statement |
| 235 | `    instrumentId: ctx.instrumentId ?? null,` | Statement |
| 236 | `    rupeesPerPoint: PDHL_RUPEES_PER_POINT,` | Statement |
| 237 | `    dayNetPts: state.dayNetPts,` | Statement |
| 238 | `    dayNetRs: state.dayNetPts * PDHL_RUPEES_PER_POINT,` | Statement |
| 239 | `    tradesToday: state.tradesToday,` | Statement |
| 240 | `    lossesToday: state.lossesToday,` | Statement |
| 241 | `    dailyProfitLock: p.dailyProfitLockPts,` | Statement |
| 242 | `    dailyMaxLoss: p.dailyMaxLossPts,` | Statement |
| 243 | `    maxStopPts: p.maxStopPts,` | Statement |
| 244 | `    earliestEntry: p.earliestEntry,` | Earliest entry clock |
| 245 | `  };` | Statement |
| 246 | `` | Blank — section break |
| 247 | `  if (time < session.marketOpen) {` | Branch / gate |
| 248 | `    return waiting(current, 'Before market open', base);` | Return value / early exit |
| 249 | `  }` | Statement |
| 250 | `` | Blank — section break |
| 251 | `  if (time < session.firstHourReadyTime) {` | Branch / gate |
| 252 | `    return waiting(` | Return value / early exit |
| 253 | `      current,` | Statement |
| 254 | `      `Waiting for opening range (${session.marketOpen}–${session.firstHourEnd})`,` | Statement |
| 255 | `      base,` | Statement |
| 256 | `    );` | Statement |
| 257 | `  }` | Statement |
| 258 | `` | Blank — section break |
| 259 | `  if (state.dayStoppedReason) {` | Branch / gate |
| 260 | `    return noTrade(current, state.dayStoppedReason, base);` | Return value / early exit |
| 261 | `  }` | Statement |
| 262 | `` | Blank — section break |
| 263 | `  if (p.dailyProfitLockPts > 0 && state.dayNetPts >= p.dailyProfitLockPts) {` | Branch / gate |
| 264 | `    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 265 | `    return noTrade(current, state.dayStoppedReason, base);` | Return value / early exit |
| 266 | `  }` | Statement |
| 267 | `  if (p.dailyMaxLossPts > 0 && state.dayNetPts <= -p.dailyMaxLossPts) {` | Branch / gate |
| 268 | `    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 269 | `    return noTrade(current, state.dayStoppedReason, base);` | Return value / early exit |
| 270 | `  }` | Statement |
| 271 | `` | Blank — section break |
| 272 | `  if (time < p.earliestEntry \|\| time > p.lastEntry) {` | Earliest entry clock |
| 273 | `    return waiting(` | Return value / early exit |
| 274 | `      current,` | Statement |
| 275 | `      `Outside entry window (${p.earliestEntry}–${p.lastEntry})`,` | Earliest entry clock |
| 276 | `      base,` | Statement |
| 277 | `    );` | Statement |
| 278 | `  }` | Statement |
| 279 | `` | Blank — section break |
| 280 | `  const or = openingRange(dayBars, session.marketOpen, session.firstHourEnd);` | Build first-hour OR high/low/mid |
| 281 | `  if (!or) {` | Branch / gate |
| 282 | `    return waiting(current, 'Opening range unavailable', base);` | Return value / early exit |
| 283 | `  }` | Statement |
| 284 | `` | Blank — section break |
| 285 | `  const bias: 'BUY' \| 'SELL' = current.close >= or.mid ? 'BUY' : 'SELL';` | Statement |
| 286 | `  const swing = swingAtIndex(series5m, seriesIndex, PDHL_SWING_LOOKBACK);` | Confirm swing high/low pivots |
| 287 | `  if (!swing) {` | Branch / gate |
| 288 | `    return waiting(current, 'Swing high/low not ready', {` | Return value / early exit |
| 289 | `      ...base,` | Statement |
| 290 | `      bias,` | Statement |
| 291 | `      orHigh: or.high,` | Statement |
| 292 | `      orLow: or.low,` | Statement |
| 293 | `    });` | Statement |
| 294 | `  }` | Statement |
| 295 | `` | Blank — section break |
| 296 | `  let action: 'BUY' \| 'SELL' \| null = null;` | Statement |
| 297 | `  if (bias === 'BUY' && current.close > swing.high) {` | OR mid bias BUY path |
| 298 | `    action = 'BUY';` | Statement |
| 299 | `  } else if (bias === 'SELL' && current.close < swing.low) {` | OR mid bias SELL path |
| 300 | `    action = 'SELL';` | Statement |
| 301 | `  }` | Statement |
| 302 | `` | Blank — section break |
| 303 | `  if (!action) {` | Branch / gate |
| 304 | `    return waiting(current, 'Waiting for OR bias + swing breakout', {` | Return value / early exit |
| 305 | `      ...base,` | Statement |
| 306 | `      bias,` | Statement |
| 307 | `      orHigh: or.high,` | Statement |
| 308 | `      orLow: or.low,` | Statement |
| 309 | `      swingHigh: swing.high,` | Statement |
| 310 | `      swingLow: swing.low,` | Statement |
| 311 | `    });` | Statement |
| 312 | `  }` | Statement |
| 313 | `` | Blank — section break |
| 314 | `  const entry = current.close;` | Statement |
| 315 | `  let stopLoss = action === 'BUY' ? current.low : current.high;` | Statement |
| 316 | `  let risk = Math.abs(entry - stopLoss);` | Statement |
| 317 | `  if (risk < p.minStopPts) {` | Branch / gate |
| 318 | `    return waiting(current, `Risk ${risk.toFixed(1)} < min ${p.minStopPts}`, {` | Return value / early exit |
| 319 | `      ...base,` | Statement |
| 320 | `      bias,` | Statement |
| 321 | `      swingHigh: swing.high,` | Statement |
| 322 | `      swingLow: swing.low,` | Statement |
| 323 | `    });` | Statement |
| 324 | `  }` | Statement |
| 325 | `  if (risk > p.maxStopPts) {` | Branch / gate |
| 326 | `    stopLoss = action === 'BUY' ? entry - p.maxStopPts : entry + p.maxStopPts;` | Statement |
| 327 | `    risk = p.maxStopPts;` | Statement |
| 328 | `  }` | Statement |
| 329 | `` | Blank — section break |
| 330 | `  if (p.dailyMaxLossPts > 0 && state.dayNetPts - risk < -p.dailyMaxLossPts) {` | Branch / gate |
| 331 | `    return noTrade(` | Return value / early exit |
| 332 | `      current,` | Statement |
| 333 | `      `Next SL would breach day max loss (day ${state.dayNetPts.toFixed(1)}, risk ${risk.toFixed(1)})`,` | Statement |
| 334 | `      base,` | Statement |
| 335 | `    );` | Statement |
| 336 | `  }` | Statement |
| 337 | `` | Blank — section break |
| 338 | `  const targetPts = risk * p.targetRMultiple;` | Statement |
| 339 | `  const target = action === 'BUY' ? entry + targetPts : entry - targetPts;` | Statement |
| 340 | `  const rr = p.targetRMultiple;` | Statement |
| 341 | `  const targetRs = targetPts * PDHL_RUPEES_PER_POINT;` | Statement |
| 342 | `` | Blank — section break |
| 343 | `  const debug = buildSignalDebug({` | Statement |
| 344 | `    marketRegime: String(ctx.marketRegime ?? 'N/A'),` | Statement |
| 345 | `    strategyStatus: 'PASS',` | Statement |
| 346 | `    currentStep: 'Entry',` | Statement |
| 347 | `    blockingRule: 'None',` | Statement |
| 348 | `    expectedValue: action,` | Statement |
| 349 | `    actualValue: action,` | Statement |
| 350 | `    nextConditionRequired: 'Trade execution',` | Statement |
| 351 | `    steps: [` | Statement |
| 352 | `      { name: 'Day Budget', status: 'PASS', actualValue: `${state.dayNetPts.toFixed(1)} pts` },` | Statement |
| 353 | `      { name: 'OR Bias', status: 'PASS', actualValue: bias },` | Statement |
| 354 | `      { name: 'Swing Breakout', status: 'PASS', actualValue: `${swing.low.toFixed(1)}–${swing.high.toFixed(1)}` },` | Statement |
| 355 | `      { name: 'Target', status: 'PASS', actualValue: `${targetPts.toFixed(1)} pts (${rr}R)` },` | Statement |
| 356 | `    ],` | Statement |
| 357 | `  });` | Statement |
| 358 | `` | Blank — section break |
| 359 | `  return {` | Return value / early exit |
| 360 | `    action,` | Statement |
| 361 | `    entryPrice: entry,` | Statement |
| 362 | `    stopLoss,` | Statement |
| 363 | `    target,` | Statement |
| 364 | `    riskRewardRatio: rr,` | Statement |
| 365 | `    reason: `${action} #${state.tradesToday + 1} — swing breakout, ${rr}R \| day ${state.dayNetPts.toFixed(1)}`,` | Statement |
| 366 | `    analysis: {` | Statement |
| 367 | `      ...base,` | Statement |
| 368 | `      bias,` | Statement |
| 369 | `      pattern: 'swing_breakout',` | Statement |
| 370 | `      orHigh: or.high,` | Statement |
| 371 | `      orLow: or.low,` | Statement |
| 372 | `      swingHigh: swing.high,` | Statement |
| 373 | `      swingLow: swing.low,` | Statement |
| 374 | `      riskPts: risk,` | Statement |
| 375 | `      targetPts,` | Statement |
| 376 | `      targetRs,` | Statement |
| 377 | `      riskRs: risk * PDHL_RUPEES_PER_POINT,` | Statement |
| 378 | `      finalDecision: action,` | Statement |
| 379 | `      debug,` | Statement |
| 380 | `    },` | Statement |
| 381 | `  };` | Statement |
| 382 | `}` | Statement |
| 383 | `` | Blank — section break |
| 384 | `export function clampStopLoss(` | Exported symbol (used by desks/engines) |
| 385 | `  entry: number,` | Statement |
| 386 | `  direction: 'BUY' \| 'SELL',` | Statement |
| 387 | `  proposedStop: number,` | Statement |
| 388 | `  maxPts: number = PDHL_MAX_STOP_LOSS_PTS,` | Statement |
| 389 | `): number {` | Statement |
| 390 | `  const capped = direction === 'BUY' ? entry - maxPts : entry + maxPts;` | Statement |
| 391 | `  if (direction === 'BUY') {` | Branch / gate |
| 392 | `    const belowEntry = Math.min(proposedStop, entry - PDHL_MIN_STOP_LOSS_PTS);` | Statement |
| 393 | `    return Math.max(belowEntry, capped);` | Return value / early exit |
| 394 | `  }` | Statement |
| 395 | `  const aboveEntry = Math.max(proposedStop, entry + PDHL_MIN_STOP_LOSS_PTS);` | Statement |
| 396 | `  return Math.min(aboveEntry, capped);` | Return value / early exit |
| 397 | `}` | Statement |
| 398 | `` | Blank — section break |
| 399 | `function waiting(` | Function definition |
| 400 | `  candle: Candle,` | Statement |
| 401 | `  reason: string,` | Statement |
| 402 | `  analysis: Record<string, unknown>,` | Statement |
| 403 | `): PdhlOrResult {` | Statement |
| 404 | `  return {` | Return value / early exit |
| 405 | `    action: 'WAITING',` | No entry yet |
| 406 | `    entryPrice: candle.close,` | Statement |
| 407 | `    stopLoss: candle.close,` | Statement |
| 408 | `    target: candle.close,` | Statement |
| 409 | `    riskRewardRatio: 0,` | Statement |
| 410 | `    reason,` | Statement |
| 411 | `    analysis: { ...analysis, finalDecision: 'WAITING', currentStep: reason },` | No entry yet |
| 412 | `  };` | Statement |
| 413 | `}` | Statement |
| 414 | `` | Blank — section break |
| 415 | `function noTrade(` | Function definition |
| 416 | `  candle: Candle,` | Statement |
| 417 | `  reason: string,` | Statement |
| 418 | `  analysis: Record<string, unknown>,` | Statement |
| 419 | `): PdhlOrResult {` | Statement |
| 420 | `  return {` | Return value / early exit |
| 421 | `    action: 'NO_TRADE',` | Hard skip for day/budget |
| 422 | `    entryPrice: candle.close,` | Statement |
| 423 | `    stopLoss: candle.close,` | Statement |
| 424 | `    target: candle.close,` | Statement |
| 425 | `    riskRewardRatio: 0,` | Statement |
| 426 | `    reason,` | Statement |
| 427 | `    analysis: { ...analysis, finalDecision: 'NO_TRADE' },` | Hard skip for day/budget |
| 428 | `  };` | Statement |
| 429 | `}` | Statement |
