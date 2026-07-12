import type { Candle } from './types.ts';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const INSTRUMENTS = {
  nifty: { token: 256265, name: 'NIFTY 50' },
  banknifty: { token: 260105, name: 'NIFTY BANK' },
} as const;

export type InstrumentKey = keyof typeof INSTRUMENTS;

export async function fetchHistorical5m(opts: {
  token: number;
  from: string;
  to: string;
  authorization: string;
  chunkDays?: number;
  delayMs?: number;
}): Promise<Candle[]> {
  const chunkDays = opts.chunkDays ?? 95;
  const delayMs = opts.delayMs ?? 2200;
  const all: Candle[] = [];
  const seen = new Set<string>();

  let cursor = opts.from;
  const endTs = parseTs(opts.to);

  while (parseTs(cursor) < endTs) {
    const d = new Date(parseTs(cursor));
    d.setDate(d.getDate() + chunkDays);
    const chunkEnd = formatDt(d);
    const to = parseTs(chunkEnd) > endTs ? opts.to : chunkEnd;

    process.stdout.write(`  fetch ${cursor.slice(0, 10)} → ${to.slice(0, 10)}… `);
    const params = new URLSearchParams({ from: cursor, to });
    const url = `https://api.kite.trade/instruments/historical/${opts.token}/5minute?${params}`;
    const res = await fetch(url, {
      headers: {
        'X-Kite-Version': '3',
        Authorization: opts.authorization,
      },
    });
    const body = (await res.json()) as {
      status?: string;
      message?: string;
      data?: { candles?: (string | number)[][] };
    };

    if (body.status !== 'success' || !body.data?.candles?.length) {
      console.log(`fail: ${body.message ?? res.status}`);
    } else {
      for (const row of body.data.candles) {
        const date = String(row[0]);
        if (seen.has(date)) continue;
        seen.add(date);
        all.push({
          date,
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        });
      }
      console.log(`+${body.data.candles.length} (total ${all.length})`);
    }

    const next = new Date(parseTs(to));
    next.setDate(next.getDate() + 1);
    cursor = formatDt(next);
    await sleep(delayMs);
  }

  all.sort((a, b) => parseTs(a.date) - parseTs(b.date));
  return all;
}
