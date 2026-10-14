import { describe, expect, it } from 'vitest';
import { HeatmapSnapshot } from '../../features/heatmap/heatmap.models';
import { deskSnapshotFromPublicHeatmaps, isDeskRouteMissing } from './market-desk-fallback';

function hm(partial: Partial<HeatmapSnapshot> & Pick<HeatmapSnapshot, 'index'>): HeatmapSnapshot {
  return {
    public: true,
    session: { ok: true, source: 'yahoo' },
    buckets: [],
    trends: [],
    advances: 1,
    declines: 0,
    unchanged: 0,
    trendCounts: {},
    companies: [],
    lastUpdatedAt: '2026-10-14T09:00:00Z',
    ...partial,
  };
}

describe('market-desk fallback', () => {
  it('maps live public heatmap quotes onto the private desk shape', () => {
    const nifty = hm({
      index: { id: 'NIFTY50', name: 'NIFTY 50', ltp: 22640, change: -90, changePct: -0.4 },
      companies: [
        {
          symbol: 'HDFCBANK',
          name: 'HDFC Bank',
          sector: 'BANK',
          mcapRank: 1,
          ltp: 1650,
          change: 12,
          changePct: 1.2,
          high52: 1800,
          low52: 1400,
          ema20: 1600,
          ema50: 1550,
          adx: 28,
          trend: 'strong-up',
          trendLabel: 'Strong up',
          score: 2,
          bucket: '3-to-1',
        },
      ],
    });
    const bank = hm({ index: { id: 'BANKNIFTY', name: 'NIFTY BANK', ltp: 55100, change: 100, changePct: 0.2 } });
    const sensex = hm({ index: { id: 'SENSEX', name: 'SENSEX', ltp: 74200, change: -50, changePct: -0.1 } });
    const snap = deskSnapshotFromPublicHeatmaps(nifty, bank, sensex);
    expect(snap.private).toBe(true);
    expect(snap.demo).toBe(false);
    expect(snap.indices[0].ltp).toBe(22640);
    expect(snap.indices.map((i) => i.id)).toContain('CRUDEOILM');
    expect(snap.indices.find((i) => i.id === 'CRUDEOILM')?.name).toBe('Crude Oil Mini');
    expect(snap.indices[0].bias).toBe('mild-bear');
    expect(snap.indices[0].biasLabel).toBe('Mild bearish bias');
    expect(snap.indices[0].dayTrend).toBe('bearish');
    expect(snap.indices[0].breakout15.status).toBe('insufficient');
    expect(snap.stocks[0].symbol).toBe('HDFCBANK');
    expect(snap.stocks[0].bias).toBe('bullish');
    expect(snap.stocks[0].changePct).toBe(1.2);
    expect(snap.warning).toMatch(/droplet/);
  });

  it('still lists Nifty 50 names when the public feed returns no companies', () => {
    const nifty = hm({ index: { id: 'NIFTY50', name: 'NIFTY 50', ltp: 22640, change: -90, changePct: -0.4 } });
    const bank = hm({ index: { id: 'BANKNIFTY', name: 'NIFTY BANK', ltp: 55100, change: 100, changePct: 0.2 } });
    const sensex = hm({ index: { id: 'SENSEX', name: 'SENSEX', ltp: 74200, change: -50, changePct: -0.1 } });
    const snap = deskSnapshotFromPublicHeatmaps(nifty, bank, sensex);
    expect(snap.stocks).toHaveLength(50);
    expect(snap.stocks.map((s) => s.symbol)).toContain('HDFCBANK');
    expect(snap.stocks[0].biasLabel).toBe('Waiting for quotes');
  });

  it('treats a 404 market-desk response as a missing route', () => {
    expect(isDeskRouteMissing({ status: 404, message: 'Http failure response for https://palagai.app/api/market-desk: 404' })).toBe(
      true,
    );
    expect(isDeskRouteMissing({ status: 401, message: 'Login required' })).toBe(false);
  });
});
