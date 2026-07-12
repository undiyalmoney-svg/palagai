/** Shared OHLC pattern simulation for offline research scripts (not app strategies). */

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Direction = 'BUY' | 'SELL';

export interface PatternConfig {
  name: string;
  setup:
    | 'orb_break'
    | 'orb_fade'
    | 'pdhl_break'
    | 'big_range_trend'
    | 'midday_break'
    | 'late_momentum';
  entryStart: string;
  entryEnd: string;
  targetPts: number;
  stopPts: number;
  minOrbPts?: number;
  maxOrbPts?: number;
  allowedDow?: number[];
  maxTradesPerMonth: number;
}

export interface SessionConfig {
  marketOpen: string;
  firstHourEnd: string;
  sessionClose: string;
}

export const NIFTY_SESSION: SessionConfig = {
  marketOpen: '09:15',
  firstHourEnd: '10:15',
  sessionClose: '15:15',
};

export const CRUDE_SESSION: SessionConfig = {
  marketOpen: '09:00',
  firstHourEnd: '10:00',
  sessionClose: '23:15',
};

export interface SimTrade {
  date: string;
  month: string;
  direction: Direction;
  entryTime: string;
  exitTime: string;
  entry: number;
  exit: number;
  points: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  setupScore: number;
}

export function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

export function extractDate(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return n.slice(0, 10);
}

export function extractHhMm(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return (n.split(' ')[1] ?? '').slice(0, 5);
}

export function extractDow(date: string): number {
  return new Date(`${date}T00:00:00+05:30`).getDay();
}

export function groupByDate(candles: Candle[]): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = extractDate(c.date);
    const list = map.get(d) ?? [];
    list.push(c);
    map.set(d, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => parseTs(a.date) - parseTs(b.date));
  }
  return map;
}

function firstHourRange(day: Candle[], session: SessionConfig): { high: number; low: number; pts: number } | null {
  const bars = day.filter((c) => {
    const t = extractHhMm(c.date);
    return t >= session.marketOpen && t < session.firstHourEnd;
  });
  if (!bars.length) return null;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, pts: high - low };
}

function prevDayHl(byDate: Map<string, Candle[]>, date: string): { pdh: number; pdl: number } | null {
  const dates = [...byDate.keys()].sort();
  const idx = dates.indexOf(date);
  if (idx <= 0) return null;
  const prev = byDate.get(dates[idx - 1]!);
  if (!prev?.length) return null;
  return { pdh: Math.max(...prev.map((c) => c.high)), pdl: Math.min(...prev.map((c) => c.low)) };
}

function simulateExit(
  day: Candle[],
  startIdx: number,
  direction: Direction,
  entry: number,
  stopPts: number,
  targetPts: number,
  sessionClose: string,
): { exitTime: string; exit: number; points: number; outcome: 'WIN' | 'LOSS'; reason: string } {
  const sl = direction === 'BUY' ? entry - stopPts : entry + stopPts;
  const tp = direction === 'BUY' ? entry + targetPts : entry - targetPts;

  for (let i = startIdx + 1; i < day.length; i += 1) {
    const c = day[i]!;
    if (direction === 'BUY') {
      if (c.low <= sl) return { exitTime: c.date, exit: sl, points: sl - entry, outcome: 'LOSS', reason: 'SL' };
      if (c.high >= tp) return { exitTime: c.date, exit: tp, points: tp - entry, outcome: 'WIN', reason: 'TP' };
    } else {
      if (c.high >= sl) return { exitTime: c.date, exit: sl, points: entry - sl, outcome: 'LOSS', reason: 'SL' };
      if (c.low <= tp) return { exitTime: c.date, exit: tp, points: entry - tp, outcome: 'WIN', reason: 'TP' };
    }
    if (extractHhMm(c.date) === sessionClose) {
      const exit = c.close;
      const pts = direction === 'BUY' ? exit - entry : entry - exit;
      return { exitTime: c.date, exit, points: pts, outcome: pts > 0 ? 'WIN' : 'LOSS', reason: 'Session close' };
    }
  }

  const last = day.at(-1)!;
  const pts = direction === 'BUY' ? last.close - entry : entry - last.close;
  return { exitTime: last.date, exit: last.close, points: pts, outcome: pts > 0 ? 'WIN' : 'LOSS', reason: 'EOD' };
}

function detectSignal(
  cfg: PatternConfig,
  day: Candle[],
  orb: { high: number; low: number; pts: number },
  pdhl: { pdh: number; pdl: number } | null,
  idx: number,
  session: SessionConfig,
): { direction: Direction; score: number } | null {
  const c = day[idx]!;
  const t = extractHhMm(c.date);
  if (t < cfg.entryStart || t > cfg.entryEnd) return null;
  if (cfg.minOrbPts && orb.pts < cfg.minOrbPts) return null;
  if (cfg.maxOrbPts && orb.pts > cfg.maxOrbPts) return null;

  const prev = day[idx - 1] ?? null;

  switch (cfg.setup) {
    case 'orb_break':
      if (c.close > orb.high && c.close > c.open) return { direction: 'BUY', score: orb.pts };
      if (c.close < orb.low && c.close < c.open) return { direction: 'SELL', score: orb.pts };
      return null;
    case 'orb_fade':
      if (prev && prev.high > orb.high && c.close < orb.high && c.close < c.open) {
        return { direction: 'SELL', score: orb.pts };
      }
      if (prev && prev.low < orb.low && c.close > orb.low && c.close > c.open) {
        return { direction: 'BUY', score: orb.pts };
      }
      return null;
    case 'pdhl_break':
      if (!pdhl) return null;
      if (c.close > pdhl.pdh && c.close > c.open) return { direction: 'BUY', score: c.close - pdhl.pdh };
      if (c.close < pdhl.pdl && c.close < c.open) return { direction: 'SELL', score: pdhl.pdl - c.close };
      return null;
    case 'big_range_trend':
      if (orb.pts < (cfg.minOrbPts ?? 80)) return null;
      if (c.close > orb.high) return { direction: 'BUY', score: orb.pts };
      if (c.close < orb.low) return { direction: 'SELL', score: orb.pts };
      return null;
    case 'midday_break': {
      const midday = day.filter((x) => {
        const h = extractHhMm(x.date);
        return h >= '12:00' && h < '13:00';
      });
      if (!midday.length) return null;
      const mh = Math.max(...midday.map((x) => x.high));
      const ml = Math.min(...midday.map((x) => x.low));
      if (t >= '13:00' && t <= '15:00') {
        if (c.close > mh) return { direction: 'BUY', score: mh - ml };
        if (c.close < ml) return { direction: 'SELL', score: mh - ml };
      }
      return null;
    }
    case 'late_momentum':
      if (t < '19:00' || t > '21:00') return null;
      if (session.sessionClose === '15:15') return null;
      {
        const dayOpen = day.find((x) => extractHhMm(x.date) >= session.marketOpen)?.open;
        if (dayOpen === undefined) return null;
        if (c.close > dayOpen && c.close > c.open) return { direction: 'BUY', score: Math.abs(c.close - dayOpen) };
        if (c.close < dayOpen && c.close < c.open) return { direction: 'SELL', score: Math.abs(dayOpen - c.close) };
      }
      return null;
    default:
      return null;
  }
}

/** Run one pattern on given trading dates within byDate store. */
export function runPatternOnDates(
  cfg: PatternConfig,
  byDate: Map<string, Candle[]>,
  dates: string[],
  session: SessionConfig,
): SimTrade[] {
  const candidates: SimTrade[] = [];

  for (const date of dates) {
    if (cfg.allowedDow && !cfg.allowedDow.includes(extractDow(date))) continue;
    const day = byDate.get(date);
    if (!day?.length) continue;
    const orb = firstHourRange(day, session);
    if (!orb) continue;
    const pdhl = prevDayHl(byDate, date);

    for (let i = 0; i < day.length; i += 1) {
      const sig = detectSignal(cfg, day, orb, pdhl, i, session);
      if (!sig) continue;
      const entryCandle = day[i]!;
      const exit = simulateExit(day, i, sig.direction, entryCandle.close, cfg.stopPts, cfg.targetPts, session.sessionClose);
      candidates.push({
        date,
        month: date.slice(0, 7),
        direction: sig.direction,
        entryTime: entryCandle.date,
        exitTime: exit.exitTime,
        entry: entryCandle.close,
        exit: exit.exit,
        points: exit.points,
        outcome: exit.outcome,
        exitReason: exit.reason,
        setupScore: sig.score,
      });
      break;
    }
  }

  const month = dates[0]?.slice(0, 7) ?? '';
  const sorted = [...candidates].sort((a, b) => b.setupScore - a.setupScore);
  return sorted.slice(0, cfg.maxTradesPerMonth);
}

export function buildPatternGrid(session: SessionConfig): PatternConfig[] {
  const targets = [100, 150, 200];
  const stops = [40, 60, 80];
  const configs: PatternConfig[] = [];

  for (const targetPts of targets) {
    for (const stopPts of stops) {
      configs.push({
        name: `ORB break 10-11:30 TP${targetPts} SL${stopPts}`,
        setup: 'orb_break',
        entryStart: session.firstHourEnd.slice(0, 5) === '10:15' ? '10:15' : '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 40,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB break 10-11:30 TP${targetPts} SL${stopPts} ORB≥80`,
        setup: 'orb_break',
        entryStart: session.firstHourEnd.slice(0, 5) === '10:15' ? '10:15' : '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 80,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB fade 10-12 TP${targetPts} SL${stopPts}`,
        setup: 'orb_fade',
        entryStart: session.firstHourEnd.slice(0, 5) === '10:15' ? '10:15' : '10:00',
        entryEnd: '12:00',
        targetPts,
        stopPts,
        minOrbPts: 50,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `PDHL break 10-12 TP${targetPts} SL${stopPts}`,
        setup: 'pdhl_break',
        entryStart: session.firstHourEnd.slice(0, 5) === '10:15' ? '10:15' : '10:00',
        entryEnd: '12:00',
        targetPts,
        stopPts,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `Midday break TP${targetPts} SL${stopPts}`,
        setup: 'midday_break',
        entryStart: '13:00',
        entryEnd: session.sessionClose === '15:15' ? '15:00' : '16:00',
        targetPts,
        stopPts,
        maxTradesPerMonth: 5,
      });
      configs.push({
        name: `ORB break Tue-Thu TP${targetPts} SL${stopPts}`,
        setup: 'orb_break',
        entryStart: session.firstHourEnd.slice(0, 5) === '10:15' ? '10:15' : '10:00',
        entryEnd: '11:30',
        targetPts,
        stopPts,
        minOrbPts: 50,
        allowedDow: [2, 3, 4],
        maxTradesPerMonth: 5,
      });
    }
  }

  if (session.sessionClose === '23:15') {
    for (const targetPts of targets) {
      for (const stopPts of stops) {
        configs.push({
          name: `Late momentum 19-21 TP${targetPts} SL${stopPts}`,
          setup: 'late_momentum',
          entryStart: '19:00',
          entryEnd: '21:00',
          targetPts,
          stopPts,
          maxTradesPerMonth: 5,
        });
      }
    }
  }

  return configs;
}

export interface StrategyMonthScore {
  month: string;
  trades: number;
  wins: number;
  netPts: number;
  tradeList: SimTrade[];
}

export interface StrategyAggregate {
  name: string;
  config: PatternConfig;
  totalTrades: number;
  wins: number;
  losses: number;
  netPts: number;
  monthsTotal: number;
  monthsProfitable: number;
  monthsLosing: number;
  monthsFlat: number;
  monthWinRate: number;
  avgMonthlyPts: number;
  avgWinPts: number;
  avgLossPts: number;
  monthly: StrategyMonthScore[];
}

export function aggregateStrategy(name: string, config: PatternConfig, monthly: StrategyMonthScore[]): StrategyAggregate {
  const allTrades = monthly.flatMap((m) => m.tradeList);
  const wins = allTrades.filter((t) => t.outcome === 'WIN');
  const losses = allTrades.filter((t) => t.outcome === 'LOSS');
  const netPts = allTrades.reduce((s, t) => s + t.points, 0);
  const monthsProfitable = monthly.filter((m) => m.netPts > 0).length;
  const monthsLosing = monthly.filter((m) => m.netPts < 0).length;
  const monthsFlat = monthly.filter((m) => m.netPts === 0).length;

  return {
    name,
    config,
    totalTrades: allTrades.length,
    wins: wins.length,
    losses: losses.length,
    netPts,
    monthsTotal: monthly.length,
    monthsProfitable,
    monthsLosing,
    monthsFlat,
    monthWinRate: monthly.length ? (monthsProfitable / monthly.length) * 100 : 0,
    avgMonthlyPts: monthly.length ? netPts / monthly.length : 0,
    avgWinPts: wins.length ? wins.reduce((s, t) => s + t.points, 0) / wins.length : 0,
    avgLossPts: losses.length ? losses.reduce((s, t) => s + t.points, 0) / losses.length : 0,
    monthly,
  };
}

export function rankStrategies(list: StrategyAggregate[]): StrategyAggregate[] {
  return [...list].sort((a, b) => {
    if (b.monthWinRate !== a.monthWinRate) return b.monthWinRate - a.monthWinRate;
    if (b.netPts !== a.netPts) return b.netPts - a.netPts;
    return b.avgMonthlyPts - a.avgMonthlyPts;
  });
}
