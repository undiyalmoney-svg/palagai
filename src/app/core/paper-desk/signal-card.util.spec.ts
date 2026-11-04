import { describe, expect, it } from 'vitest';
import { optionRoundTripCharges } from './option-charges.util';
import { SignalCardInput, buildSignalCard } from './signal-card.util';

const base: SignalCardInput = {
  book: 'sensex',
  venue: 'BSE',
  mode: 'pdhl',
  structure: 'trend',
  primaryRule: true,
  entry: 172.55,
  sl: 156.55,
  tp: 204.55,
  qty: 20,
  premiumCostRs: 3451,
  liveAsk: true,
  spreadPct: 0.01,
  entryMinute: 11 * 60,
  entryStartMin: 9 * 60 + 45,
  flatMin: 15 * 60 + 15,
  dayClosedRs: 0,
  dayLossCapRs: 420,
};

describe('buildSignalCard', () => {
  it('prices risk and reward in rupees including round-trip charges', () => {
    const c = buildSignalCard(base);
    const risk = 16 * 20 + optionRoundTripCharges(172.55, 156.55, 20, 'BSE');
    const reward = 32 * 20 - optionRoundTripCharges(172.55, 204.55, 20, 'BSE');
    expect(c.riskRs).toBeCloseTo(risk, 1);
    expect(c.rewardRs).toBeCloseTo(reward, 1);
    expect(c.rewardRisk).toBeCloseTo(reward / risk, 1);
    expect(c.entry).toBe(172.55);
    expect(c.sl).toBe(156.55);
    expect(c.tp).toBe(204.55);
  });

  it('scores the share of rule checks that agree and lists a reason for the signal', () => {
    const all = buildSignalCard(base);
    expect(all.checks.every((k) => k.pass)).toBe(true);
    expect(all.ruleScore).toBe(100);
    expect(all.reasons[0]).toMatch(/previous-day/);

    const weak = buildSignalCard({ ...base, primaryRule: false, spreadPct: null, dayClosedRs: -300 });
    expect(weak.ruleScore).toBeLessThan(100);
    expect(weak.checks.filter((k) => !k.pass).length).toBe(3);
    expect(weak.reasons.join(' ')).toMatch(/No bid\/ask was observed/);
  });

  it('does not fail the live-ask check just because 1 lot costs more than ₹3,500', () => {
    const c = buildSignalCard({ ...base, premiumCostRs: 17417, liveAsk: true });
    expect(c.checks.find((k) => k.label.startsWith('Live ask'))!.pass).toBe(true);
  });

  it('flags a poor reward to risk instead of hiding it', () => {
    const c = buildSignalCard({ ...base, tp: 176 });
    expect(c.rewardRisk).not.toBeNull();
    expect(c.checks.find((k) => k.label.startsWith('Reward'))!.pass).toBe(false);
  });
});
