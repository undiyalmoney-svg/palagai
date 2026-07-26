import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Donchian-20 break → retest + OR-mid bias.
 * Exit (exit-lab high-profit): hard SL + Swing-5 structure trail + EOD
 * (no fixed 1.5R target / BE protect — entry DNA unchanged).
 * **Default for Nifty/Bank** — up to 4 entries/day (day stop −60 still caps damage).
 */
@Injectable({ providedIn: 'root' })
export class DonchRetestOrMid2rManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R;
  readonly name = 'Donch Retest';
  readonly version = '1.4.0';
  readonly description =
    'Default · Donchian-20 break → retest · OR-mid · Swing-5 trail + EOD · ≤4 trades/day. Index DNA — NOT for stocks (use GAP_FADE_500).';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 20,
    swingLookback: 5,
    maxTradesPerDay: 4,
    instrumentType: 'futures',
    dayStopPts: 60,
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
