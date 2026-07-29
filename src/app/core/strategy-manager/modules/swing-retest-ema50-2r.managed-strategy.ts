import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Swing-5 break → retest + EMA50 bias + 2R target.
 * Strong green-day twin from S/R search (~53% green, median traded ~₹483).
 */
@Injectable({ providedIn: 'root' })
export class SwingRetestEma50Rr2ManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SWING_RETEST_EMA50_2R;
  readonly name = 'Swing Retest';
  readonly version = '1.0.0';
  readonly description =
    'Break swing-5 S/R, enter on retest · EMA50 · 2R · 1t. Index twin — NOT for stocks (use GAP_FADE_500).';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    swingLookback: 5,
    emaLength: 50,
    maxTradesPerDay: 0,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 2,
    regimeFilterEnabled: false,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'swing_retest',
    bias: 'ema',
    exit: 'eod',
  };
}
