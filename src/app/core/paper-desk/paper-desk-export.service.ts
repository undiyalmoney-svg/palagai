import { Injectable } from '@angular/core';
import { PaperDeskSnapshot } from './paper-desk.models';
import { emptyPaperDeskDayStats } from './paper-desk-day-stats';
import { extractTradeDate, formatDayOfWeek } from '../utils/trade-date.util';

export interface PaperDeskPdfOptions {
  title: string;
  /** Shown in subtitle (e.g. Nifty/Bank or Crude). */
  subtitle?: string;
}

@Injectable({ providedIn: 'root' })
export class PaperDeskExportService {
  /** Opens a printable HTML report (Save as PDF from the browser dialog). */
  exportPdf(snapshot: PaperDeskSnapshot, options: PaperDeskPdfOptions): void {
    const html = this.buildPrintHtml(snapshot, options);
    const win = window.open('', '_blank');
    if (!win) {
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  private buildPrintHtml(snapshot: PaperDeskSnapshot, options: PaperDeskPdfOptions): string {
    const dayStats = snapshot.dayStats ?? emptyPaperDeskDayStats();
    const t = snapshot.totals;
    const fmtRs = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('en-IN')}`;
    const fmtPts = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

    const best = dayStats.bestDay
      ? `${dayStats.bestDay.displayDate} · ${fmtRs(dayStats.bestDay.optionNetRs)} · ${fmtPts(dayStats.bestDay.indexNetPts)} pts · ${dayStats.bestDay.trades} trade(s)`
      : '—';
    const worst = dayStats.worstDay
      ? `${dayStats.worstDay.displayDate} · ${fmtRs(dayStats.worstDay.optionNetRs)} · ${fmtPts(dayStats.worstDay.indexNetPts)} pts · ${dayStats.worstDay.trades} trade(s)`
      : '—';

    const topProfitRows = dayStats.topProfitDays
      .map(
        (d) =>
          `<tr><td>${esc(d.displayDate)}</td><td>${esc(d.weekday)}</td><td>${d.trades}</td><td>${fmtRs(d.optionNetRs)}</td><td>${fmtPts(d.indexNetPts)}</td></tr>`,
      )
      .join('');
    const topLossRows = dayStats.topLossDays
      .map(
        (d) =>
          `<tr><td>${esc(d.displayDate)}</td><td>${esc(d.weekday)}</td><td>${d.trades}</td><td>${fmtRs(d.optionNetRs)}</td><td>${fmtPts(d.indexNetPts)}</td></tr>`,
      )
      .join('');
    const weekdayRows = dayStats.byWeekday
      .map(
        (w) =>
          `<tr><td>${esc(w.weekday)}</td><td>${w.trades}</td><td>${w.wins}/${w.losses}</td><td>${fmtRs(w.optionNetRs)}</td><td>${fmtPts(w.indexNetPts)}</td></tr>`,
      )
      .join('');

    const tradeRows = snapshot.trades
      .slice(0, 500)
      .map((tr) => {
        const day = extractTradeDate(tr.entryTime);
        return `<tr>
          <td>${esc(formatDayOfWeek(day))}</td>
          <td>${esc(tr.entryTime.replace('T', ' ').slice(0, 16))}</td>
          <td>${esc(tr.instrumentName)}</td>
          <td>${tr.direction}</td>
          <td>${esc(tr.option?.tradingSymbol ?? '—')}</td>
          <td>${tr.optionPnlRs != null ? fmtRs(tr.optionPnlRs) : '—'}</td>
          <td>${fmtPts(tr.indexPoints)}</td>
          <td>${esc(tr.exitReason)}</td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><title>${esc(options.title)}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 28px; color: #1a1a1a; }
        h1 { font-size: 22px; margin: 0 0 6px; }
        h2 { font-size: 15px; margin: 22px 0 8px; }
        p.meta { color: #555; margin: 0 0 16px; font-size: 13px; }
        .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 18px; }
        .card { border: 1px solid #ccc; padding: 10px 12px; min-width: 120px; }
        .card span { display: block; font-size: 11px; color: #666; }
        .card strong { font-size: 16px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
        th, td { border: 1px solid #ccc; padding: 5px 7px; font-size: 11px; text-align: left; }
        th { background: #f3f3f3; }
        .up { color: #0a7a3e; }
        .down { color: #b42318; }
        @media print { body { padding: 12px; } }
      </style></head><body>
      <h1>${esc(options.title)}</h1>
      <p class="meta">${esc(options.subtitle ?? '')}${options.subtitle ? ' · ' : ''}${esc(snapshot.fromDate)} → ${esc(snapshot.toDate)} · ${t.lotsUsed} lot(s) · ${dayStats.tradingDays} trading day(s)</p>

      <div class="cards">
        <div class="card"><span>Trades</span><strong>${t.trades}</strong></div>
        <div class="card"><span>W / L</span><strong>${t.wins} / ${t.losses}</strong></div>
        <div class="card"><span>Option ₹</span><strong class="${t.optionNetRs >= 0 ? 'up' : 'down'}">${fmtRs(t.optionNetRs)}</strong></div>
        <div class="card"><span>Index / futures pts</span><strong class="${t.indexNetPts >= 0 ? 'up' : 'down'}">${fmtPts(t.indexNetPts)}</strong></div>
        <div class="card"><span>Pts money ₹</span><strong class="${t.pointsMoneyRs >= 0 ? 'up' : 'down'}">${fmtRs(t.pointsMoneyRs)}</strong></div>
        ${t.avgDailyResearchRs != null || t.avgDailyProfitRs != null ? `<div class="card"><span>Avg ₹/session</span><strong class="${(t.avgDailyResearchRs ?? t.avgDailyProfitRs ?? 0) >= 0 ? 'up' : 'down'}">${fmtRs(t.avgDailyResearchRs ?? t.avgDailyProfitRs ?? 0)}</strong></div>` : ''}
      </div>

      <h2>Most profitable day</h2>
      <p>${esc(best)}</p>
      <h2>Most loss day</h2>
      <p>${esc(worst)}</p>

      <h2>Top profitable days</h2>
      <table><thead><tr><th>Date</th><th>Day</th><th>Trades</th><th>Option ₹</th><th>Pts</th></tr></thead>
      <tbody>${topProfitRows || '<tr><td colspan="5">None</td></tr>'}</tbody></table>

      <h2>Most loss days</h2>
      <table><thead><tr><th>Date</th><th>Day</th><th>Trades</th><th>Option ₹</th><th>Pts</th></tr></thead>
      <tbody>${topLossRows || '<tr><td colspan="5">None</td></tr>'}</tbody></table>

      <h2>By weekday</h2>
      <table><thead><tr><th>Day</th><th>Trades</th><th>W/L</th><th>Option ₹</th><th>Pts</th></tr></thead>
      <tbody>${weekdayRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>

      <h2>Trades${snapshot.trades.length > 500 ? ' (first 500)' : ''}</h2>
      <table><thead><tr><th>Day</th><th>Entry</th><th>Instrument</th><th>Dir</th><th>Option</th><th>Option ₹</th><th>Pts</th><th>Exit</th></tr></thead>
      <tbody>${tradeRows || '<tr><td colspan="8">No trades</td></tr>'}</tbody></table>
      </body></html>`;
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
