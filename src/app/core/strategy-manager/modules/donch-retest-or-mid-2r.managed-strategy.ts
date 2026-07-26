import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Donchian-20 break → retest + OR-mid bias.
 * Exit (exit-lab high-profit): hard SL + Swing-5 structure trail + EOD.
 * **Default for Nifty/Bank** — risk-tightened: ≤2t/day · SL 22/35 · day stop −40.
 */
@Injectable({ providedIn: 'root' })
export class DonchRetestOrMid2rManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R;
  readonly name = 'Donch Retest';
  readonly version = '1.5.0';
  readonly description =
    'Default · Donchian-20 break → retest · OR-mid · Swing-5 trail · ≤2 trades/day · tight day stop. Index DNA — NOT for stocks.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 22,
    bankStopLossPts: 35,
    donchianLength: 20,
    swingLookback: 5,
    maxTradesPerDay: 2,
    instrumentType: 'futures',
    dayStopPts: 40,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'donch_retest',
    bias: 'or_mid',
    exit: 'swing_trail',
  };
}
