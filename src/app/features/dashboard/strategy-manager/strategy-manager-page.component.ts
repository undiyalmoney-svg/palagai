import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import {
  DESK_CHANNELS,
  DESK_CHANNEL_LABELS,
  DeskChannel,
  ExecutionMode,
} from '../../../core/strategy-manager/models/desk-channel.model';
import { StrategyManagerService } from '../../../core/strategy-manager/runtime/strategy-manager.service';
import { StrategyAssignmentService } from '../../../core/strategy-manager/config/strategy-assignment.service';
import { StrategyEventLogger } from '../../../core/strategy-manager/runtime/strategy-event-logger.service';
import { ShadowBookService } from '../../../core/strategy-manager/runtime/shadow-book.service';
import { StrategyPerformanceService } from '../../../core/strategy-manager/runtime/strategy-performance.service';
import { StrategyRegistryService } from '../../../core/strategy-manager/registry/strategy-registry.service';
import { StrategySettings } from '../../../core/strategy-manager/models/strategy-settings.model';
import { MANAGED_STRATEGY_IDS } from '../../../core/strategy-manager/config/managed-strategy-ids';
import { dnaCapsForStrategy } from '../../../core/strategy-manager/config/strategy-dna-caps';
import { PaperTradeDeskService } from '../../../core/paper-desk/paper-trade-desk.service';

@Component({
  selector: 'app-strategy-manager-page',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, RouterLink],
  templateUrl: './strategy-manager-page.component.html',
  styleUrl: './strategy-manager-page.component.css',
})
export class StrategyManagerPageComponent {
  private readonly manager = inject(StrategyManagerService);
  private readonly assignments = inject(StrategyAssignmentService);
  private readonly registry = inject(StrategyRegistryService);
  private readonly events = inject(StrategyEventLogger);
  private readonly shadow = inject(ShadowBookService);
  private readonly perf = inject(StrategyPerformanceService);
  private readonly desk = inject(PaperTradeDeskService);

  protected readonly channels = DESK_CHANNELS;
  protected readonly channelLabels = DESK_CHANNEL_LABELS;
  protected readonly assignmentMap = this.assignments.assignments;
  protected readonly eventLog = this.events.events;
  protected readonly shadowSignals = this.shadow.signals;
  protected readonly shadowTrades = this.shadow.trades;
  protected readonly deskSnap = this.desk.snapshot;

  protected readonly selectedChannel = signal<DeskChannel>('nifty');
  /** Bumps when settings change so the settings panel re-reads module state. */
  private readonly settingsEpoch = signal(0);

  protected readonly selectedStrategyId = signal<string>(
    this.assignments.getAssignment('nifty').paper ||
      this.registry.listForChannel('nifty')[0]?.id ||
      this.registry.getAll()[0]?.id ||
      '',
  );

  protected readonly strategies = computed(() => this.registry.getAll());

  protected readonly channelStrategies = computed(() =>
    this.registry.listForChannel(this.selectedChannel()),
  );

  protected readonly selectedStrategy = computed(() =>
    this.registry.getById(this.selectedStrategyId()),
  );

  protected readonly selectedSettings = computed(() => {
    this.settingsEpoch();
    const id = this.selectedStrategyId();
    const channel = this.selectedChannel();
    // Hydrate DNA for this channel so Max trades shows Trap=3 / Genie Nifty=2·Bank=1.
    this.assignments.hydrateModule(id, channel);
    const mod = this.registry.getById(id);
    return mod ? mod.getSettings() : null;
  });

  protected readonly editingAssigned = computed(() => {
    const id = this.selectedStrategyId();
    const a = this.assignmentMap()[this.selectedChannel()];
    return {
      isPaper: a.paper === id,
      isLive: a.live === id,
      paperName: this.strategyName(a.paper),
      liveName: this.strategyName(a.live),
    };
  });

  protected readonly selectedPerf = computed(() => {
    const id = this.selectedStrategyId();
    return this.perf.performance(id);
  });

  protected readonly shadowStats = computed(() => {
    const a = this.assignmentMap()[this.selectedChannel()];
    if (!a.shadow) {
      return null;
    }
    return this.shadow.statsFor(a.shadow, this.selectedChannel());
  });

  protected readonly livePerf = computed(() => {
    const a = this.assignmentMap()[this.selectedChannel()];
    return this.perf.performance(a.live, this.selectedChannel());
  });

  protected readonly paperPerf = computed(() => {
    const a = this.assignmentMap()[this.selectedChannel()];
    return this.perf.performance(a.paper, this.selectedChannel());
  });

  protected selectChannel(ch: DeskChannel): void {
    this.selectedChannel.set(ch);
    const paperId = this.assignmentMap()[ch].paper;
    const list = this.registry.listForChannel(ch);
    if (paperId && list.some((s) => s.id === paperId)) {
      this.selectedStrategyId.set(paperId);
      return;
    }
    if (list.length && !list.some((s) => s.id === this.selectedStrategyId())) {
      this.selectedStrategyId.set(list[0]!.id);
    }
  }

  protected selectStrategy(id: string): void {
    this.selectedStrategyId.set(id);
  }

  protected jumpToAssigned(mode: 'paper' | 'live'): void {
    const id = this.assignmentMap()[this.selectedChannel()][mode];
    if (id) {
      this.selectedStrategyId.set(id);
    }
  }

  protected setAssignment(mode: ExecutionMode | 'shadow', strategyId: string): void {
    const value = mode === 'shadow' && strategyId === '' ? null : strategyId;
    const channel = this.selectedChannel();
    this.manager.setAssignment(channel, mode, value);
    // Donch / Trap / GENIE: selecting Paper or Live activates both modes on this channel.
    const syncBoth =
      strategyId === MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE ||
      strategyId === MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM ||
      strategyId === MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R;
    if ((mode === 'paper' || mode === 'live') && syncBoth) {
      const other: ExecutionMode = mode === 'paper' ? 'live' : 'paper';
      this.manager.setAssignment(channel, other, strategyId);
    }
    if ((mode === 'paper' || mode === 'live') && strategyId) {
      this.selectedStrategyId.set(strategyId);
      this.settingsEpoch.update((n) => n + 1);
    }
    this.desk.refreshLiveAfterSettingsChange();
  }

  /** DNA auto-cap hint under Max trades/day. */
  protected dnaMaxTradesHint(): string {
    const caps = dnaCapsForStrategy(this.selectedStrategyId(), this.selectedChannel());
    const mt = caps.maxTradesPerDay > 0 ? String(caps.maxTradesPerDay) : '∞';
    const rr = caps.targetRMultiple != null ? ` · ${caps.targetRMultiple}R` : '';
    return `DNA locked for desk runs: ${mt}/day${rr}`;
  }

  protected strategyName(id: string | null): string {
    if (!id) {
      return '— Off —';
    }
    return this.registry.getById(id)?.name ?? id;
  }

  protected assignmentBadges(id: string): string {
    const a = this.assignmentMap()[this.selectedChannel()];
    const tags: string[] = [];
    if (a.paper === id) {
      tags.push('Paper');
    }
    if (a.live === id) {
      tags.push('Live');
    }
    if (a.shadow === id) {
      tags.push('Shadow');
    }
    return tags.join(' · ');
  }

  protected patchSetting(key: keyof StrategySettings, raw: string | number | boolean): void {
    const id = this.selectedStrategyId();
    const mod = this.registry.getById(id);
    if (!mod) {
      return;
    }
    const current = mod.getSettings();
    const prev = current[key];
    let value: string | number | boolean = raw;
    if (typeof prev === 'boolean') {
      value = raw === true || raw === 'true' || raw === 'on' || raw === '1';
    } else if (typeof prev === 'number') {
      value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        return;
      }
    } else {
      value = String(raw);
    }
    this.manager.updateSettings(id, { [key]: value } as Partial<StrategySettings>);
    this.settingsEpoch.update((n) => n + 1);
    this.desk.refreshLiveAfterSettingsChange();
  }

  protected resetSettings(): void {
    this.assignments.resetStrategySettings(this.selectedStrategyId());
    this.settingsEpoch.update((n) => n + 1);
    this.desk.refreshLiveAfterSettingsChange();
  }

  protected resetAssignments(): void {
    this.assignments.resetAllAssignmentsToDefaults();
    this.settingsEpoch.update((n) => n + 1);
    this.selectChannel(this.selectedChannel());
    this.desk.refreshLiveAfterSettingsChange();
  }

  protected clearLogs(): void {
    this.events.clear();
  }

  protected clearShadow(): void {
    this.shadow.clear(this.selectedChannel());
  }

  protected clearPerf(): void {
    this.perf.clear(this.selectedStrategyId());
  }

  protected openTradeLabel(): string {
    const snap = this.deskSnap();
    const open = snap.statuses.find((i) => i.openTrade)?.openTrade;
    if (!open) {
      return 'None';
    }
    return `${open.direction} @ ${open.indexEntry.toFixed(1)} · SL ${open.indexStop.toFixed(1)}`;
  }

  protected todayTradeCount(): number {
    const snap = this.deskSnap();
    const ch = this.selectedChannel();
    if (ch === 'stocks') {
      return 0;
    }
    const name = ch === 'nifty' ? 'Nifty' : 'Bank';
    const status = snap.statuses.find((s) => s.instrumentName.includes(name));
    if (status) {
      return status.tradesToday;
    }
    const today = new Date().toISOString().slice(0, 10);
    return snap.trades.filter(
      (t) =>
        t.entryTime.slice(0, 10) === today &&
        t.instrumentName.toLowerCase().includes(ch === 'nifty' ? 'nifty' : 'bank'),
    ).length;
  }
}
