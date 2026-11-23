import { allSniperFills } from './sniper-engine';
import { SniperFill, SniperSession, SniperUnder } from './sniper.models';
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
};

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function statsOfBook(session: SniperSession, under: SniperUnder): SniperBookStats {
  const book = session.books.find((b) => b.id === under);
  const fills = book?.fills || [];
  const wins = fills.filter((f) => f.netRs > 0);
  const losses = fills.filter((f) => f.netRs < 0);
  const netRs = r1(fills.reduce((s, f) => s + f.netRs, 0));
  return {
    under,
    label: book?.label || under,
    startRs: 0,
    capital: book?.capital ?? netRs,
    grossProfit: r1(wins.reduce((s, f) => s + f.grossRs, 0)),
    grossLoss: r1(losses.reduce((s, f) => s + f.grossRs, 0)),
    totalCharges: r1(fills.reduce((s, f) => s + f.charges.total, 0)),
    netRs,
    trades: fills.length,
    wins: wins.length,
    losses: losses.length,
    winRate: fills.length ? r1((100 * wins.length) / fills.length) : 0,
    maxWin: fills.length ? Math.max(0, ...fills.map((f) => f.netRs)) : 0,
    maxLoss: fills.length ? Math.min(0, ...fills.map((f) => f.netRs)) : 0,
  };
}

export function statsAll(session: SniperSession): SniperBookStats[] {
  return session.books.map((b) => statsOfBook(session, b.id));
}

export function deskTotals(session: SniperSession): SniperBookStats {
  const rows = statsAll(session);
  const fills = allSniperFills(session);
  const wins = fills.filter((f) => f.netRs > 0);
  const losses = fills.filter((f) => f.netRs < 0);
  const netRs = r1(fills.reduce((s, f) => s + f.netRs, 0));
  return {
    under: 'nifty',
    label: 'Sniper',
    startRs: 0,
    capital: netRs,
    grossProfit: r1(wins.reduce((s, f) => s + f.grossRs, 0)),
    grossLoss: r1(losses.reduce((s, f) => s + f.grossRs, 0)),
    totalCharges: r1(fills.reduce((s, f) => s + f.charges.total, 0)),
    netRs,
    trades: fills.length,
    wins: wins.length,
    losses: losses.length,
    winRate: fills.length ? r1((100 * wins.length) / fills.length) : 0,
    maxWin: fills.length ? Math.max(0, ...fills.map((f) => f.netRs)) : 0,
    maxLoss: fills.length ? Math.min(0, ...fills.map((f) => f.netRs)) : 0,
  };
}

export function sessionReport(session: SniperSession): string {
  const d = deskTotals(session);
  const who = session.books.find((b) => b.id === session.selected);
  return [
    `Sniper ${session.day}`,
    who ? `${who.label} ${who.cut || who.breakDir}` : 'no cut',
    `Net ₹${d.netRs} · trades ${d.trades} · SL ₹${session.stopRs} · lots ${session.lots}`,
  ].join('\n');
}

export function equityPoints(fills: SniperFill[], start = 0): { t: string; y: number }[] {
  const pts = [{ t: 'start', y: start }];
  for (const f of fills) pts.push({ t: hhmm(f.exitMin || f.entryMin), y: f.capitalAfter });
  return pts;
}
