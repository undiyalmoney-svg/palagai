import { Injectable, inject } from '@angular/core';
import { IManagedStrategy } from '../models/strategy-module.interface';
import { DeskChannel } from '../models/desk-channel.model';
import { ChampionPdhlManagedStrategy } from '../modules/champion-pdhl.managed-strategy';
import { VolExpandDonch15ManagedStrategy } from '../modules/vol-expand-donch15.managed-strategy';
import { Swing5PrevDayManagedStrategy } from '../modules/swing5-prev-day.managed-strategy';
import { Donchian20ManagedStrategy } from '../modules/donchian-20.managed-strategy';
import { Donchian55TurtleManagedStrategy } from '../modules/donchian-55-turtle.managed-strategy';
import { InsideBreakManagedStrategy } from '../modules/inside-break.managed-strategy';
import { DonchRetestOrMid2rManagedStrategy } from '../modules/donch-retest-or-mid-2r.managed-strategy';
import { SwingRetestEma50Rr2ManagedStrategy } from '../modules/swing-retest-ema50-2r.managed-strategy';
import { AppLoggerService } from '../../shared/logging/app-logger.service';

/**
 * Registers all managed strategy modules.
 * Adding a strategy = create class + inject here. Engine/desks stay untouched.
 */
@Injectable({ providedIn: 'root' })
export class StrategyRegistryService {
  private readonly logger = inject(AppLoggerService);
  private readonly champion = inject(ChampionPdhlManagedStrategy);
  private readonly volExpand = inject(VolExpandDonch15ManagedStrategy);
  private readonly swing5 = inject(Swing5PrevDayManagedStrategy);
  private readonly donch20 = inject(Donchian20ManagedStrategy);
  private readonly turtle55 = inject(Donchian55TurtleManagedStrategy);
  private readonly insideBreak = inject(InsideBreakManagedStrategy);
  private readonly donchRetest = inject(DonchRetestOrMid2rManagedStrategy);
  private readonly swingRetest = inject(SwingRetestEma50Rr2ManagedStrategy);

  private readonly modules: IManagedStrategy[];

  constructor() {
    this.modules = [
      this.champion,
      this.volExpand,
      this.swing5,
      this.donch20,
      this.turtle55,
      this.insideBreak,
      this.donchRetest,
      this.swingRetest,
    ];
    for (const m of this.modules) {
      m.initialize();
    }
    this.logger.info(
      'StrategyRegistry',
      `Registered ${this.modules.length} managed strategies`,
    );
  }

  getAll(): IManagedStrategy[] {
    return [...this.modules];
  }

  getById(id: string): IManagedStrategy | undefined {
    return this.modules.find((m) => m.id === id);
  }

  /** Fresh instance-like clone via reset + settings copy for parallel paper/shadow runs. */
  createRunner(id: string): IManagedStrategy | undefined {
    const proto = this.getById(id);
    if (!proto) {
      return undefined;
    }
    // Strategies are singletons — callers must reset() between isolated runs.
    // For concurrent paper+shadow, StrategyManager clones settings onto separate state
    // by calling initialize() which resets day state.
    return proto;
  }

  listForChannel(channel: DeskChannel): IManagedStrategy[] {
    return this.modules.filter((m) => m.supports.includes(channel));
  }

  /** Register an additional strategy at runtime (tests / future plugins). */
  register(module: IManagedStrategy): void {
    if (this.modules.some((m) => m.id === module.id)) {
      return;
    }
    module.initialize();
    this.modules.push(module);
    this.logger.info('StrategyRegistry', `Registered strategy ${module.id}`);
  }
}
