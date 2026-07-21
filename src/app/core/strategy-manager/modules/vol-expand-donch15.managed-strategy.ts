import { Injectable } from '@angular/core';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { IndexRuleSpec } from '../engines/index-rule.engine';
import { BaseIndexRuleStrategy } from './base-index-rule.strategy';

/** VolExpand Donchian-15 + EMA50 bias + EOD (research foundation). */
@Injectable({ providedIn: 'root' })
export class VolExpandDonch15ManagedStrategy extends BaseIndexRuleStrategy {
  readonly id = MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15;
  readonly name = 'VolExpand Donchian-15 + EMA50 + EOD';
  readonly version = '1.1.0';
  readonly description =
    'VolExpand Donch15 + EMA50 + EOD (10:15–11:30). Regime filter: OR drive ≥ 0.30 and gap ≤ 6×ATR (no look-ahead).';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank', 'stocks'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '11:30',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 15,
    emaLength: 50,
    volExpandAtrMult: 1.2,
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 0,
    regimeFilterEnabled: true,
    regimeMinOrDriveFrac: 0.3,
    regimeMaxGapAtr: 6,
  });

  protected readonly spec: IndexRuleSpec = {
    entry: 'vol_expand',
    bias: 'ema',
    exit: 'eod',
  };
}
