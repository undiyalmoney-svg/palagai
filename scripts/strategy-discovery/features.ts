import type { BarFeatures, Candle } from './types.ts';
import {
  atrSeries,
  ema,
  extractDate,
  extractHhMm,
  rollingSwing,
  supertrendSeries,
} from './indicators.ts';

const OR_END = '10:15';
const MARKET_OPEN = '09:15';

export function buildFeatures(candles: Candle[]): BarFeatures[] {
  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr = atrSeries(candles, 14);
  const st = supertrendSeries(candles, atr, 3);
  const swings = rollingSwing(candles, 3);
  const fractals = rollingSwing(candles, 2);

  const dayMap = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = extractDate(c.date);
    const list = dayMap.get(d) ?? [];
    list.push(c);
    dayMap.set(d, list);
  }
  const days = [...dayMap.keys()].sort();
  const prevDayStats = new Map<string, { high: number; low: number; close: number; up: boolean }>();
  for (let di = 1; di < days.length; di += 1) {
    const prev = dayMap.get(days[di - 1]!)!;
    const high = Math.max(...prev.map((c) => c.high));
    const low = Math.min(...prev.map((c) => c.low));
    const close = prev.at(-1)!.close;
    const open = prev[0]!.open;
    prevDayStats.set(days[di]!, { high, low, close, up: close >= open });
  }

  const features: BarFeatures[] = [];
  let dayCumPV = 0;
  let dayCumVol = 0;
  let dayHigh = -Infinity;
  let dayLow = Infinity;
  let orHigh = -Infinity;
  let orLow = Infinity;
  let orDone = false;
  let currentDay = '';
  let recentHighs: number[] = [];
  let recentLows: number[] = [];

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i]!;
    const day = extractDate(c.date);
    const hhmm = extractHhMm(c.date);

    if (day !== currentDay) {
      currentDay = day;
      dayCumPV = 0;
      dayCumVol = 0;
      dayHigh = -Infinity;
      dayLow = Infinity;
      orHigh = -Infinity;
      orLow = Infinity;
      orDone = false;
      recentHighs = [];
      recentLows = [];
    }

    dayCumPV += ((c.high + c.low + c.close) / 3) * Math.max(c.volume, 1);
    dayCumVol += Math.max(c.volume, 1);
    const vwap = dayCumPV / dayCumVol;
    dayHigh = Math.max(dayHigh, c.high);
    dayLow = Math.min(dayLow, c.low);

    if (hhmm >= MARKET_OPEN && hhmm < OR_END) {
      orHigh = Math.max(orHigh === -Infinity ? c.high : orHigh, c.high);
      orLow = Math.min(orLow === Infinity ? c.low : orLow, c.low);
    }
    if (hhmm >= OR_END) orDone = Number.isFinite(orHigh) && Number.isFinite(orLow);

    recentHighs.push(c.high);
    recentLows.push(c.low);
    if (recentHighs.length > 20) {
      recentHighs.shift();
      recentLows.shift();
    }

    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    const body = Math.abs(c.close - c.open);
    const range = Math.max(c.high - c.low, 1e-9);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    const bullEngulf =
      !!prev &&
      prev.close < prev.open &&
      c.close > c.open &&
      c.close >= prev.open &&
      c.open <= prev.close;
    const bearEngulf =
      !!prev &&
      prev.close > prev.open &&
      c.close < c.open &&
      c.open >= prev.close &&
      c.close <= prev.open;
    const hammer = lowerWick >= body * 2 && upperWick <= body * 0.5 && c.close >= c.open;
    const shootingStar = upperWick >= body * 2 && lowerWick <= body * 0.5 && c.close <= c.open;
    const insideBar =
      !!prev && c.high <= prev.high && c.low >= prev.low;
    const outsideBar =
      !!prev && c.high >= prev.high && c.low <= prev.low;

    const swingH = swings.high[i] ?? c.high;
    const swingL = swings.low[i] ?? c.low;
    const pd = prevDayStats.get(day);
    const pivot = pd ? (pd.high + pd.low + pd.close) / 3 : c.close;
    const r1 = 2 * pivot - (pd?.low ?? c.low);
    const s1 = 2 * pivot - (pd?.high ?? c.high);

    const look = Math.min(12, i);
    let hh = 0;
    let hl = 0;
    let lh = 0;
    let ll = 0;
    for (let k = i - look + 1; k <= i; k += 1) {
      if (k <= 0) continue;
      if (candles[k]!.high > candles[k - 1]!.high) hh += 1;
      else lh += 1;
      if (candles[k]!.low > candles[k - 1]!.low) hl += 1;
      else ll += 1;
    }

    const compressHigh = Math.max(...recentHighs);
    const compressLow = Math.min(...recentLows);
    const midBand = (compressHigh + compressLow) / 2;
    const bandWidth = compressHigh - compressLow;

    const liqSweepHigh =
      !!prev && c.high > swingH && c.close < swingH && c.close < c.open;
    const liqSweepLow =
      !!prev && c.low < swingL && c.close > swingL && c.close > c.open;

    const trendlineBreakUp =
      i >= 10 &&
      c.close > Math.max(...candles.slice(i - 10, i).map((x) => x.high)) * 0.998;
    const trendlineBreakDown =
      i >= 10 &&
      c.close < Math.min(...candles.slice(i - 10, i).map((x) => x.low)) * 1.002;

    const triangleBreakUp = bandWidth > 0 && c.close > compressHigh && bandWidth / midBand < 0.008;
    const triangleBreakDown = bandWidth > 0 && c.close < compressLow && bandWidth / midBand < 0.008;
    const wedgeBreakUp = bandWidth > 0 && c.close > compressHigh && hh >= 4 && ll >= 3;
    const wedgeBreakDown = bandWidth > 0 && c.close < compressLow && lh >= 4 && hl >= 3;

    const supply = Math.max(swingH, pd?.high ?? swingH, r1);
    const demand = Math.min(swingL, pd?.low ?? swingL, s1);
    const dynamicRes = Math.max(ema20[i] ?? c.close, ema50[i] ?? c.close, vwap);
    const dynamicSup = Math.min(ema20[i] ?? c.close, ema50[i] ?? c.close, vwap);

    features.push({
      i,
      date: c.date,
      hhmm,
      day,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema20: ema20[i] ?? c.close,
      ema50: ema50[i] ?? c.close,
      ema200: ema200[i] ?? c.close,
      vwap,
      atr: atr[i] ?? range,
      supertrend: st.value[i] ?? c.close,
      supertrendDir: st.dir[i] ?? 1,
      swingHigh: swingH,
      swingLow: swingL,
      fractalHigh: fractals.high[i] ?? c.high,
      fractalLow: fractals.low[i] ?? c.low,
      pivot,
      r1,
      s1,
      pdh: pd?.high ?? c.high,
      pdl: pd?.low ?? c.low,
      pdc: pd?.close ?? c.close,
      sessionHigh: dayHigh,
      sessionLow: dayLow,
      orHigh: orHigh === -Infinity ? c.high : orHigh,
      orLow: orLow === Infinity ? c.low : orLow,
      orDone,
      supply,
      demand,
      dynamicRes,
      dynamicSup,
      hhHl: hh >= 3 && hl >= 2,
      lhLl: lh >= 3 && ll >= 2,
      prevDayUp: pd?.up ?? true,
      orBullish: orDone && c.close >= (orHigh + orLow) / 2,
      bullEngulf,
      bearEngulf,
      hammer,
      shootingStar,
      insideBar,
      outsideBar,
      liqSweepHigh,
      liqSweepLow,
      trendlineBreakUp,
      trendlineBreakDown,
      triangleBreakUp,
      triangleBreakDown,
      wedgeBreakUp,
      wedgeBreakDown,
    });
  }

  return features;
}
