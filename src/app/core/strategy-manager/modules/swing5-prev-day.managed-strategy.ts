import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/** Swing-5 + previous-day bias + EOD. */
@Injectable({ providedIn: 'root' })
export class Swing5PrevDayManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SWING5_PREV_DAY;
  readonly name = 'Swing-5 + Previous Day + EOD';
  readonly version = '1.0.0';
  readonly description =
    'Swing-5 breakout filtered by previous-day bullish/bearish bias; hold to EOD.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank', 'stocks'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    swingLookback: 5,
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 0,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'swing',
    bias: 'prev_day',
    exit: 'eod',
  };
}
