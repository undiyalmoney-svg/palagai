# Annotated — crude-pdhl-evening.evaluator.ts
Every line of the Crude **secret evening entry** evaluator, mapped for owner reference.
**Source:** `src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator.ts`
---
| Line | Code | Comment |
|------|------|--------|
| 1 | `/**` | Block comment start |
| 2 | ` * CRUDEOILM champion (hunt May–Jul 2026):` | Block comment body |
| 3 | ` * PDHL break · entries 19:00–21:00 · SL 80 · TP 200 · ≤2/day · ≤8/month` | Block comment body |
| 4 | ` * Exit: target / stop / 23:10 session.` | Block comment body |
| 5 | ` * Does not change Nifty / Bank Nifty DNA.` | Block comment body |
| 6 | ` */` | Block comment end |
| 7 | `import { Candle } from '../../../models/candle.model';` | Import dependency |
| 8 | `import { extractTradeDate } from '../../../utils/trade-date.util';` | Import dependency |
| 9 | `import { extractHhMm } from '../../utils/market-session.util';` | Import dependency |
| 10 | `` | Blank — section break |
| 11 | `export const CRUDE_RUPEES_PER_POINT = 10;` | Exported symbol (used by desks/engines) |
| 12 | `export const CRUDE_STOP_PTS = 80;` | Crude fixed stop 80 |
| 13 | `export const CRUDE_TARGET_PTS = 200;` | Crude fixed target 200 |
| 14 | `export const CRUDE_ENTRY_START = '19:00';` | Evening entry open 19:00 |
| 15 | `export const CRUDE_ENTRY_END = '21:00';` | Evening entry close 21:00 |
| 16 | `export const CRUDE_EXIT_BY = '23:10';` | Force exit 23:10 |
| 17 | `export const CRUDE_MAX_TRADES_DAY = 2;` | Max 2 trades per day |
| 18 | `export const CRUDE_MAX_TRADES_MONTH = 8;` | Max 8 trades per month |
| 19 | `export const CRUDE_DAY_LOSS_STOP_PTS = 240;` | Day loss kill −240 |
| 20 | `` | Blank — section break |
| 21 | `export interface CrudePdhlState {` | Exported symbol (used by desks/engines) |
| 22 | `  tradingDate: string \| null;` | Statement |
| 23 | `  tradingMonth: string \| null;` | Statement |
| 24 | `  dayNetPts: number;` | Statement |
| 25 | `  tradesToday: number;` | Statement |
| 26 | `  tradesThisMonth: number;` | Statement |
| 27 | `  dayStoppedReason: string \| null;` | Statement |
| 28 | `}` | Statement |
| 29 | `` | Blank — section break |
| 30 | `export function createCrudePdhlState(): CrudePdhlState {` | Exported symbol (used by desks/engines) |
| 31 | `  return {` | Return value / early exit |
| 32 | `    tradingDate: null,` | Statement |
| 33 | `    tradingMonth: null,` | Statement |
| 34 | `    dayNetPts: 0,` | Statement |
| 35 | `    tradesToday: 0,` | Statement |
| 36 | `    tradesThisMonth: 0,` | Statement |
| 37 | `    dayStoppedReason: null,` | Statement |
| 38 | `  };` | Statement |
| 39 | `}` | Statement |
| 40 | `` | Blank — section break |
| 41 | `export function recordCrudeTradeClosed(state: CrudePdhlState, points: number): void {` | Update crude day/month after close |
| 42 | `  state.dayNetPts += points;` | Statement |
| 43 | `  state.tradesToday += 1;` | Statement |
| 44 | `  state.tradesThisMonth += 1;` | Statement |
| 45 | `  if (state.dayNetPts <= -CRUDE_DAY_LOSS_STOP_PTS) {` | Day loss kill −240 |
| 46 | `    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 47 | `  }` | Statement |
| 48 | `}` | Statement |
| 49 | `` | Blank — section break |
| 50 | `function prevDayHl(` | Compute previous day H/L |
| 51 | `  candles: Candle[],` | Statement |
| 52 | `  beforeIndex: number,` | Statement |
| 53 | `  tradingDate: string,` | Statement |
| 54 | `): { pdh: number; pdl: number } \| null {` | Statement |
| 55 | `  let prevDate: string \| null = null;` | Statement |
| 56 | `  for (let i = beforeIndex - 1; i >= 0; i -= 1) {` | Loop |
| 57 | `    const d = extractTradeDate(candles[i]!.date);` | Statement |
| 58 | `    if (d < tradingDate) {` | Branch / gate |
| 59 | `      prevDate = d;` | Statement |
| 60 | `      break;` | Statement |
| 61 | `    }` | Statement |
| 62 | `  }` | Statement |
| 63 | `  if (!prevDate) {` | Branch / gate |
| 64 | `    return null;` | Return value / early exit |
| 65 | `  }` | Statement |
| 66 | `  let pdh = -Infinity;` | Statement |
| 67 | `  let pdl = Infinity;` | Statement |
| 68 | `  for (let i = 0; i < beforeIndex; i += 1) {` | Loop |
| 69 | `    const c = candles[i]!;` | Statement |
| 70 | `    if (extractTradeDate(c.date) !== prevDate) {` | Branch / gate |
| 71 | `      continue;` | Statement |
| 72 | `    }` | Statement |
| 73 | `    pdh = Math.max(pdh, c.high);` | Statement |
| 74 | `    pdl = Math.min(pdl, c.low);` | Statement |
| 75 | `  }` | Statement |
| 76 | `  if (!Number.isFinite(pdh) \|\| !Number.isFinite(pdl)) {` | Branch / gate |
| 77 | `    return null;` | Return value / early exit |
| 78 | `  }` | Statement |
| 79 | `  return { pdh, pdl };` | Return value / early exit |
| 80 | `}` | Statement |
| 81 | `` | Blank — section break |
| 82 | `export type CrudeSignalAction = 'BUY' \| 'SELL' \| 'WAITING' \| 'NO_TRADE';` | No entry yet |
| 83 | `` | Blank — section break |
| 84 | `export interface CrudePdhlSignal {` | Exported symbol (used by desks/engines) |
| 85 | `  action: CrudeSignalAction;` | Statement |
| 86 | `  entryPrice: number;` | Statement |
| 87 | `  stopLoss: number;` | Statement |
| 88 | `  target: number;` | Statement |
| 89 | `  reason: string;` | Statement |
| 90 | `}` | Statement |
| 91 | `` | Blank — section break |
| 92 | `export function runCrudePdhlEvening(params: {` | MAIN Crude entry evaluator |
| 93 | `  candle: Candle;` | Statement |
| 94 | `  series: Candle[];` | Statement |
| 95 | `  index: number;` | Statement |
| 96 | `  state: CrudePdhlState;` | Statement |
| 97 | `}): CrudePdhlSignal {` | Statement |
| 98 | `  const { candle, series, index, state } = params;` | Statement |
| 99 | `  const tradingDate = extractTradeDate(candle.date);` | Statement |
| 100 | `  const month = tradingDate.slice(0, 7);` | Statement |
| 101 | `  const time = extractHhMm(candle.date);` | Statement |
| 102 | `` | Blank — section break |
| 103 | `  if (state.tradingDate !== tradingDate) {` | Branch / gate |
| 104 | `    state.tradingDate = tradingDate;` | Statement |
| 105 | `    state.dayNetPts = 0;` | Statement |
| 106 | `    state.tradesToday = 0;` | Statement |
| 107 | `    state.dayStoppedReason = null;` | Statement |
| 108 | `  }` | Statement |
| 109 | `  if (state.tradingMonth !== month) {` | Branch / gate |
| 110 | `    state.tradingMonth = month;` | Statement |
| 111 | `    state.tradesThisMonth = 0;` | Statement |
| 112 | `  }` | Statement |
| 113 | `` | Blank — section break |
| 114 | `  if (state.dayStoppedReason) {` | Branch / gate |
| 115 | `    return wait(candle, state.dayStoppedReason);` | Return value / early exit |
| 116 | `  }` | Statement |
| 117 | `  if (state.dayNetPts <= -CRUDE_DAY_LOSS_STOP_PTS) {` | Day loss kill −240 |
| 118 | `    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;` | Statement |
| 119 | `    return wait(candle, state.dayStoppedReason);` | Return value / early exit |
| 120 | `  }` | Statement |
| 121 | `  if (state.tradesToday >= CRUDE_MAX_TRADES_DAY) {` | Max 2 trades per day |
| 122 | `    return wait(candle, `Max ${CRUDE_MAX_TRADES_DAY} trades/day`);` | Max 2 trades per day |
| 123 | `  }` | Statement |
| 124 | `  if (state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {` | Max 8 trades per month |
| 125 | `    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);` | Max 8 trades per month |
| 126 | `  }` | Statement |
| 127 | `  if (time < CRUDE_ENTRY_START \|\| time > CRUDE_ENTRY_END) {` | Evening entry open 19:00 |
| 128 | `    return wait(` | Return value / early exit |
| 129 | `      candle,` | Statement |
| 130 | `      `Outside entry window (${CRUDE_ENTRY_START}–${CRUDE_ENTRY_END})`,` | Evening entry open 19:00 |
| 131 | `    );` | Statement |
| 132 | `  }` | Statement |
| 133 | `` | Blank — section break |
| 134 | `  const levels = prevDayHl(series, index, tradingDate);` | Compute previous day H/L |
| 135 | `  if (!levels) {` | Branch / gate |
| 136 | `    return wait(candle, 'Previous day H/L not ready');` | Return value / early exit |
| 137 | `  }` | Statement |
| 138 | `` | Blank — section break |
| 139 | `  let action: 'BUY' \| 'SELL' \| null = null;` | Statement |
| 140 | `  if (candle.close > levels.pdh && candle.close > candle.open) {` | Crude BUY: break prev day high |
| 141 | `    action = 'BUY';` | Statement |
| 142 | `  } else if (candle.close < levels.pdl && candle.close < candle.open) {` | Crude SELL: break prev day low |
| 143 | `    action = 'SELL';` | Statement |
| 144 | `  }` | Statement |
| 145 | `  if (!action) {` | Branch / gate |
| 146 | `    return wait(candle, `Waiting PDHL break (${levels.pdl.toFixed(1)}–${levels.pdh.toFixed(1)})`);` | Return value / early exit |
| 147 | `  }` | Statement |
| 148 | `` | Blank — section break |
| 149 | `  const entry = candle.close;` | Statement |
| 150 | `  const stopLoss = action === 'BUY' ? entry - CRUDE_STOP_PTS : entry + CRUDE_STOP_PTS;` | Crude fixed stop 80 |
| 151 | `  const target = action === 'BUY' ? entry + CRUDE_TARGET_PTS : entry - CRUDE_TARGET_PTS;` | Crude fixed target 200 |
| 152 | `` | Blank — section break |
| 153 | `  if (state.dayNetPts - CRUDE_STOP_PTS < -CRUDE_DAY_LOSS_STOP_PTS) {` | Crude fixed stop 80 |
| 154 | `    return {` | Return value / early exit |
| 155 | `      action: 'NO_TRADE',` | Hard skip for day/budget |
| 156 | `      entryPrice: entry,` | Statement |
| 157 | `      stopLoss: entry,` | Statement |
| 158 | `      target: entry,` | Statement |
| 159 | `      reason: 'Next SL would breach day max loss',` | Statement |
| 160 | `    };` | Statement |
| 161 | `  }` | Statement |
| 162 | `` | Blank — section break |
| 163 | `  return {` | Return value / early exit |
| 164 | `    action,` | Statement |
| 165 | `    entryPrice: entry,` | Statement |
| 166 | `    stopLoss,` | Statement |
| 167 | `    target,` | Statement |
| 168 | `    reason: `${action} PDHL · SL ${CRUDE_STOP_PTS} / TP ${CRUDE_TARGET_PTS} · day ${state.dayNetPts.toFixed(1)}`,` | Crude fixed stop 80 |
| 169 | `  };` | Statement |
| 170 | `}` | Statement |
| 171 | `` | Blank — section break |
| 172 | `function wait(candle: Candle, reason: string): CrudePdhlSignal {` | Function definition |
| 173 | `  return {` | Return value / early exit |
| 174 | `    action: 'WAITING',` | No entry yet |
| 175 | `    entryPrice: candle.close,` | Statement |
| 176 | `    stopLoss: candle.close,` | Statement |
| 177 | `    target: candle.close,` | Statement |
| 178 | `    reason,` | Statement |
| 179 | `  };` | Statement |
| 180 | `}` | Statement |
