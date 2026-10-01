/**
 * Charts auto buy/sell — same order path on Nifty 50, Bank Nifty and Crude,
 * armed independently on each book.
 *
 * A confirmed SMC BUY buys the ATM call. A confirmed SMC SELL buys the ATM
 * put (long the hedge, never a naked short of the option). After the market
 * fill, a 25% premium stop and a 0.5R target rest on the same contract.
 */
import { AtmOptionSide } from '../orders/atm-order.util';
import { SmcAlertType } from './smc/smc.types';

export function optionSideForAlert(type: SmcAlertType): AtmOptionSide | null {
  if (type === 'BUY') return 'CE';
  if (type === 'SELL') return 'PE';
  return null;
}

export function chartProtectiveLevels(
  fill: number,
  tick = 0.05,
  caps?: {
    maxProfitRs?: number | null;
    maxLossRs?: number | null;
    rupeePerPoint?: number | null;
  },
): { stop: number; target: number } | null {
  if (!(fill > 0) || !Number.isFinite(fill)) return null;
  const step = tick > 0 ? tick : 0.05;
  const risk = fill * 0.25;
  const systemStop = roundToTick(fill - risk, step);
  const systemTarget = roundToTick(fill + 0.5 * risk, step);
  const stop = rupeeLevel(fill, caps?.maxLossRs, caps?.rupeePerPoint, step, -1) ?? systemStop;
  const target = rupeeLevel(fill, caps?.maxProfitRs, caps?.rupeePerPoint, step, 1) ?? systemTarget;
  if (!(stop > 0) || !(target > fill)) return null;
  return { stop, target };
}

/** Premium that realises `rupees` on the fill. Null when that side is unset. */
function rupeeLevel(
  fill: number,
  rupees: number | null | undefined,
  rupeePerPoint: number | null | undefined,
  tick: number,
  sign: 1 | -1,
): number | null {
  if (!(rupees != null && rupees > 0) || !(rupeePerPoint != null && rupeePerPoint > 0)) {
    return null;
  }
  const level = roundToTick(fill + (sign * rupees) / rupeePerPoint, tick);
  if (sign < 0) {
    return level > 0 && level < fill ? level : null;
  }
  return level > fill ? level : null;
}

export function shouldAutoTrade(opts: {
  autoTrade: boolean;
  liveDay: boolean;
  marketOpen: boolean;
  busy: boolean;
  type: SmcAlertType;
}): boolean {
  return (
    opts.autoTrade === true &&
    opts.liveDay === true &&
    opts.marketOpen === true &&
    opts.busy !== true &&
    optionSideForAlert(opts.type) != null
  );
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}
