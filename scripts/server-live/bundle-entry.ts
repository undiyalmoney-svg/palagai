/**
 * Angular-free entry for Server Live strategy bundle (esbuild → Order-API).
 * Exports Trap / Genie adapters + replay + ATM helpers used by the DO worker.
 */
import {
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
} from '../../src/app/core/constants/instruments.const';
import { Candle } from '../../src/app/core/models/candle.model';
import { Instrument } from '../../src/app/core/models/instrument.model';
import {
  effectiveProtectiveStop,
  replayPaperOnIndex,
} from '../../src/app/core/paper-desk/paper-desk-engine';
import { replayPaperOnCrude } from '../../src/app/core/paper-desk/crude-paper-engine';
import {
  resolveCrudeProfileDayLossPts,
  resolveCrudeStrategyProfile,
} from '../../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import { MANAGED_STRATEGY_IDS } from '../../src/app/core/strategy-manager/config/managed-strategy-ids';
import {
  applySlConfirmCutoff,
  armPeakTrailFloor,
  mergeSettings,
} from '../../src/app/core/strategy-manager/engines/index-rule.engine';
import {
  createSmartPbDayState,
  channelProfileExtras,
  DEFAULT_SMART_PB_EXTRAS,
  recordSmartPbTradeClosed,
  runSmartPullbackPro,
  smartPbExitLogic,
} from '../../src/app/core/strategy-manager/engines/smart-pullback-pro.engine';
import {
  createSrTrapDayState,
  recordSrTrapTradeClosed,
  runSrTrapConfirm,
  srTrapExitLogic,
} from '../../src/app/core/strategy-manager/engines/sr-trap-confirm.engine';
import {
  IManagedStrategy,
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../../src/app/core/strategy-manager/models/strategy-module.interface';
import {
  StrategySettings,
  defaultStrategySettings,
} from '../../src/app/core/strategy-manager/models/strategy-settings.model';
import { StrategyContext } from '../../src/app/core/strategy-engine/models/strategy-context.model';
import { computeProtectiveSlTrigger } from '../../src/app/core/live-desk/option-sl-premium.util';
import { resolveAtmWeeklyOption } from '../../src/app/core/utils/option-chain.util';
import { resolveAtmCrudeMiniOption } from '../../src/app/core/utils/crude-option.util';
import { resolveCrudeOilMiniFuturesToken } from '../../src/app/core/utils/instrument-resolver.util';

const TRAP_DEFAULTS = defaultStrategySettings({
  entryTimeStart: '09:45',
  entryTimeEnd: '14:45',
  exitTime: '15:15',
  orEnd: '09:45',
  stopLossPts: 30,
  bankStopLossPts: 50,
  emaLength: 50,
  maxTradesPerDay: 0,
  instrumentType: 'futures',
  dayStopPts: 80,
  dayProfitLockPts: 0,
  targetRMultiple: 3.5,
  profitProtectEnabled: true,
  profitProtectArmR: 1,
  profitProtectLockR: 0,
  regimeFilterEnabled: false,
  positionSizeLots: 1,
  extras: {
    trapMode: 'both',
    swingLb: 5,
    piercePts: 3,
    minRiskPts: 4,
    maxRiskPts: 28,
    slPadPts: 2,
    minConfirmBody: 0,
    profitLockArmRs: 600,
    profitLockLockRs: 300,
    profitLockGivebackRs: 300,
    slConfirmCutoffEnabled: true,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700,
  },
});

const GENIE_DEFAULTS = defaultStrategySettings({
  entryTimeStart: '10:15',
  entryTimeEnd: '14:30',
  exitTime: '15:15',
  orEnd: '09:45',
  stopLossPts: 30,
  bankStopLossPts: 45,
  emaLength: 50,
  maxTradesPerDay: 0,
  instrumentType: 'futures',
  dayStopPts: 60,
  targetRMultiple: 3,
  profitProtectEnabled: false,
  regimeFilterEnabled: false,
  positionSizeLots: 1,
  extras: {
    ...DEFAULT_SMART_PB_EXTRAS,
    genieRouterEnabled: true,
    profitLockArmRs: 600,
    profitLockLockRs: 300,
    profitLockGivebackRs: 300,
    slConfirmCutoffEnabled: true,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700,
  },
});

function createTrapStrategy(): IManagedStrategy {
  let settings = mergeSettings(TRAP_DEFAULTS, {});
  let state = createSrTrapDayState();
  const api: IManagedStrategy = {
    id: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    name: 'Trap',
    version: '1.0.0',
    description: 'Server Live Trap',
    supports: ['nifty', 'bank'],
    defaultSettings: TRAP_DEFAULTS,
    initialize(partial) {
      settings = mergeSettings(TRAP_DEFAULTS, partial);
      state = createSrTrapDayState();
    },
    reset() {
      state = createSrTrapDayState();
    },
    analyze(ctx) {
      const signal = api.generateSignal(ctx);
      return { lastReason: signal.reason, ...signal.analysis };
    },
    generateSignal(ctx: StrategyContext): ManagedStrategySignal {
      const bank = /bank/i.test(ctx.instrumentId ?? '');
      const effective = mergeSettings(settings, {
        extras: {
          ...settings.extras,
          maxRiskPts: bank ? 50 : 28,
          minRiskPts: bank ? 8 : 4,
        },
      });
      return runSrTrapConfirm(ctx, state, effective);
    },
    calculateStopLoss(_ctx, entryPrice, direction) {
      const bank = /bank/i.test(_ctx.instrumentId ?? '');
      const cap = bank ? settings.bankStopLossPts : settings.stopLossPts;
      return direction === 'BUY' ? entryPrice - cap : entryPrice + cap;
    },
    calculateTarget(_ctx, entryPrice, stopLoss, direction) {
      const risk = Math.abs(entryPrice - stopLoss);
      const mult = settings.targetRMultiple > 0 ? settings.targetRMultiple : 3.5;
      return {
        target: direction === 'BUY' ? entryPrice + risk * mult : entryPrice - risk * mult,
        riskRewardRatio: mult,
      };
    },
    exitLogic(candle, open, closes, ctx): ManagedExitDecision | null {
      return srTrapExitLogic(candle, open, closes, settings, ctx);
    },
    onTradeClosed(points: number) {
      recordSrTrapTradeClosed(
        state,
        points,
        settings.dayStopPts,
        settings.dayProfitLockPts ?? 0,
      );
    },
    getSettings() {
      return { ...settings, extras: { ...settings.extras } };
    },
    updateSettings(partial) {
      settings = mergeSettings(settings, partial);
    },
  };
  return api;
}

function createGenieStrategy(): IManagedStrategy {
  let settings = mergeSettings(GENIE_DEFAULTS, {});
  let state = createSmartPbDayState();
  const api: IManagedStrategy = {
    id: MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE,
    name: 'Genie',
    version: '1.1.0',
    description: 'Server Live Genie',
    supports: ['nifty', 'bank', 'stocks'],
    defaultSettings: GENIE_DEFAULTS,
    initialize(partial) {
      settings = mergeSettings(GENIE_DEFAULTS, partial);
      state = createSmartPbDayState();
    },
    reset() {
      state = createSmartPbDayState();
    },
    analyze(ctx) {
      const signal = api.generateSignal(ctx);
      return { lastReason: signal.reason, ...signal.analysis };
    },
    generateSignal(ctx: StrategyContext): ManagedStrategySignal {
      const profile = channelProfileExtras(ctx.instrumentId);
      const effective = mergeSettings(settings, {
        targetRMultiple: profile.targetRMultiple,
        maxTradesPerDay: profile.maxTradesPerDay,
        extras: {
          ...settings.extras,
          ...profile.extras,
          genieRouterEnabled: true,
          minBarsBetweenSignals: profile.minBarsBetweenSignals,
          emaFlatPts: profile.emaFlatPts,
        },
      });
      const signal = runSmartPullbackPro(ctx, state, effective);
      if (signal.action === 'BUY' || signal.action === 'SELL') {
        return {
          ...signal,
          reason: `align-combo ${signal.reason}`,
          analysis: { ...signal.analysis, strategy: 'align-combo-genie' },
        };
      }
      return {
        ...signal,
        analysis: { ...signal.analysis, strategy: 'align-combo-genie' },
      };
    },
    calculateStopLoss(ctx, entryPrice, direction) {
      const signal = api.generateSignal(ctx);
      if (signal.action === 'BUY' || signal.action === 'SELL') {
        return signal.stopLoss;
      }
      const bank = /bank/i.test(ctx.instrumentId ?? '');
      const cap = bank ? settings.bankStopLossPts : settings.stopLossPts;
      return direction === 'BUY' ? entryPrice - cap : entryPrice + cap;
    },
    calculateTarget(_ctx, entryPrice, stopLoss, direction) {
      const risk = Math.abs(entryPrice - stopLoss);
      const profile = channelProfileExtras(_ctx.instrumentId);
      const mult = profile.targetRMultiple || settings.targetRMultiple || 3;
      return {
        target: direction === 'BUY' ? entryPrice + risk * mult : entryPrice - risk * mult,
        riskRewardRatio: mult,
      };
    },
    exitLogic(candle, open, closes, ctx): ManagedExitDecision | null {
      return smartPbExitLogic(candle, open, closes, settings, ctx);
    },
    onTradeClosed(points: number) {
      recordSmartPbTradeClosed(state, points, settings.dayStopPts, settings.dayProfitLockPts ?? 0);
    },
    getSettings() {
      return { ...settings, extras: { ...settings.extras } };
    },
    updateSettings(partial) {
      settings = mergeSettings(settings, partial);
    },
  };
  return api;
}

export {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy,
  createGenieStrategy,
  replayPaperOnIndex,
  replayPaperOnCrude,
  resolveCrudeStrategyProfile,
  resolveCrudeProfileDayLossPts,
  resolveAtmWeeklyOption,
  resolveAtmCrudeMiniOption,
  resolveCrudeOilMiniFuturesToken,
  computeProtectiveSlTrigger,
  effectiveProtectiveStop,
  armPeakTrailFloor,
  applySlConfirmCutoff,
};

export type {
  Candle,
  Instrument,
  IManagedStrategy,
  ManagedOpenPosition,
  StrategySettings,
};
