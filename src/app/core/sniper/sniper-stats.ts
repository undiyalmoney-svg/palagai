import { allSniperFills } from './sniper-engine';
import { SNIPER_CAPITAL_RS, SniperFill, SniperSession, SniperUnder } from './sniper.models';
import { hhmm } from './sniper-clock';

export type SniperBookStats = {
  under: SniperUnder;
  label: string;
  startRs: number;
  capital: number;
  grossProfit: number;
  grossLoss: number;
  totalCharges: number;
  netRs: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxWin: number;
  maxLoss: number;
  highCapital: number;
  lowCapital: number;
  maxDrawdown: number;
  maxCumProfit: number;
  maxCumLoss: number;
  streakWin: number;
  streakLoss: number;
  bestSlot: string;
  worstSlot: string;
  avgWin: number;
  avgLoss: number;
  avgCharges: number;
  skipped: number;
  brokerage: number;
  stt: number;
  exchange: number;
  gst: number;
  stamp: number;
  sebi: number;
};

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function streaks(fills: SniperFill[]): { win: number; loss: number } {
  let w = 0;
  let l = 0;
  let cw = 0;
  let cl = 0;
  for (const f of fills) {
    if (f.netRs > 0) {
      cw += 1;
      cl = 0;
      w = Math.max(w, cw);
    } else if (f.netRs < 0) {
      cl += 1;
      cw = 0;
      l = Math.max(l, cl);
    } else {
      cw = 0;
      cl = 0;
    }
  }
  return { win: w, loss: l };
}

function drawdown(fills: SniperFill[], start: number, live: number): number {
  let peak = start;
  let dd = 0;
  let cap = start;
  for (const f of fills) {
    cap = f.capitalAfter;
    peak = Math.max(peak, cap);
    dd = Math.min(dd, cap - peak);
  }
  peak = Math.max(peak, live);
  dd = Math.min(dd, live - peak);
  return r1(dd);
}

export function statsOfBook(session: SniperSession, under: SniperUnder): SniperBookStats {
  const book = session.books.find((b) => b.id === under);
  const fills = book?.fills || [];
  const wins = fills.filter((f) => f.netRs > 0);
  const losses = fills.filter((f) => f.netRs < 0);
  const grossProfit = r1(wins.reduce((s, f) => s + f.grossRs, 0));
  const grossLoss = r1(losses.reduce((s, f) => s + f.grossRs, 0));
  const totalCharges = r1(fills.reduce((s, f) => s + f.charges.total, 0));
  const netRs = r1(fills.reduce((s, f) => s + f.netRs, 0));
  const maxWin = fills.length ? Math.max(0, ...fills.map((f) => f.netRs)) : 0;
  const maxLoss = fills.length ? Math.min(0, ...fills.map((f) => f.netRs)) : 0;
  const best = fills.reduce<SniperFill | null>((a, f) => (!a || f.netRs > a.netRs ? f : a), null);
  const worst = fills.reduce<SniperFill | null>((a, f) => (!a || f.netRs < a.netRs ? f : a), null);
  const st = streaks(fills);
  const start = SNIPER_CAPITAL_RS;
  const live = book?.capital ?? start;
  const high = book?.peakCapital ?? start;
  const low = book?.troughCapital ?? start;
  return {
    under,
    label: book?.label || under,
    startRs: start,
    capital: live,
    grossProfit,
    grossLoss,
    totalCharges,
    netRs,
    trades: fills.length,
    wins: wins.length,
    losses: losses.length,
    winRate: fills.length ? r1((100 * wins.length) / fills.length) : 0,
    maxWin,
    maxLoss,
    highCapital: high,
    lowCapital: low,
    maxDrawdown: drawdown(fills, start, live),
    maxCumProfit: r1(high - start),
    maxCumLoss: r1(low - start),
    streakWin: st.win,
    streakLoss: st.loss,
    bestSlot: best ? hhmm(best.entryMin) : '—',
    worstSlot: worst ? hhmm(worst.entryMin) : '—',
    avgWin: wins.length ? r1(wins.reduce((s, f) => s + f.netRs, 0) / wins.length) : 0,
    avgLoss: losses.length ? r1(losses.reduce((s, f) => s + f.netRs, 0) / losses.length) : 0,
    avgCharges: fills.length ? r1(totalCharges / fills.length) : 0,
    skipped: book?.skips.length || 0,
    brokerage: r1(fills.reduce((s, f) => s + f.charges.brokerage, 0)),
    stt: r1(fills.reduce((s, f) => s + f.charges.stt, 0)),
    exchange: r1(fills.reduce((s, f) => s + f.charges.exchange, 0)),
    gst: r1(fills.reduce((s, f) => s + f.charges.gst, 0)),
    stamp: r1(fills.reduce((s, f) => s + f.charges.stamp, 0)),
    sebi: r1(fills.reduce((s, f) => s + f.charges.sebi, 0)),
  };
}

export function statsAll(session: SniperSession): SniperBookStats[] {
  return session.books.map((b) => statsOfBook(session, b.id));
}

export function deskTotals(session: SniperSession): SniperBookStats {
  const rows = statsAll(session);
  const start = SNIPER_CAPITAL_RS * rows.length;
  const capital = r1(rows.reduce((s, r) => s + r.capital, 0));
  const trades = rows.reduce((s, r) => s + r.trades, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const fills = allSniperFills(session);
  const st = streaks(fills);
  return {
    under: 'nifty',
    label: 'All four',
    startRs: start,
    capital,
    grossProfit: r1(rows.reduce((s, r) => s + r.grossProfit, 0)),
    grossLoss: r1(rows.reduce((s, r) => s + r.grossLoss, 0)),
    totalCharges: r1(rows.reduce((s, r) => s + r.totalCharges, 0)),
    netRs: r1(rows.reduce((s, r) => s + r.netRs, 0)),
    trades,
    wins,
    losses: rows.reduce((s, r) => s + r.losses, 0),
    winRate: trades ? r1((100 * wins) / trades) : 0,
    maxWin: rows.length ? Math.max(0, ...rows.map((r) => r.maxWin)) : 0,
    maxLoss: rows.length ? Math.min(0, ...rows.map((r) => r.maxLoss)) : 0,
    highCapital: r1(rows.reduce((s, r) => s + r.highCapital, 0)),
    lowCapital: r1(rows.reduce((s, r) => s + r.lowCapital, 0)),
    maxDrawdown: r1(rows.reduce((s, r) => s + r.maxDrawdown, 0)),
    maxCumProfit: r1(capital > start ? capital - start : Math.max(0, ...rows.map((r) => r.maxCumProfit))),
    maxCumLoss: r1(Math.min(0, ...rows.map((r) => r.maxCumLoss))),
    streakWin: st.win,
    streakLoss: st.loss,
    bestSlot: rows.find((r) => r.maxWin > 0)?.bestSlot || '—',
    worstSlot: rows.find((r) => r.maxLoss < 0)?.worstSlot || '—',
    avgWin: r1(rows.reduce((s, r) => s + r.avgWin * r.wins, 0) / Math.max(1, wins)),
    avgLoss: r1(rows.reduce((s, r) => s + r.avgLoss * r.losses, 0) / Math.max(1, rows.reduce((s, r) => s + r.losses, 0))),
    avgCharges: trades ? r1(rows.reduce((s, r) => s + r.totalCharges, 0) / trades) : 0,
    skipped: rows.reduce((s, r) => s + r.skipped, 0),
    brokerage: r1(rows.reduce((s, r) => s + r.brokerage, 0)),
    stt: r1(rows.reduce((s, r) => s + r.stt, 0)),
    exchange: r1(rows.reduce((s, r) => s + r.exchange, 0)),
    gst: r1(rows.reduce((s, r) => s + r.gst, 0)),
    stamp: r1(rows.reduce((s, r) => s + r.stamp, 0)),
    sebi: r1(rows.reduce((s, r) => s + r.sebi, 0)),
  };
}

export function sessionReport(session: SniperSession): string {
  const d = deskTotals(session);
  return [
    `5-Minute Sniper ${session.day} · ${session.mode}`,
    `Start ₹${d.startRs.toLocaleString('en-IN')} · Close ₹${d.capital.toLocaleString('en-IN')} · Net ₹${d.netRs}`,
    `Gross +₹${d.grossProfit} / ₹${d.grossLoss} · Charges ₹${d.totalCharges} (brokerage ₹${d.brokerage} · STT ₹${d.stt} · exch ₹${d.exchange} · GST ₹${d.gst})`,
    `Trades ${d.trades} · ${d.wins}W / ${d.losses}L · win ${d.winRate}% · skipped ${d.skipped}`,
    `Max win ₹${d.maxWin} · max loss ₹${d.maxLoss} · drawdown ₹${d.maxDrawdown}`,
    session.incomplete ? 'Replay/live marked incomplete where option quotes were missing. Not fabricated.' : '',
    'Net is after Kite charges. Not a guaranteed profit.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function equityPoints(fills: SniperFill[], start = SNIPER_CAPITAL_RS): { t: string; y: number }[] {
  const pts = [{ t: 'start', y: start }];
  for (const f of fills) pts.push({ t: hhmm(f.exitMin || f.entryMin), y: f.capitalAfter });
  return pts;
}
