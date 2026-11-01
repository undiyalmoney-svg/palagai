import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { PAPER_LIVE_ASSUME } from './paper-live-assume.fixture';
import {
  LIVE_ASSUME_BOOKS,
  LiveAssumeBar,
  LiveAssumeSnapshot,
  closeBook,
  summarize,
} from './live-assume.engine';

@Injectable({ providedIn: 'root' })
export class LiveAssumeService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kite = inject(KiteSessionService);

  readonly busy = signal(false);
  readonly result = signal<LiveAssumeSnapshot>(PAPER_LIVE_ASSUME);
  readonly error = signal('');

  lastClosed(): LiveAssumeSnapshot {
    return PAPER_LIVE_ASSUME;
  }

  async runFromKite(): Promise<LiveAssumeSnapshot> {
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const snap = {
        ...PAPER_LIVE_ASSUME,
        kiteError: 'Connect Kite on Token first. This is assumption trading — no order is placed.',
        source: 'cache',
      };
      this.result.set(snap);
      this.error.set(snap.kiteError || '');
      return snap;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const [margins, csv] = await Promise.all([
        firstValueFrom(this.kiteApi.getUserMargins(auth)),
        firstValueFrom(this.kiteApi.getInstrumentsCsv(auth)).catch(() => ''),
      ]);
      const funds = parseFunds(margins);
      const dump = String(csv || '');
      const crude = findCrudeMini(dump);
      const nifty = findNamed(dump, ['NIFTY 50']) || { tradingSymbol: 'NIFTY 50', token: 256265, exchange: 'NSE' };
      const bank = findNamed(dump, ['NIFTY BANK']) || { tradingSymbol: 'NIFTY BANK', token: 260105, exchange: 'NSE' };
      const sensex = findNamed(dump, ['SENSEX']) || { tradingSymbol: 'SENSEX', token: 265, exchange: 'BSE' };

      const keys = [
        crude ? `MCX:${crude.tradingSymbol}` : '',
        'NSE:NIFTY 50',
        'NSE:NIFTY BANK',
        'BSE:SENSEX',
      ].filter(Boolean);
      const quotes = keys.length
        ? ((await firstValueFrom(this.kiteApi.getQuotes(auth, keys))) as { data?: Record<string, { last_price?: number }> })
            ?.data || {}
        : {};

      const to = istDay(new Date());
      const from = shiftDay(to, -8);
      const books = [];
      for (const cfg of LIVE_ASSUME_BOOKS) {
        const inst =
          cfg.id === 'crude' ? crude : cfg.id === 'nifty' ? nifty : cfg.id === 'bank' ? bank : sensex;
        const token = inst?.token;
        let bars: LiveAssumeBar[] = [];
        if (token) {
          const hist = (await firstValueFrom(
            this.kiteApi.getHistoricalData({
              instrumentToken: String(token),
              interval: '5minute',
              from,
              to,
              authorization: auth,
            }),
          )) as { data?: { candles?: unknown[][] } };
          bars = (hist?.data?.candles || []).map(kiteBar).filter((b) => b.day);
        }
        const last = lastPrice(quotes, cfg.id, inst?.tradingSymbol || '');
        books.push(closeBook(bars, cfg, inst?.tradingSymbol || cfg.label, last));
      }
      const snap = summarize(books, 'kite', funds, null, new Date().toISOString());
      this.result.set(snap);
      return snap;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kite fetch failed';
      const snap = {
        ...PAPER_LIVE_ASSUME,
        kiteError: message,
        source: 'cache',
      };
      this.result.set(snap);
      this.error.set(message);
      return snap;
    } finally {
      this.busy.set(false);
    }
  }
}

function parseFunds(payload: unknown): LiveAssumeSnapshot['kiteFunds'] {
  const root = (payload as { data?: { equity?: Seg; commodity?: Seg } })?.data || {};
  const pocket = (seg?: Seg) => {
    const a = seg?.available || {};
    const live = Number(a.live_balance);
    if (Number.isFinite(live) && live > 0) return Math.round(live);
    const cash = Number(a.cash);
    if (Number.isFinite(cash) && cash > 0) return Math.round(cash);
    return Math.round(Number(seg?.net) || 0);
  };
  return {
    equityCash: pocket(root.equity),
    equityNet: Math.round(Number(root.equity?.net) || 0),
    commodityCash: pocket(root.commodity),
    commodityNet: Math.round(Number(root.commodity?.net) || 0),
  };
}

interface Seg {
  net?: number;
  available?: { live_balance?: number; cash?: number };
}

function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function findCrudeMini(csv: string): { tradingSymbol: string; token: number; exchange: string } | null {
  const today = istDay(new Date());
  const rows: { tradingSymbol: string; token: number; exchange: string; expiry: string }[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== 'MCX' || cols[9].trim().toUpperCase() !== 'FUT') continue;
    if (!cols[2].toUpperCase().startsWith('CRUDEOILM')) continue;
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: 'MCX',
      expiry: (cols[5] || '').slice(0, 10),
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return rows.find((r) => !r.expiry || r.expiry > today) || null;
}

function findNamed(csv: string, names: string[]): { tradingSymbol: string; token: number; exchange: string } | null {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}

function kiteBar(row: unknown[]): LiveAssumeBar {
  const raw = String(row[0] || '');
  const d = new Date(raw);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const day = raw.slice(0, 10);
  const hh = Number.isNaN(d.getTime()) ? Number(raw.slice(11, 13)) : ist.getUTCHours();
  const mm = Number.isNaN(d.getTime()) ? Number(raw.slice(14, 16)) : ist.getUTCMinutes();
  return {
    day,
    min: hh * 60 + mm,
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0,
  };
}

function lastPrice(
  quotes: Record<string, { last_price?: number }>,
  id: string,
  symbol: string,
): number | null {
  for (const [k, v] of Object.entries(quotes)) {
    const key = k.toUpperCase();
    if (id === 'crude' && key.includes('CRUDE')) return Number(v.last_price) || null;
    if (id === 'nifty' && key.includes('NIFTY 50')) return Number(v.last_price) || null;
    if (id === 'bank' && key.includes('BANK')) return Number(v.last_price) || null;
    if (id === 'sensex' && key.includes('SENSEX')) return Number(v.last_price) || null;
    if (symbol && key.includes(symbol.toUpperCase())) return Number(v.last_price) || null;
  }
  return null;
}

function istDay(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + delta);
  return istDay(d);
}
