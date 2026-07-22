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
  protected readonly selectedStrategyId = signal<string>(
    this.registry.getAll()[0]?.id ?? '',
  );

  protected readonly strategies = computed(() => this.registry.getAll());

  protected readonly channelStrategies = computed(() =>
    this.registry.listForChannel(this.selectedChannel()),
  );

  protected readonly selectedStrategy = computed(() =>
    this.registry.getById(this.selectedStrategyId()),
  );

  protected readonly selectedSettings = computed(() => {
    const mod = this.selectedStrategy();
    return mod ? mod.getSettings() : null;
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
    const list = this.registry.listForChannel(ch);
    if (list.length && !list.some((s) => s.id === this.selectedStrategyId())) {
      this.selectedStrategyId.set(list[0]!.id);
    }
  }

  protected selectStrategy(id: string): void {
    this.selectedStrategyId.set(id);
  }

  protected setAssignment(mode: ExecutionMode | 'shadow', strategyId: string): void {
    const value = mode === 'shadow' && strategyId === '' ? null : strategyId;
    this.manager.setAssignment(this.selectedChannel(), mode, value);
  }

  protected strategyName(id: string | null): string {
    if (!id) {
      return '— Off —';
    }
    return this.registry.getById(id)?.name ?? id;
  }

  protected patchSetting(key: keyof StrategySettings, raw: string): void {
    const id = this.selectedStrategyId();
    const mod = this.registry.getById(id);
    if (!mod) {
      return;
    }
    const current = mod.getSettings();
    const prev = current[key];
    let value: string | number | boolean = raw;
    if (typeof prev === 'boolean') {
      value = raw === 'true' || raw === 'on' || raw === '1';
    } else if (typeof prev === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) {
        return;
      }
    }
    this.manager.updateSettings(id, { [key]: value } as Partial<StrategySettings>);
  }

  protected resetSettings(): void {
    this.assignments.resetStrategySettings(this.selectedStrategyId());
  }

  protected resetAssignments(): void {
    this.assignments.resetAllAssignmentsToDefaults();
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
    const today = new Date().toISOString().slice(0, 10);
    return this.deskSnap().trades.filter((t) => t.entryTime.slice(0, 10) === today).length;
  }
}
