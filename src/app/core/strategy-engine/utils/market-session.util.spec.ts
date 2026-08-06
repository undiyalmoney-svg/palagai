import { describe, expect, it } from 'vitest';
import { extractHhMm } from './market-session.util';

describe('extractHhMm', () => {
  it('reads naive cache timestamps as IST wall clock (not UTC+5:30)', () => {
    expect(extractHhMm('2026-08-03 10:00:00')).toBe('10:00');
    expect(extractHhMm('2026-08-03T09:15:00')).toBe('09:15');
    expect(extractHhMm('2026-08-03 14:45:00')).toBe('14:45');
  });

  it('keeps explicit IST offsets', () => {
    expect(extractHhMm('2026-08-03T10:00:00+05:30')).toBe('10:00');
    expect(extractHhMm('2026-08-03T10:00:00+0530')).toBe('10:00');
  });
});
