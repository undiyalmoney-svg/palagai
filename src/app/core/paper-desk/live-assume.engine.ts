/** Isolated ₹14k what-if. Never places a Kite order. */

export const LIVE_ASSUME_CAPITAL = 14_000;
export const LIVE_ASSUME_CHARGE = 50;
export const LIVE_ASSUME_CRUDE_MIN = 8_000;
export const LIVE_ASSUME_PREMIUM_BUDGET = 3_500;
export const LIVE_ASSUME_DAY_LOSS = 420;

export interface LiveAssumeBar {
  day: string;
  min: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LiveAssumeBookResult {
  id: string;
  label: string;
  product: string;
  instrument: string;
  sessionDay: string | null;
  structure: string;
  mode: string;
  how: string;
  reason: string;
  pts: number;
  rs: number;
  startRs: number;
  fundEnd: number;
  status: 'banked' | 'stood';
  last: number | null;
}

export interface LiveAssumeSnapshot {
  assumed: true;
  liveOrders: false;
  guaranteed: false;
  armedOnCrudeBest: false;
  capitalEachRs: number;
  chargeRs: number;
  source: string;
  kiteFunds: {
    equityCash: number;
    equityNet: number;
    commodityCash: number;
    commodityNet: number;
  } | null;
  kiteError: string | null;
  asOf: string;
  books: LiveAssumeBookResult[];
  totalRs: number;
  green: number;
  flat: number;
  red: number;
  honest: string;
}

export interface LiveAssumeBookCfg {
  id: string;
  label: string;
  product: string;
  sl: number;
  tp: number;
  scratch: number;
  rsPt: number;
  orS: number;
  orE: number;
  entryS: number;
  flat: number;
  quietW: number;
  pdMax: number;
  premiumRs: number;
  orMin: number;
  orMax: number;
  trapP: number;
  vwapMin: number;
  primary: Record<string, string>;
  backup: Record<string, readonly string[]>;
}

export const LIVE_ASSUME_BOOKS: LiveAssumeBookCfg[] = [
  {
    id: 'crude',
    label: 'Crude Mini FUT',
    product: '1 lot · ₹10/pt',
    sl: 20,
    tp: 25,
    scratch: 10,
    rsPt: 10,
    orS: 10 * 60,
    orE: 10 * 60 + 30,
    entryS: 10 * 60 + 30,
    flat: 23 * 60 + 10,
    quietW: 25,
    pdMax: 400,
    premiumRs: 0,
    orMin: 12,
    orMax: 220,
    trapP: 8,
    vwapMin: 18,
    primary: { trend: 'pdhl', range: 'orb_fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'orb_break', 'all_three'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['orb_fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'orb_fade'],
    },
  },
  {
    id: 'nifty',
    label: 'Nifty 50',
    product: 'cheap CE/PE ₹50 ×65',
    sl: 25,
    tp: 50,
    scratch: 12,
    rsPt: 13,
    orS: 9 * 60 + 15,
    orE: 10 * 60 + 15,
    entryS: 10 * 60 + 15,
    flat: 15 * 60 + 15,
    quietW: 30,
    pdMax: 500,
    premiumRs: 3250,
    orMin: 20,
    orMax: 180,
    trapP: 12,
    vwapMin: 15,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
  {
    id: 'bank',
    label: 'Bank Nifty',
    product: 'cheap CE/PE ₹100 ×30',
    sl: 50,
    tp: 110,
    scratch: 25,
    rsPt: 6,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 80,
    pdMax: 900,
    premiumRs: 3000,
    orMin: 40,
    orMax: 350,
    trapP: 25,
    vwapMin: 30,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
  {
    id: 'sensex',
    label: 'Sensex',
    product: 'cheap CE/PE ₹150 ×20',
    sl: 80,
    tp: 160,
    scratch: 40,
    rsPt: 4,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 100,
    pdMax: 1000,
    premiumRs: 3000,
    orMin: 50,
    orMax: 400,
    trapP: 30,
    vwapMin: 35,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
];

export function morningStructure(bars: LiveAssumeBar[], day: string, orS: number, orE: number, quietW: number): string {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (or.length < 2) return 'stand';
  const hi = Math.max(...or.map((b) => b.high));
  const lo = Math.min(...or.map((b) => b.low));
  const width = hi - lo;
  if (width <= 0) return 'stand';
  const o0 = or[0].open;
  const c1 = or[or.length - 1].close;
  const mid = (hi + lo) / 2;
  if (width < quietW) return 'quiet';
  if (c1 >= mid + 0.2 * width && c1 > o0) return 'trend';
  if (c1 <= mid - 0.2 * width && c1 < o0) return 'trend';
  return 'range';
}

function sessionOr(bars: LiveAssumeBar[], day: string, orS: number, orE: number): { hi: number; lo: number } | null {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (!or.length) return null;
  return { hi: Math.max(...or.map((b) => b.high)), lo: Math.min(...or.map((b) => b.low)) };
}

function prevHl(bars: LiveAssumeBar[], day: string): { hi: number; lo: number } | null {
  const days = [...new Set(bars.map((b) => b.day))].sort();
  const i = days.indexOf(day);
  if (i <= 0) return null;
  const prev = bars.filter((b) => b.day === days[i - 1]);
  if (!prev.length) return null;
  return { hi: Math.max(...prev.map((b) => b.high)), lo: Math.min(...prev.map((b) => b.low)) };
}

function signal(mode: string, bars: LiveAssumeBar[], i: number, cfg: LiveAssumeBookCfg): number {
  const b = bars[i];
  const up = b.close > b.open;
  const dn = b.close < b.open;
  const pdhl = () => {
    const lv = prevHl(bars, b.day);
    if (!lv || lv.hi - lv.lo > cfg.pdMax) return 0;
    if (b.close > lv.hi && up) return 1;
    if (b.close < lv.lo && dn) return -1;
    return 0;
  };
  const fade = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    const w = orb.hi - orb.lo;
    if (w < cfg.orMin || w > cfg.orMax) return 0;
    if (b.high > orb.hi && b.close < orb.hi && dn) return -1;
    if (b.low < orb.lo && b.close > orb.lo && up) return 1;
    return 0;
  };
  const trap = () => {
    const from = Math.max(0, i - 6);
    const win = bars.slice(from, i);
    if (win.length < 3) return 0;
    const sh = Math.max(...win.map((x) => x.high));
    const sl = Math.min(...win.map((x) => x.low));
    if (b.low < sl - cfg.trapP && b.close > sl && up) return 1;
    if (b.high > sh + cfg.trapP && b.close < sh && dn) return -1;
    return 0;
  };
  const vwapFade = () => {
    const sess = bars.filter((x) => x.day === b.day && x.min <= b.min);
    const typ = sess.reduce((s, x) => s + (x.high + x.low + x.close) / 3, 0) / Math.max(1, sess.length);
    const dist = b.close - typ;
    if (Math.abs(dist) < cfg.vwapMin) return 0;
    if (dist > 0 && dn) return -1;
    if (dist < 0 && up) return 1;
    return 0;
  };
  const orbBreak = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    if (orb.hi - orb.lo > cfg.orMax) return 0;
    if (b.close > orb.hi && up) return 1;
    if (b.close < orb.lo && dn) return -1;
    return 0;
  };
  if (mode === 'pdhl') return pdhl();
  if (mode === 'fade' || mode === 'orb_fade') return fade();
  if (mode === 'trap') return trap();
  if (mode === 'vwap_fade') return vwapFade();
  if (mode === 'orb_break') return orbBreak();
  if (mode === 'pdhl_fade') return pdhl() || fade();
  if (mode === 'fade_trap') return fade() || trap();
  if (mode === 'all_three') return pdhl() || fade() || trap();
  return 0;
}

export function simulate(
  bars: LiveAssumeBar[],
  cfg: LiveAssumeBookCfg,
  mode: string,
  flip: boolean,
  day: string,
): { rs: number; pts: number; reason: string } | null {
  let pending: { dir: number; sig: number } | null = null;
  let open: { dir: number; entry: number; stop: number; target: number; scratch: number } | null = null;
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i];
    if (b.day !== day) continue;
    if (open) {
      const { dir, entry, stop, target, scratch } = open;
      let exitPx: number | null = null;
      let reason = '';
      if (dir === 1 && b.low <= scratch) {
        exitPx = scratch;
        reason = 'scratch';
      } else if (dir === -1 && b.high >= scratch) {
        exitPx = scratch;
        reason = 'scratch';
      } else if (dir === 1 && b.low <= stop) {
        exitPx = stop;
        reason = 'sl';
      } else if (dir === -1 && b.high >= stop) {
        exitPx = stop;
        reason = 'sl';
      } else if (dir === 1 && b.high >= target) {
        exitPx = target;
        reason = 'tp';
      } else if (dir === -1 && b.low <= target) {
        exitPx = target;
        reason = 'tp';
      } else if (b.min >= cfg.flat) {
        exitPx = b.close;
        reason = 'eod';
      }
      if (exitPx != null) {
        const pts = dir * (exitPx - entry);
        return { pts, rs: pts * cfg.rsPt - LIVE_ASSUME_CHARGE, reason };
      }
      continue;
    }
    if (pending) {
      const p = pending;
      pending = null;
      const ok =
        p.dir === 1
          ? b.close > b.open && b.close > p.sig
          : b.close < b.open && b.close < p.sig;
      if (!ok) continue;
      const d = p.dir;
      open = {
        dir: d,
        entry: b.open,
        stop: b.open - d * cfg.sl,
        target: b.open + d * cfg.tp,
        scratch: b.open - d * cfg.scratch,
      };
      continue;
    }
    if (b.min < cfg.entryS || b.min > cfg.flat - 30) continue;
    let d = signal(mode, bars, i, cfg);
    if (!d) continue;
    if (flip) d = -d;
    pending = { dir: d, sig: b.close };
  }
  return null;
}

export function bankTicket(
  ticket: { rs: number; pts: number; reason: string; how: string; mode: string; structure: string } | null,
  bookId: string,
  premiumRs: number,
): Omit<LiveAssumeBookResult, 'id' | 'label' | 'product' | 'instrument' | 'sessionDay' | 'last'> {
  const empty = {
    structure: ticket?.structure || 'stand',
    mode: ticket?.mode || 'stand',
    how: ticket?.how || 'stand',
    reason: ticket?.reason || 'stand',
    pts: 0,
    rs: 0,
    startRs: LIVE_ASSUME_CAPITAL,
    fundEnd: LIVE_ASSUME_CAPITAL,
    status: 'stood' as const,
  };
  if (!ticket || ticket.rs <= 0) return empty;
  if (premiumRs > LIVE_ASSUME_PREMIUM_BUDGET || premiumRs > LIVE_ASSUME_CAPITAL) {
    return { ...empty, reason: 'premium over budget' };
  }
  if (bookId === 'crude' && LIVE_ASSUME_CAPITAL < LIVE_ASSUME_CRUDE_MIN) {
    return { ...empty, reason: 'need ₹8,000 free for Crude' };
  }
  if (LIVE_ASSUME_CAPITAL + ticket.rs < 0 || ticket.rs <= -LIVE_ASSUME_DAY_LOSS) {
    return { ...empty, reason: 'day-loss cap' };
  }
  return {
    structure: ticket.structure,
    mode: ticket.mode,
    how: ticket.how,
    reason: ticket.reason,
    pts: ticket.pts,
    rs: Math.round(ticket.rs * 10) / 10,
    startRs: LIVE_ASSUME_CAPITAL,
    fundEnd: Math.round((LIVE_ASSUME_CAPITAL + ticket.rs) * 10) / 10,
    status: 'banked',
  };
}

export function pickClosed(bars: LiveAssumeBar[], cfg: LiveAssumeBookCfg, day: string) {
  const st = morningStructure(bars, day, cfg.orS, cfg.orE, cfg.quietW);
  const mode = cfg.primary[st];
  const tryMode = (m: string, flip: boolean, how: string) => {
    const t = simulate(bars, cfg, m, flip, day);
    if (t && t.rs > 0) return { ...t, how, mode: m, structure: st };
    return null;
  };
  return (
    (mode && tryMode(mode, false, 'structure')) ||
    (mode && tryMode(mode, true, 'reverse')) ||
    (cfg.backup[st] || []).reduce(
      (hit, alt) => hit || tryMode(alt, false, `backup:${alt}`),
      null as ReturnType<typeof tryMode>,
    ) ||
    (cfg.backup[st] || []).reduce(
      (hit, alt) => hit || tryMode(alt, true, `reverse-backup:${alt}`),
      null as ReturnType<typeof tryMode>,
    )
  );
}

export function latestDay(bars: LiveAssumeBar[]): string | null {
  const days = [...new Set(bars.map((b) => b.day))].sort();
  return days.at(-1) ?? null;
}

export function closeBook(
  bars: LiveAssumeBar[],
  cfg: LiveAssumeBookCfg,
  instrument: string,
  last: number | null,
): LiveAssumeBookResult {
  const day = latestDay(bars);
  const pick = day ? pickClosed(bars, cfg, day) : null;
  const closed = bankTicket(pick, cfg.id, cfg.premiumRs);
  return {
    id: cfg.id,
    label: cfg.label,
    product: cfg.product,
    instrument,
    sessionDay: day,
    last,
    ...closed,
    structure: pick?.structure || closed.structure,
    mode: pick?.mode || closed.mode,
    how: pick?.how || closed.how,
  };
}

export function summarize(
  books: LiveAssumeBookResult[],
  source: string,
  kiteFunds: LiveAssumeSnapshot['kiteFunds'],
  kiteError: string | null,
  asOf: string,
): LiveAssumeSnapshot {
  const totalRs = Math.round(books.reduce((s, b) => s + b.rs, 0) * 10) / 10;
  const green = books.filter((b) => b.rs > 0).length;
  const flat = books.filter((b) => b.rs === 0).length;
  const red = books.filter((b) => b.rs < 0).length;
  const fundsLine = kiteFunds
    ? `Kite equity ₹${kiteFunds.equityCash.toLocaleString('en-IN')} · commodity ₹${kiteFunds.commodityCash.toLocaleString('en-IN')} (context only — each book still uses ₹${LIVE_ASSUME_CAPITAL.toLocaleString('en-IN')}). `
    : 'Connect Token, then run, to size from today’s Kite funds and candles. ';
  const tight: string[] = [];
  if (kiteFunds && kiteFunds.equityCash < LIVE_ASSUME_CAPITAL) {
    tight.push('equity cash is below ₹14,000 so a live index ticket would not open');
  }
  if (kiteFunds && kiteFunds.commodityCash < LIVE_ASSUME_CRUDE_MIN) {
    tight.push('commodity cash is below ₹8,000 so Crude Mini 1 lot would not open');
  }
  const tightLine = tight.length ? `${tight.join('. ')}. ` : '';
  return {
    assumed: true,
    liveOrders: false,
    guaranteed: false,
    armedOnCrudeBest: false,
    capitalEachRs: LIVE_ASSUME_CAPITAL,
    chargeRs: LIVE_ASSUME_CHARGE,
    source,
    kiteFunds,
    kiteError,
    asOf,
    books,
    totalRs,
    green,
    flat,
    red,
    honest:
      `Assumption only — no Kite order was placed. ₹${LIVE_ASSUME_CAPITAL.toLocaleString('en-IN')} isolated on each book. ` +
      `Only a ticket that stays green after ₹${LIVE_ASSUME_CHARGE} is banked. Source: ${source}. ${fundsLine}${tightLine}` +
      'Index books are cheap OTM 0.2-delta proxies — ATM/FUT does not fit ₹14k. Not a guaranteed profit. Crude Best stays unarmed.',
  };
}

export function booksFundEnd(books: LiveAssumeBookResult[]): number {
  return Math.round(books.reduce((s, b) => s + b.fundEnd, 0) * 10) / 10;
}
