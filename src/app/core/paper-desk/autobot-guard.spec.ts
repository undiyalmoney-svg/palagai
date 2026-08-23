import { describe, expect, it, vi, afterEach } from 'vitest';

/** Mirrors autobotIsLive() in paper-trade-desk.service.ts. */
async function autobotIsLive(): Promise<boolean> {
  try {
    const res = await fetch('/api/live/status', { credentials: 'include' });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      status?: string; running?: boolean; config?: { realOrders?: boolean };
    };
    const running = body?.running === true || body?.status === 'running';
    return running && body?.config?.realOrders === true;
  } catch { return false; }
}
const mock = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));

afterEach(() => vi.unstubAllGlobals());

describe('double-trade guard', () => {
  it('BLOCKS when autobot is live with real orders', async () => {
    mock({ status: 'running', config: { realOrders: true } });
    expect(await autobotIsLive()).toBe(true);
  });
  it('allows when autobot is running in PAPER', async () => {
    mock({ status: 'running', config: { realOrders: false } });
    expect(await autobotIsLive()).toBe(false);
  });
  it('allows when autobot is stopped', async () => {
    mock({ status: 'stopped', config: { realOrders: true } });
    expect(await autobotIsLive()).toBe(false);
  });
  it('fails OPEN when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await autobotIsLive()).toBe(false);
  });
  it('fails OPEN on non-200', async () => {
    mock({}, false);
    expect(await autobotIsLive()).toBe(false);
  });
});
