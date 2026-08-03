/**
 * Axios / Node HTTP helpers for Kite egress.
 *
 * DO droplet DNS returns A + AAAA for api.kite.trade, but IPv6 is unreachable
 * → Node Happy Eyeballs throws AggregateError [ETIMEDOUT] on historical ticks.
 * Force IPv4 so Server Live candle fetches stay reliable.
 */
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ family: 4, keepAlive: true });
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

/** Axios config fragment — attach to every Kite client. */
const kiteAxiosNetwork = {
  httpAgent,
  httpsAgent,
  // axios also honors `family` on newer versions; agents cover older ones
  family: 4,
};

function formatAxiosNetworkError(err) {
  if (!err) return 'unknown error';
  const cause = err.cause || err;
  const code = err.code || cause.code || '';
  const parts = [];
  if (code) parts.push(code);
  const msg = err.message || String(err);
  if (msg && msg !== 'AggregateError') parts.push(msg);
  else if (cause?.message && cause.message !== 'AggregateError') parts.push(cause.message);
  else parts.push('AggregateError');
  if (Array.isArray(cause?.errors) && cause.errors.length) {
    const nested = cause.errors
      .map((e) => e?.code || e?.message)
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    if (nested) parts.push(`[${nested}]`);
  }
  const url = err.config?.url || err._currentUrl;
  if (url) parts.push(String(url).split('?')[0]);
  return parts.join(' · ');
}

async function withRetry(fn, { retries = 2, delayMs = 800, label = 'kite' } = {}) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const code = err?.code || err?.cause?.code || '';
      const retryable = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(
        `${code} ${err?.message || ''}`,
      );
      if (!retryable || i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      // eslint-disable-next-line no-console
      console.warn(`[${label}] retry ${i + 1}/${retries} after ${code || err.message}`);
    }
  }
  throw last;
}

module.exports = {
  kiteAxiosNetwork,
  formatAxiosNetworkError,
  withRetry,
};
