import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/** Donchian-55 Turtle-style breakout + EOD (5m bar channel). */
@Injectable({ providedIn: 'root' })
export class Donchian55TurtleManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCHIAN_55_TURTLE;
  readonly name = 'Turtle 55';
  readonly version = '1.0.0';
  readonly description =
    'Turtle-style 55-bar Donchian breakout on the desk timeframe; EOD exit, 1 trade/day.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 45,
    donchianLength: 55,
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
