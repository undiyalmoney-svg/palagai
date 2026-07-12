import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function extractTradeDate(ts) {
  if (ts.includes('T')) return ts.split('T')[0];
  return ts.slice(0, 10);
}

function extractHhMm(dateTime) {
  const ts = new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
  if (Number.isNaN(ts)) {
    const part = dateTime.includes('T') ? dateTime.split('T')[1] : dateTime.split(' ')[1];
    return (part ?? '').slice(0, 5);
  }
  return new Date(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

function firstHourRangeFrom5m(ctx) {
  const tradingDate = extractTradeDate(ctx.candle5m.date);
  const time = extractHhMm(ctx.candle5m.date);
  if (time < '10:15') return null;

  const bars = [...ctx.previous5m, ctx.candle5m].filter(
    (c) =>
      extractTradeDate(c.date) === tradingDate &&
      extractHhMm(c.date) >= '09:15' &&
      extractHhMm(c.date) < '10:15',
  );
  if (!bars.length) return null;
  return {
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    barCount: bars.length,
  };
}

function runFirstHourBreakout(ctx, state) {
  const current5 = ctx.candle5m;
  const tradingDate = extractTradeDate(current5.date);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.tradedToday = false;
  }
  if (state.tradedToday) return { action: 'NO_TRADE' };

  const firstHour = firstHourRangeFrom5m(ctx);
  if (!firstHour) return { action: 'NO_TRADE' };

  if (current5.close > firstHour.high) {
    state.tradedToday = true;
    return { action: 'BUY', entry: current5.close, sl: current5.low };
  }
  if (current5.close < firstHour.low) {
    state.tradedToday = true;
    return { action: 'SELL', entry: current5.close, sl: current5.high };
  }
  return { action: 'NO_TRADE' };
}

function generateTradingDay(date, pattern) {
  const candles = [];
  const times = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = h === 9 ? 15 : 0; m < 60; m += 5) {
      if (h === 15 && m > 25) break;
      times.push(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+0530`);
    }
  }

  let price = 24000;
  for (let i = 0; i < times.length; i++) {
    const t = extractHhMm(times[i]);
    let drift = (Math.random() - 0.48) * 8;
    if (pattern === 'breakout_up' && t >= '10:15' && t < '11:00') drift = 15;
    if (pattern === 'breakout_down' && t >= '10:15' && t < '11:00') drift = -15;
    if (t >= '09:15' && t < '10:15') drift = (Math.random() - 0.5) * 3;

    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random() * 5;
    const low = Math.min(open, close) - Math.random() * 5;
    price = close;
    candles.push({ date: times[i], open, high, low, close, volume: 10000 });
  }
  return candles;
}

function runSmokeBacktest(days) {
  const all5m = [];
  const patterns = ['breakout_up', 'breakout_down', 'range', 'breakout_up', 'range'];
  for (let d = 0; d < days.length; d++) {
    all5m.push(...generateTradingDay(days[d], patterns[d % patterns.length]));
  }

  const fhState = { tradingDate: null, tradedToday: false };
  const fhTrades = [];

  for (let i = 0; i < all5m.length; i++) {
    const ctx = {
      candle5m: all5m[i],
      previous5m: all5m.slice(0, i),
    };
    const signal = runFirstHourBreakout(ctx, fhState);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      fhTrades.push({ date: extractTradeDate(all5m[i].date), ...signal });
    }
  }

  return { totalCandles: all5m.length, fhTrades };
}

function findMainBundle() {
  const browserDir = join(root, 'dist/palagai/browser');
  const file = readdirSync(browserDir).find((f) => f.startsWith('main-') && f.endsWith('.js'));
  return file ? join(browserDir, file) : null;
}

const testDays = ['2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-30'];
const result = runSmokeBacktest(testDays);

console.log('=== Backtest Smoke Test ===');
console.log(`Dates tested: ${testDays.join(', ')}`);
console.log(`Total 5m candles: ${result.totalCandles}`);
console.log(`First Hour Breakout trades: ${result.fhTrades.length}`);
result.fhTrades.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.date} ${t.action} @ ${t.entry.toFixed(2)} SL ${t.sl.toFixed(2)}`);
});

const bundlePath = findMainBundle();
if (bundlePath) {
  const bundle = readFileSync(bundlePath, 'utf8');
  const hasNew = bundle.includes('First Hour Breakout') && bundle.includes('Intraday Reversal');
  const hasOld = bundle.includes('Strategy 1 — Trendline Breakout');
  console.log('\n=== Bundle check ===');
  console.log(`Bundle: ${bundlePath.split('/').pop()}`);
  console.log(`Has new strategies: ${hasNew}`);
  console.log(`Has old Strategy 1 name: ${hasOld}`);
  if (hasOld) {
    console.error('\nWARN: Old research strategies still in bundle (dead code). Backtest uses only 2 active strategies.');
  }
} else {
  console.log('\n=== Bundle check ===');
  console.log('Dist bundle not found — run npm run build first');
}

if (result.fhTrades.length === 0) {
  console.error('\nFAIL: First Hour Breakout produced zero trades on synthetic data');
  process.exit(1);
}

console.log('\nPASS: First Hour Breakout logic generates trades on test dates');
