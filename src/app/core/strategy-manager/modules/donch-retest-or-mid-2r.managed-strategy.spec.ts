import { describe, expect, it } from 'vitest';
import { DonchRetestOrMid2rManagedStrategy } from './donch-retest-or-mid-2r.managed-strategy';
import { MANAGED_STRATEGY_IDS, DEFAULT_CHANNEL_ASSIGNMENTS } from '../config/managed-strategy-ids';

describe('DonchRetestOrMid2rManagedStrategy', () => {
  it('is the indices default with mt3', () => {
    const s = new DonchRetestOrMid2rManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R);
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.nifty.paper).toBe(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.bank.live).toBe(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R);
  });
});
