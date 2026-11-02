import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { LiveAssumeBar } from './live-assume.engine';
import {
  LIVE_PAPER_BOOKS,
  LivePaperSession,
  emptySession,
  istDay,
  istMinutes,
  summarizePaper,
  tickBook,
} from './live-paper.engine';

const STORAGE_KEY = 'palagai_live_paper_v1';
const TICK_MS = 8_000;

@Injectable({ providedIn: 'root' })
export class LivePaperService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kite = inject(KiteSessionService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  readonly session = signal<LivePaperSession>(readStored() || emptySession(istDay()));
  readonly busy = signal(false);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    if (this.session().running) {
      this.loop();
    }
  }

  async start(): Promise<void> {
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const idle = emptySession(istDay());
      const snap = {
        ...idle,
        kiteError: 'Connect Kite on Token first. Paper only — no order is placed.',
        source: 'idle',
      };
      this.session.set(snap);
      persist(snap);
      return;
    }
    const day = istDay();
    const prev = this.session();
    const base =
      prev.day === day
        ? { ...prev, running: true, startedAt: prev.startedAt || new Date().toISOString(), kiteError: null }
        : { ...emptySession(day), running: true, startedAt: new Date().toISOString() };
    this.session.set(base);
    persist(base);
    this.loop();
    await this.tick();
  }

  stop(): void {
    this.clearTimer();
    const cur = this.session();
    const books = cur.books.map((b) => {
      if (b.side === 'flat' || b.entry == null || b.last == null) return b;
      return tickBook(
        b,
        LIVE_PAPER_BOOKS.find((c) => c.id === b.id) || LIVE_PAPER_BOOKS[0],
        [],
        b.last,
        cur.day,
        24 * 60,
        b.instrument,
      );
    });
    const snap = summarizePaper(books, {
      running: false,
      day: cur.day,
      startedAt: cur.startedAt,
      asOf: new Date().toISOString(),
      source: cur.source,
      kiteFunds: cur.kiteFunds,
      kiteError: cur.kiteError,
    });
    this.session.set(snap);
    persist(snap);
  }

  private loop(): void {
    this.clearTimer();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const cur = this.session();
      const snap = {
        ...cur,
        running: false,
        kiteError: 'Connect Kite on Token first. Paper only — no order is placed.',
      };
      this.clearTimer();
      this.session.set(snap);
      persist(snap);
      return;
    }
    this.ticking = true;
    this.busy.set(true);
    try {
      const day = istDay();
      const nowMin = istMinutes();
      const cur = this.session().day === day ? this.session() : emptySession(day, new Date().toISOString());
      const [margins, csv] = await Promise.all([
        firstValueFrom(this.kiteApi.getUserMargins(auth)).catch(() => null),
        firstValueFrom(this.kiteApi.getInstrumentsCsv(auth)).catch(() => ''),
      ]);
      const funds = margins ? parseFunds(margins) : cur.kiteFunds;
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
      const from = shiftDay(day, -8);
      const books = [];
      for (const cfg of LIVE_PAPER_BOOKS) {
        const inst =
          cfg.id === 'crude' ? crude : cfg.id === 'nifty' ? nifty : cfg.id === 'bank' ? bank : sensex;
        const prev = cur.books.find((b) => b.id === cfg.id) || emptySession(day).books.find((b) => b.id === cfg.id)!;
        let bars: LiveAssumeBar[] = [];
        if (inst?.token) {
          const hist = (await firstValueFrom(
            this.kiteApi.getHistoricalData({
              instrumentToken: String(inst.token),
              interval: '5minute',
              from,
              to: day,
              authorization: auth,
            }),
          )) as { data?: { candles?: unknown[][] } };
          bars = (hist?.data?.candles || []).map(kiteBar).filter((b) => b.day);
        }
        const last = lastPrice(quotes, cfg.id, inst?.tradingSymbol || '');
        books.push(tickBook(prev, cfg, bars, last, day, nowMin, inst?.tradingSymbol || cfg.label));
      }
      const snap = summarizePaper(books, {
        running: true,
        day,
        startedAt: cur.startedAt || new Date().toISOString(),
        asOf: new Date().toISOString(),
        source: 'kite',
        kiteFunds: funds,
        kiteError: null,
      });
      this.session.set(snap);
      persist(snap);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kite fetch failed';
      const cur = this.session();
      const snap = { ...cur, kiteError: message, source: cur.source || 'kite' };
      this.session.set(snap);
      persist(snap);
    } finally {
      this.ticking = false;
      this.busy.set(false);
    }
  }
}

function persist(snap: LivePaperSession): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore quota */
  }
}

function readStored(): LivePaperSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LivePaperSession;
    if (!parsed || !Array.isArray(parsed.books)) return null;
    return { ...parsed, liveOrders: false, guaranteed: false, armedOnCrudeBest: false, assumed: true };
  } catch {
    return null;
  }
}

function parseFunds(payload: unknown): LivePaperSession['kiteFunds'] {
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
  const today = istDay();
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

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + delta);
  return istDay(d);
}
