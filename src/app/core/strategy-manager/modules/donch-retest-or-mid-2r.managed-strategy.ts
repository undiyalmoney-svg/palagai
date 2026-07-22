import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Donchian-20 break → retest + OR-mid bias + 2R target.
 * Daily ₹500 S/R search winner (OOS 2024+): ~50.6% green days, median traded > 0.
 * At 1 lot Nifty+Bank avg ~₹195; ~2–3 lots targets ~₹500 average.
 */
@Injectable({ providedIn: 'root' })
export class DonchRetestOrMid2rManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R;
  readonly name = 'Donch Retest · OR-mid · 2R';
  readonly version = '1.0.0';
  readonly description =
    'Break Donchian-20 S/R, enter on retest · OR-mid bias · 2R · 1t. Index daily-profit DNA — NOT for stocks (use GAP_FADE_500).';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 20,
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 2,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'donch_retest',
    bias: 'or_mid',
    exit: 'eod',
  };
}
