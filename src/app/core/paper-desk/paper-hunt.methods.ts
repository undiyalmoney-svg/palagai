/**
 * Named methods. Same list on Nifty, Bank, Sensex and Crude Mini.
 * Mix, patterns, rules, momentum, and classic algos. Paper hunt only — never a Kite order.
 */
import { LiveAssumeBookCfg } from './live-assume.engine';
import { PaperHuntFamily } from './live-paper.engine';

const ALL = (mode: string) => ({ trend: mode, range: mode, quiet: mode, stand: mode });
const TREND = (mode: string) => ({ trend: mode, range: 'stand', quiet: 'stand', stand: 'stand' });
const RANGE = (mode: string) => ({ trend: 'stand', range: mode, quiet: 'stand', stand: 'stand' });
const QUIET = (mode: string) => ({ trend: 'stand', range: 'stand', quiet: mode, stand: 'stand' });

export const PAPER_HUNT_MAX_TRADES = 50;

export interface PaperHuntMethodDef {
  id: string;
  label: string;
  family: PaperHuntFamily;
  patch: Partial<LiveAssumeBookCfg>;
}

export const PAPER_HUNT_METHODS: PaperHuntMethodDef[] = [
  { id: 'mom-08', label: 'mom 0.8× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8 } },
  { id: 'mom-06', label: 'mom 0.6× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.6 } },
  { id: 'mom-10', label: 'mom 1.0× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.0 } },
  { id: 'mom-12', label: 'mom 1.2× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.2 } },
  { id: 'mom-15', label: 'mom 1.5× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.5 } },
  { id: 'mom-08-skip-range', label: 'mom 0.8× skip range', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, skipStructures: ['range'] } },
  { id: 'mom-08-skip-quiet', label: 'mom 0.8× skip quiet', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, skipStructures: ['quiet'] } },
  { id: 'mom-08-ce', label: 'mom 0.8× CE only', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, onlyDir: 1 } },
  { id: 'mom-08-pe', label: 'mom 0.8× PE only', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, onlyDir: -1 } },
  { id: 'mom-08-hold15', label: 'mom 0.8× hold 15m', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, holdBars: 15 } },
  { id: 'mom-08-hold30', label: 'mom 0.8× hold 30m', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, holdBars: 30 } },
  { id: 'mom-08-hold90', label: 'mom 0.8× hold 90m', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, holdBars: 90 } },
  { id: 'mom-08-noconfirm', label: 'mom 0.8× no confirm', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, noConfirm: true } },
  { id: 'mom-08-gap0', label: 'mom 0.8× no gap', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, minGapMin: 0 } },
  { id: 'mom-08-stop200', label: 'mom 0.8× stop ₹200', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, stopRs: 200 } },
  { id: 'mom-08-stop500', label: 'mom 0.8× stop ₹500', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, stopRs: 500 } },
  { id: 'mom-08-tp200', label: 'mom 0.8× target ₹200', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, targetRs: 200 } },
  { id: 'mom-08-tp740', label: 'mom 0.8× target ₹740', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, targetRs: 740 } },
  { id: 'mom-10-skip-range', label: 'mom 1.0× skip range', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.0, skipStructures: ['range'] } },
  { id: 'mom-15-skip-range', label: 'mom 1.5× skip range', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.5, skipStructures: ['range'] } },

  { id: 'pdhl', label: 'pdhl both', family: 'pattern', patch: { strategy: 'rules', primary: ALL('pdhl'), backup: {}, freshCross: true } },
  { id: 'pdhl-noconfirm', label: 'pdhl no confirm', family: 'pattern', patch: { strategy: 'rules', primary: ALL('pdhl'), backup: {}, freshCross: true, noConfirm: true } },
  { id: 'orb-break', label: 'orb break', family: 'pattern', patch: { strategy: 'rules', primary: ALL('orb_break'), backup: {} } },
  { id: 'orb-fade', label: 'orb fade', family: 'pattern', patch: { strategy: 'rules', primary: ALL('orb_fade'), backup: {} } },
  { id: 'vwap-stretch', label: 'vwap stretch', family: 'pattern', patch: { strategy: 'rules', primary: ALL('vwap_fade'), backup: {} } },
  { id: 'trap', label: 'failed-break trap', family: 'pattern', patch: { strategy: 'rules', primary: ALL('trap'), backup: {} } },
  { id: 'fade-trap', label: 'fade or trap', family: 'pattern', patch: { strategy: 'rules', primary: ALL('fade_trap'), backup: {} } },
  { id: 'all-three', label: 'pdhl or fade or trap', family: 'pattern', patch: { strategy: 'rules', primary: ALL('all_three'), backup: {} } },
  { id: 'pdhl-fade', label: 'pdhl or fade', family: 'pattern', patch: { strategy: 'rules', primary: ALL('pdhl_fade'), backup: {} } },
  { id: 'orb-break-skip-range', label: 'orb break skip range', family: 'pattern', patch: { strategy: 'rules', primary: ALL('orb_break'), backup: {}, skipStructures: ['range'] } },
  { id: 'pdhl-trend', label: 'pdhl on trend morning', family: 'pattern', patch: { strategy: 'rules', primary: TREND('pdhl'), backup: {}, freshCross: true } },
  { id: 'mom-trend', label: 'mom 0.8× trend morning', family: 'pattern', patch: { strategy: 'momentum', primary: TREND('momentum'), momK: 0.8 } },
  { id: 'mom-range', label: 'mom 0.8× range morning', family: 'pattern', patch: { strategy: 'momentum', primary: RANGE('momentum'), momK: 0.8 } },
  { id: 'vwap-quiet', label: 'vwap stretch quiet morning', family: 'pattern', patch: { strategy: 'rules', primary: QUIET('vwap_fade'), backup: {} } },
  { id: 'orb-fade-range', label: 'orb fade range morning', family: 'pattern', patch: { strategy: 'rules', primary: RANGE('orb_fade'), backup: {} } },

  { id: 'mix-mom08', label: 'mix + mom 0.8×', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true } },
  { id: 'mix-mom15', label: 'mix + mom 1.5×', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 1.5, mix: true } },
  { id: 'mix-pdhl', label: 'mix + pdhl', family: 'mix', patch: { strategy: 'rules', primary: ALL('pdhl'), backup: {}, mix: true, freshCross: true } },
  { id: 'mix-orb', label: 'mix + orb break', family: 'mix', patch: { strategy: 'rules', primary: ALL('orb_break'), backup: {}, mix: true } },
  { id: 'mix-skip-range', label: 'mix + mom skip range', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, skipStructures: ['range'] } },
  { id: 'mix-ce', label: 'mix + CE only', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, onlyDir: 1 } },
  { id: 'mix-pe', label: 'mix + PE only', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, onlyDir: -1 } },
  { id: 'mix-noconfirm', label: 'mix + no confirm', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, noConfirm: true } },
  { id: 'mix-hold30', label: 'mix + hold 30m', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, holdBars: 30 } },
  { id: 'mix-gap0', label: 'mix + no gap', family: 'mix', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, mix: true, minGapMin: 0 } },

  { id: 'rule-1-trade', label: 'mom 0.8× one fill', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, maxTradesPerDay: 1 } },
  { id: 'rule-3-trades', label: 'mom 0.8× three fills', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, maxTradesPerDay: 3 } },
  { id: 'rule-sit-370', label: 'mom 0.8× sit at ₹370', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, minDayNetRs: 370 } },
  { id: 'rule-2-wins', label: 'mom 0.8× sit after 2 wins', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, maxWinsPerDay: 2 } },
  { id: 'rule-dense', label: 'mom 0.8× dense (no gap, no day stop)', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, minGapMin: 0, dayStops: false, noConfirm: true } },

  { id: 'algo-ema-cross', label: 'algo EMA 9/21 cross', family: 'algo', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {} } },
  { id: 'algo-ema-pull', label: 'algo EMA 21 pullback', family: 'algo', patch: { strategy: 'rules', primary: ALL('ema_pull'), backup: {} } },
  { id: 'algo-donch20', label: 'algo Donchian 20', family: 'algo', patch: { strategy: 'rules', primary: ALL('donch20'), backup: {} } },
  { id: 'algo-donch55', label: 'algo Donchian 55 turtle', family: 'algo', patch: { strategy: 'rules', primary: ALL('donch55'), backup: {} } },
  { id: 'algo-inside', label: 'algo inside-bar break', family: 'algo', patch: { strategy: 'rules', primary: ALL('inside_break'), backup: {} } },
  { id: 'algo-vwap-reclaim', label: 'algo VWAP reclaim', family: 'algo', patch: { strategy: 'rules', primary: ALL('vwap_reclaim'), backup: {} } },
  { id: 'algo-gap-fade', label: 'algo gap fade', family: 'algo', patch: { strategy: 'rules', primary: ALL('gap_fade'), backup: {} } },
  { id: 'algo-rsi', label: 'algo RSI 14 bounce', family: 'algo', patch: { strategy: 'rules', primary: ALL('rsi14'), backup: {} } },
  { id: 'algo-macd', label: 'algo MACD cross', family: 'algo', patch: { strategy: 'rules', primary: ALL('macd'), backup: {} } },
  { id: 'algo-bb', label: 'algo Bollinger mean', family: 'algo', patch: { strategy: 'rules', primary: ALL('bb_mean'), backup: {} } },
  { id: 'algo-supertrend', label: 'algo Supertrend flip', family: 'algo', patch: { strategy: 'rules', primary: ALL('supertrend'), backup: {} } },
  { id: 'algo-or-retest', label: 'algo OR retest', family: 'algo', patch: { strategy: 'rules', primary: ALL('or_retest'), backup: {} } },
  { id: 'algo-ema-skip-range', label: 'algo EMA 9/21 skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-donch20-skip-range', label: 'algo Donchian 20 skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('donch20'), backup: {}, skipStructures: ['range'] } },
  { id: 'mix-algo-ema', label: 'mix + EMA 9/21', family: 'mix', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {}, mix: true } },

  { id: 'mom-07', label: 'mom 0.7× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.7 } },
  { id: 'mom-20', label: 'mom 2.0× both', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 2.0 } },
  { id: 'mom-08-hold45', label: 'mom 0.8× hold 45m', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, holdBars: 45 } },
  { id: 'mom-08-tp370', label: 'mom 0.8× target ₹370', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, targetRs: 370 } },
  { id: 'mom-08-stop370', label: 'mom 0.8× stop ₹370', family: 'momentum', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, stopRs: 370 } },

  { id: 'pdhl-ce', label: 'pdhl CE only', family: 'pattern', patch: { strategy: 'rules', primary: ALL('pdhl'), backup: {}, freshCross: true, onlyDir: 1 } },
  { id: 'pdhl-pe', label: 'pdhl PE only', family: 'pattern', patch: { strategy: 'rules', primary: ALL('pdhl'), backup: {}, freshCross: true, onlyDir: -1 } },
  { id: 'orb-break-ce', label: 'orb break CE only', family: 'pattern', patch: { strategy: 'rules', primary: ALL('orb_break'), backup: {}, onlyDir: 1 } },
  { id: 'trap-skip-range', label: 'trap skip range', family: 'pattern', patch: { strategy: 'rules', primary: ALL('trap'), backup: {}, skipStructures: ['range'] } },
  { id: 'vwap-skip-range', label: 'vwap stretch skip range', family: 'pattern', patch: { strategy: 'rules', primary: ALL('vwap_fade'), backup: {}, skipStructures: ['range'] } },
  { id: 'orb-fade-skip-quiet', label: 'orb fade skip quiet', family: 'pattern', patch: { strategy: 'rules', primary: ALL('orb_fade'), backup: {}, skipStructures: ['quiet'] } },

  { id: 'mix-supertrend', label: 'mix + Supertrend', family: 'mix', patch: { strategy: 'rules', primary: ALL('supertrend'), backup: {}, mix: true } },
  { id: 'mix-rsi', label: 'mix + RSI 14', family: 'mix', patch: { strategy: 'rules', primary: ALL('rsi14'), backup: {}, mix: true } },
  { id: 'mix-donch20', label: 'mix + Donchian 20', family: 'mix', patch: { strategy: 'rules', primary: ALL('donch20'), backup: {}, mix: true } },
  { id: 'mix-macd', label: 'mix + MACD', family: 'mix', patch: { strategy: 'rules', primary: ALL('macd'), backup: {}, mix: true } },
  { id: 'mix-or-retest', label: 'mix + OR retest', family: 'mix', patch: { strategy: 'rules', primary: ALL('or_retest'), backup: {}, mix: true } },
  { id: 'mix-vwap-reclaim', label: 'mix + VWAP reclaim', family: 'mix', patch: { strategy: 'rules', primary: ALL('vwap_reclaim'), backup: {}, mix: true } },
  { id: 'mix-gap-fade', label: 'mix + gap fade', family: 'mix', patch: { strategy: 'rules', primary: ALL('gap_fade'), backup: {}, mix: true } },
  { id: 'mix-inside', label: 'mix + inside-bar', family: 'mix', patch: { strategy: 'rules', primary: ALL('inside_break'), backup: {}, mix: true } },
  { id: 'mix-bb', label: 'mix + Bollinger', family: 'mix', patch: { strategy: 'rules', primary: ALL('bb_mean'), backup: {}, mix: true } },
  { id: 'mix-ema-skip-range', label: 'mix + EMA skip range', family: 'mix', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {}, mix: true, skipStructures: ['range'] } },

  { id: 'rule-1-win', label: 'mom 0.8× sit after 1 win', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, maxWinsPerDay: 1 } },
  { id: 'rule-sit-200', label: 'mom 0.8× sit at ₹200', family: 'rule', patch: { strategy: 'momentum', primary: ALL('momentum'), momK: 0.8, minDayNetRs: 200 } },

  { id: 'algo-ema-ce', label: 'algo EMA 9/21 CE only', family: 'algo', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {}, onlyDir: 1 } },
  { id: 'algo-ema-pe', label: 'algo EMA 9/21 PE only', family: 'algo', patch: { strategy: 'rules', primary: ALL('ema_cross'), backup: {}, onlyDir: -1 } },
  { id: 'algo-st-skip-range', label: 'algo Supertrend skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('supertrend'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-st-skip-quiet', label: 'algo Supertrend skip quiet', family: 'algo', patch: { strategy: 'rules', primary: ALL('supertrend'), backup: {}, skipStructures: ['quiet'] } },
  { id: 'algo-rsi-skip-range', label: 'algo RSI 14 skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('rsi14'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-macd-skip-range', label: 'algo MACD skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('macd'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-donch20-ce', label: 'algo Donchian 20 CE only', family: 'algo', patch: { strategy: 'rules', primary: ALL('donch20'), backup: {}, onlyDir: 1 } },
  { id: 'algo-vwap-reclaim-skip-range', label: 'algo VWAP reclaim skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('vwap_reclaim'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-or-retest-skip-range', label: 'algo OR retest skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('or_retest'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-inside-skip-range', label: 'algo inside-bar skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('inside_break'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-bb-skip-range', label: 'algo Bollinger skip range', family: 'algo', patch: { strategy: 'rules', primary: ALL('bb_mean'), backup: {}, skipStructures: ['range'] } },
  { id: 'algo-st-ce', label: 'algo Supertrend CE only', family: 'algo', patch: { strategy: 'rules', primary: ALL('supertrend'), backup: {}, onlyDir: 1 } },

  { id: 'open5-zone', label: 'open5 zone −0.4011%', family: 'pattern', patch: { strategy: 'rules', primary: ALL('open5_zone'), backup: {} } },
  { id: 'open5-zone-ce', label: 'open5 zone bounce CE', family: 'pattern', patch: { strategy: 'rules', primary: ALL('open5_zone'), backup: {}, onlyDir: 1 } },
  { id: 'open5-zone-pe', label: 'open5 zone lose PE', family: 'pattern', patch: { strategy: 'rules', primary: ALL('open5_zone'), backup: {}, onlyDir: -1 } },
];

export const PAPER_HUNT_CAP = PAPER_HUNT_MAX_TRADES * 4 * PAPER_HUNT_METHODS.length;

const huntCapText = PAPER_HUNT_CAP.toLocaleString('en-IN');

export const PAPER_HUNT_HONEST =
  `Each of Nifty, Bank, Sensex and Crude Mini runs the same ${PAPER_HUNT_METHODS.length} methods (momentum, pattern, mix, rule and algo) as paper tickets. ` +
  `Each method may take up to 50 fills, so a full session can print up to ${huntCapText} paper tickets — not ${huntCapText} Kite orders. ` +
  'Every ticket stores max profit reached and max loss reached after entry. That is what that paper ticket did, not a guaranteed next move. ' +
  'EOD ranks the method. Start from the open; a late Start does not catch up stale bars. ' +
  'Live Kite never sees the hunt. Not a guaranteed profit.';
