import { describe, expect, it } from 'vitest';
import { optionChargeBreakdown, optionRoundTripCharges, venueForBook } from './option-charges.util';

// Reference values come from market-recorder/research/costs.py (options_round_trip).
describe('option round-trip charges', () => {
  it('matches the research schedule on NSE, BSE and MCX', () => {
    expect(optionRoundTripCharges(100, 120, 65, 'NSE')).toBeCloseTo(65.10722, 4);
    expect(optionRoundTripCharges(172.55, 204.55, 20, 'BSE')).toBeCloseTo(56.341294, 4);
    expect(optionRoundTripCharges(150, 175, 10, 'MCX')).toBeCloseTo(49.726868, 4);
    expect(optionRoundTripCharges(50, 10, 65, 'NSE')).toBeCloseTo(49.912197, 4);
  });

  it('breaks the total into brokerage, STT, exchange, SEBI, stamp, IPFT and GST', () => {
    const b = optionChargeBreakdown(100, 120, 65, 'NSE');
    expect(b.brokerage).toBe(40);
    expect(b.sttCtt).toBeCloseTo(11.7, 6);
    expect(b.exchangeTxn).toBeCloseTo(5.08079, 5);
    expect(b.stamp).toBeCloseTo(0.195, 6);
    expect(b.gst).toBeCloseTo(8.1171162, 5);
    expect(b.brokerage + b.sttCtt + b.exchangeTxn + b.sebi + b.stamp + b.ipft + b.gst).toBeCloseTo(b.total, 9);
  });

  it('is zero for an empty or invalid trade', () => {
    expect(optionRoundTripCharges(100, 120, 0, 'NSE')).toBe(0);
    expect(optionRoundTripCharges(0, 120, 65, 'NSE')).toBe(0);
  });

  it('maps books to venues', () => {
    expect(venueForBook('nifty')).toBe('NSE');
    expect(venueForBook('bank')).toBe('NSE');
    expect(venueForBook('sensex')).toBe('BSE');
    expect(venueForBook('crude')).toBe('MCX');
    expect(venueForBook('nifty-momentum')).toBe('NSE');
    expect(venueForBook('sensex-orb')).toBe('BSE');
    expect(venueForBook('crude-trap')).toBe('MCX');
  });
});
