/**
 * Entry mix for the five CE/PE desks. Same five rules, scored together.
 * Not a guaranteed profit. One losing day is not a rewrite of the exits.
 */
import { LiveAssumeBar, LiveAssumeBookCfg, bookSignal, sessionVwap } from './live-assume.engine';

export const MIX_MODES = ['momentum', 'orb_break', 'pdhl', 'vwap_fade', 'trap'] as const;
export const MIX_CONTINUATION = new Set(['momentum', 'orb_break', 'pdhl']);
export const MIX_FADE = new Set(['vwap_fade', 'trap']);
export const MIX_NEED = 4;
export const MIX_SPREAD_PCT = 0.03;

export type MixHit = { dir: number; mode: string };

export interface MixGate {
  ok: boolean;
  score: number;
  need: number;
  reason: string;
  bits: string[];
}

export function usesMix(cfg: LiveAssumeBookCfg): boolean {
  return cfg.mix === true;
}

export function mixVotes(bars: LiveAssumeBar[], i: number, cfg: LiveAssumeBookCfg): MixHit[] {
  return MIX_MODES.map((mode) => ({ mode, dir: bookSignal(mode, bars, i, cfg) })).filter((v) => v.dir);
}

export function mixGate(
  bars: LiveAssumeBar[],
  i: number,
  cfg: LiveAssumeBookCfg,
  hit: MixHit,
  structure: string,
): MixGate {
  if (!usesMix(cfg) || !hit.dir) {
    return { ok: true, score: MIX_NEED, need: MIX_NEED, reason: '', bits: [] };
  }
  const fade = MIX_FADE.has(hit.mode);
  const bits: string[] = [hit.mode];
  let score = 2;
  const vwap = sessionVwap(bars, i);
  const close = bars[i]?.close;
  const withVwap = vwap != null && close != null && (hit.dir === 1 ? close >= vwap : close <= vwap);
  if (vwap != null && close != null) {
    if (!fade && withVwap) {
      score += 1;
      bits.push('with-vwap');
    }
    if (fade && !withVwap) {
      score += 1;
      bits.push('stretch-vwap');
    }
  }
  const stOk = fade ? structure !== 'trend' : structure !== 'quiet';
  if (stOk && structure !== 'stand' && structure !== 'wait') {
    score += 1;
    bits.push(structure);
  }
  const votes = mixVotes(bars, i, cfg);
  const ally = votes.find((v) => v.dir === hit.dir && v.mode !== hit.mode);
  if (ally) {
    score += 1;
    bits.push(`+${ally.mode}`);
  }
  const oppCont = votes.filter((v) => MIX_CONTINUATION.has(v.mode) && v.dir === -hit.dir);
  if (!fade && vwap != null && !withVwap) {
    return { ok: false, score, need: MIX_NEED, reason: 'mix: continuation against VWAP', bits };
  }
  if (fade && structure === 'trend') {
    return { ok: false, score, need: MIX_NEED, reason: 'mix: no fade on trend day', bits };
  }
  if (fade && oppCont.length >= 2) {
    return {
      ok: false,
      score,
      need: MIX_NEED,
      reason: `mix: fade vs ${oppCont.map((v) => v.mode).join('+')}`,
      bits,
    };
  }
  const ok = score >= MIX_NEED;
  return {
    ok,
    score,
    need: MIX_NEED,
    reason: ok ? `mix ${score}/${MIX_NEED} ${bits.join(',')}` : `mix ${score}/${MIX_NEED} need ${MIX_NEED}`,
    bits,
  };
}
