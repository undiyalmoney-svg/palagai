import { describe, expect, it } from 'vitest';
import {
  MAX_OPTION_HISTORY_TOKENS,
  rankTokensByFrequency,
} from './option-history-tokens.util';

describe('rankTokensByFrequency', () => {
  it('orders by count descending and skips non-positive', () => {
    expect(rankTokensByFrequency([10, 20, 10, 30, 20, 10, 0, -1])).toEqual([10, 20, 30]);
  });

  it('raises the desk cap well above the old 24 limit', () => {
    expect(MAX_OPTION_HISTORY_TOKENS).toBeGreaterThanOrEqual(100);
  });
});
