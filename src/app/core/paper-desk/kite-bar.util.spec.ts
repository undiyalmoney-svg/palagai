import { describe, expect, it } from 'vitest';
import { kiteBar } from './kite-bar.util';

describe('kiteBar', () => {
  it('reads a zoned NSE stamp as IST minutes', () => {
    const bar = kiteBar(['2026-11-16T09:15:00+0530', 24000, 24010, 23990, 24005]);
    expect(bar).toMatchObject({ day: '2026-11-16', min: 9 * 60 + 15, close: 24005 });
  });

  it('treats a naive MCX 09:00 stamp as IST, not 14:30 UTC+5:30', () => {
    const bar = kiteBar(['2026-11-16T09:00:00', 5400, 5410, 5390, 5405]);
    expect(bar.day).toBe('2026-11-16');
    expect(bar.min).toBe(9 * 60);
    expect(bar.close).toBe(5405);
  });

  it('keeps a UTC Kite stamp on the IST clock', () => {
    const bar = kiteBar(['2026-11-16T03:30:00.000Z', 5400, 5410, 5390, 5405]);
    expect(bar.min).toBe(9 * 60);
  });
});
