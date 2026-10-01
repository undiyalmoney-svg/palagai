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
): { stop: number; target: number } | null {
  if (!(fill > 0) || !Number.isFinite(fill)) return null;
  const step = tick > 0 ? tick : 0.05;
  const risk = fill * 0.25;
  const stop = roundToTick(fill - risk, step);
  const target = roundToTick(fill + 0.5 * risk, step);
  if (!(stop > 0) || !(target > fill)) return null;
  return { stop, target };
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
