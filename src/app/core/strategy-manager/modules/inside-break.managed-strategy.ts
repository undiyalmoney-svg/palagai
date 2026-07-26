import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/**
 * Inside-bar breakout + EOD (multi-trade).
 * Daily-consistency search pick for max green-day / days≥₹500 share on Nifty+Bank.
 * Fat left tail — paper first; not the default assignment.
 */
@Injectable({ providedIn: 'root' })
export class InsideBreakManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.INSIDE_BREAK;
  readonly name = 'Inside Break';
  readonly version = '1.0.0';
  readonly description =
    'Break of prior inside-bar range · no bias · EOD · multi-trade · day stop 60. Best green-day rate in daily ₹500 search; deep red median — paper first.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    bankStopLossPts: 45,
    maxTradesPerDay: 0, // unlimited (research multi-trade)
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 0,
    regimeFilterEnabled: false,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'inside_break',
    bias: 'none',
    exit: 'eod',
  };
}
