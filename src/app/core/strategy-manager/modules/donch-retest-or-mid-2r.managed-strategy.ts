import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Donchian-20 break → retest + OR-mid bias.
 * Profit-protect: 1.5R target + BE lock after +1R.
 * Live default allows up to 3 entries/day (day stop −60 still caps damage).
 */
@Injectable({ providedIn: 'root' })
export class DonchRetestOrMid2rManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R;
  readonly name = 'Donch Retest · OR-mid · 1.5R+BE';
  readonly version = '1.2.0';
  readonly description =
    'Break Donchian-20 S/R, enter on retest · OR-mid · 1.5R target · BE after +1R · up to 3t/day. Index DNA — NOT for stocks (use GAP_FADE_500).';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 20,
    maxTradesPerDay: 3,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 1.5,
    profitProtectEnabled: true,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'donch_retest',
    bias: 'or_mid',
    exit: 'eod',
  };
}
