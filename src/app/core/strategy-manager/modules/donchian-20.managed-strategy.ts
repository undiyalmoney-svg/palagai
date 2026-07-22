import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/** Donchian-20 breakout + EOD. */
@Injectable({ providedIn: 'root' })
export class Donchian20ManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCHIAN_20;
  readonly name = 'Donchian-20 + EOD';
  readonly version = '1.0.0';
  readonly description = 'Classic 20-bar Donchian channel breakout; hold to EOD.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    donchianLength: 20,
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 0,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'donch',
    bias: 'none',
    exit: 'eod',
  };
}
