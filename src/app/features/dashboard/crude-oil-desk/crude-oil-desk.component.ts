import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CrudePaperDeskService, CrudeDeskRunOptions } from '../../../core/paper-desk/crude-paper-desk.service';
import { PaperDeskExportService } from '../../../core/paper-desk/paper-desk-export.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import {
  PAPER_WEEKDAY_OPTIONS,
  PaperWeekdayKey,
  PaperWeekdaySelection,
  buildWeekdayFilteredView,
  defaultPaperWeekdaySelection,
} from '../../../core/paper-desk/paper-desk-weekday-filter';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { MCX_CRUDE_SESSION } from '../../../core/config/session.config';
import { CRUDE_RUPEES_PER_POINT } from '../../../core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import {
  CRUDE_STRATEGY_PROFILES,
  CrudeStrategyProfileId,
  resolveCrudeStrategyProfile,
} from '../../../core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { extractTradeDate, formatDayOfWeek, formatDisplayDate } from '../../../core/utils/trade-date.util';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';

@Component({
  selector: 'app-crude-oil-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './crude-oil-desk.component.html',
  styleUrl: './crude-oil-desk.component.css',
})
export class CrudeOilDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(CrudePaperDeskService);
  private readonly deskExport = inject(PaperDeskExportService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly uiDialog = inject(UiDialogService);

  protected readonly session = MCX_CRUDE_SESSION;
  protected readonly mode = signal<PaperDeskMode>('testing');
  protected fromDate = shiftDays(-14);
  protected toDate = todayIso();
  /** When Live + checked, places real Kite MCX MIS orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  protected lots = 1;
  /**
   * Default All-Green (09:00–23:00 Session OR; trade whenever desk runs).
   * Daily Profit / Champion / Trap Confirm / Daily Income selectable.
   */
  protected strategyProfile: CrudeStrategyProfileId = 'all-green';
  protected readonly strategyProfiles = [
    CRUDE_STRATEGY_PROFILES['all-green'],
    CRUDE_STRATEGY_PROFILES['daily-profit'],
    CRUDE_STRATEGY_PROFILES.champion,
    CRUDE_STRATEGY_PROFILES['trap-confirm'],
    CRUDE_STRATEGY_PROFILES['daily-income'],
  ];
  /** Morning ORB 10:00–12:00 (off for All-Green / Daily Profit). */
  protected enableMorning = false;
  /** Session / evening window (All-Green default on · 09:00–23:00). */
  protected enableEvening = true;
  /** Stricter day loss (pts depend on profile). */
  protected strictDayStop = false;

  /** Testing result filter: Mon–Fri. */
  protected readonly weekdayOptions = PAPER_WEEKDAY_OPTIONS;
  protected readonly weekdayOn = signal<PaperWeekdaySelection>(defaultPaperWeekdaySelection());

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  protected activeProfile() {
    return resolveCrudeStrategyProfile(this.strategyProfile);
  }

  protected readonly resultView = computed(() => {
    const snap = this.snapshot();
    if (this.mode() !== 'testing' || !snap.trades.length) {
      return {
        trades: snap.trades,
        totals: snap.totals,
        dayStats: snap.dayStats,
        weekdayLabel: 'all',
        filtered: false,
      };
    }
    const view = buildWeekdayFilteredView(
      snap.trades,
      this.weekdayOn(),
      snap.totals.lotsUsed || this.lots,
      CRUDE_RUPEES_PER_POINT,
    );
    return { ...view, filtered: true };
  });

  ngOnInit(): void {
    this.lots = this.lotsPreference.get();
  }

  protected onLotsChange(): void {
    const normalized = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = normalized;
    this.lotsPreference.set(normalized);
  }

  protected profileSlTpLabel(): string {
    const p = this.activeProfile();
    if (p.entryMode === 'trap-confirm') {
      return `Trap+confirm ${p.targetRMultiple}R · day −₹${p.dayLossStopPts * CRUDE_RUPEES_PER_POINT}`;
    }
    const conf = p.requireConfirm ? ' +confirm' : '';
    if (p.entryMode === 'session-or') {
      return `Session OR${conf} ${p.eveningEntryStart}–${p.eveningEntryEnd} · OR ${p.sessionOrStart}–${p.sessionOrEnd} · SL₹${p.stopPts * CRUDE_RUPEES_PER_POINT} · trail ₹${p.profitLockArmRs}→₹${p.profitLockLockRs}`;
    }
    if (p.profileId === 'daily-profit') {
      return `Evening PDHL${conf} ${p.eveningEntryStart}–${p.eveningEntryEnd} · SL${p.stopPts}/TP${p.eveningTargetPts}`;
    }
    return `Morning SL${p.stopPts}/TP${p.morningTargetPts} · Evening SL${p.stopPts}/TP${p.eveningTargetPts}${conf}`;
  }

  protected onStrategyProfileChange(): void {
    const p = this.activeProfile();
    this.enableMorning = p.defaultEnableMorning;
    this.enableEvening = p.defaultEnableEvening;
  }

  protected profileRiskTitle(): string {
    const p = this.activeProfile();
    const rs = CRUDE_RUPEES_PER_POINT;
    const lock =
      p.dayProfitLockPts > 0
        ? ` Day profit lock +₹${p.dayProfitLockPts * rs} (${p.dayProfitLockPts}pts × ₹${rs}).`
        : '';
    return `CRUDEOILM ₹${rs}/pt · 1 lot. Off: day stop −₹${p.dayLossStopPts * rs} (${p.dayLossStopPts}pts). On: stricter −₹${p.strictDayLossPts * rs} (${p.strictDayLossPts}pts).${lock}`;
  }

  protected strictDayStopLabel(): string {
    const p = this.activeProfile();
    const rs = CRUDE_RUPEES_PER_POINT;
    return `Strict day stop (−₹${p.strictDayLossPts * rs})`;
  }

  protected toggleWeekday(key: PaperWeekdayKey): void {
    this.weekdayOn.update((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  protected isWeekdayOn(key: PaperWeekdayKey): boolean {
    return this.weekdayOn()[key];
  }

  ngOnDestroy(): void {
    this.desk.stopLive();
  }

  protected setMode(mode: PaperDeskMode): void {
    if (this.busy()) {
      this.desk.cancelRun();
    } else if (this.snapshot().running) {
      this.desk.stopLive();
    }
    this.mode.set(mode);
    this.error.set('');
    if (mode === 'testing') {
      this.realOrders = false;
      this.realOrdersAck = false;
    }
  }

  private buildRunOptions(lots: number): CrudeDeskRunOptions {
    return {
      lots,
      strictDayStop: this.strictDayStop,
      enableMorning: this.enableMorning,
      enableEvening: this.enableEvening,
      strategyProfile: this.strategyProfile,
    };
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token and paste your access token, then try again.');
      return;
    }
    if (!this.enableMorning && !this.enableEvening) {
      this.error.set('Turn on Morning and/or Evening session.');
      return;
    }

    const lots = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = lots;
    this.lotsPreference.set(lots);
    const runOpts = this.buildRunOptions(lots);
    const profile = this.activeProfile();

    try {
      if (this.mode() === 'testing') {
        if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
          this.error.set('Pick a valid From → To date range.');
          return;
        }
        await this.desk.runTesting(this.fromDate, this.toDate, runOpts);
      } else {
        if (this.realOrders && !this.realOrdersAck) {
          this.error.set('Tick the confirmation box before starting Live money.');
          return;
        }
        if (this.realOrders) {
          const lockNote =
            profile.dayProfitLockPts > 0
              ? `\nDay profit lock +₹${profile.dayProfitLockPts * CRUDE_RUPEES_PER_POINT}.`
              : '';
          const risk = this.strictDayStop
            ? `\nStrict day stop −₹${profile.strictDayLossPts * CRUDE_RUPEES_PER_POINT} enabled.`
            : `\nDay stop −₹${profile.dayLossStopPts * CRUDE_RUPEES_PER_POINT}.`;
          const ok = await this.uiDialog.confirm({
            title: 'Start live money on Crude Oil Mini?',
            message: `Profile: ${profile.label}\nReal Kite MCX MIS MARKET orders will be placed on ATM CRUDEOILM options (${lots} lot each) when signals fire.${risk}${lockNote}\n\nOrders go via DigitalOcean fixed IP.`,
            confirmLabel: 'Start live',
            cancelLabel: 'Cancel',
            tone: 'danger',
          });
          if (!ok) {
            return;
          }
        }
        await this.desk.startLive({
          ...runOpts,
          realOrders: this.realOrders,
        });
      }
    } catch (err) {
      this.error.set(formatUnknownError(err, 'Crude desk'));
    }
  }

  protected onStop(): void {
    if (this.busy()) {
      this.desk.cancelRun();
      return;
    }
    this.desk.stopLive();
  }

  protected hasOpenTrade(): boolean {
    return this.snapshot().statuses.some((s) => !!s.openTrade);
  }

  protected marketLiveSummary(): string {
    const open = this.snapshot().statuses.filter((s) => s.openTrade);
    if (!open.length) {
      return '';
    }
    return open
      .map((s) => {
        const o = s.openTrade!;
        const money = this.snapshot().realOrders && s.brokerEntryOrderId ? ' · Kite live' : '';
        return `${s.instrumentName}: ${o.direction} · Entry ${o.indexEntry.toFixed(1)} · SL ${o.indexStop.toFixed(1)} · Tgt ${o.indexTarget.toFixed(1)}${money}`;
      })
      .join('  |  ');
  }

  /** Always-on live strip: waiting reason or open trade levels. */
  protected liveActivitySummary(): string {
    const snap = this.snapshot();
    const open = this.marketLiveSummary();
    if (open) {
      return open;
    }
    const s = snap.statuses[0];
    if (!s) {
      return `${this.activeProfile().label} · starting…`;
    }
    if (s.lastExitReason) {
      return `Last exit: ${s.lastExitReason} · ${this.fmtTime(s.lastExitTime)} · now ${s.livePhaseLabel}`;
    }
    if (s.lastSignal && s.lastSignal !== 'Waiting') {
      return `${s.livePhaseLabel} · ${s.lastSignal}`;
    }
    return `${s.livePhaseLabel} · ${this.activeProfile().label}`;
  }

  protected optionStopPremium(open: {
    indexEntry: number;
    indexStop: number;
    optionEntryPremium: number | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    const indexRisk = Math.abs(open.indexEntry - open.indexStop);
    // MCX crude ≈ 1.0Δ
    return Math.max(0.05, Math.round((open.optionEntryPremium - indexRisk) / 0.05) * 0.05);
  }

  protected optionTargetPremium(open: {
    indexEntry: number;
    indexTarget: number;
    optionEntryPremium: number | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    const indexReward = Math.abs(open.indexTarget - open.indexEntry);
    return Math.max(0.05, Math.round((open.optionEntryPremium + indexReward) / 0.05) * 0.05);
  }

  protected fmtTime(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return ts.replace('T', ' ').slice(0, 16);
  }

  protected fmtWeekday(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return formatDayOfWeek(extractTradeDate(ts));
  }

  protected fmtDisplayDate(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return formatDisplayDate(extractTradeDate(ts));
  }

  protected downloadPdf(): void {
    const snap = this.snapshot();
    const view = this.resultView();
    if (!view.trades.length) {
      return;
    }
    const p = this.activeProfile();
    this.deskExport.exportPdf(
      {
        ...snap,
        trades: view.trades,
        totals: view.totals,
        dayStats: view.dayStats,
      },
      {
        title: 'Crude Oil Desk Results',
        subtitle: `CRUDEOILM ${p.label} · ${[
          this.enableMorning ? 'morning 10:00–12:00' : null,
          this.enableEvening ? 'evening 18:30–20:30' : null,
        ]
          .filter(Boolean)
          .join(' + ')} · days ${view.weekdayLabel}`,
      },
    );
  }
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
