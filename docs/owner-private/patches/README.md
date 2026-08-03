# Patches (copy onto other repos / droplet)

## `order-api-live-tick-ipv4/` — Auto Live `Tick failed: AggregateError`

**Already applied on droplet** `168.144.28.89` (`trading-backend` restarted 2026-08-03).

Copy into `Palagai-Order-API`:

| File here | Destination |
|-----------|-------------|
| `kite-http.js` | `utils/kite-http.js` |
| `kite-market.js` | `live/kite-market.js` |
| `live.worker.js` | `live/live.worker.js` |
| `kite.service.js` | `services/kite.service.js` |

Or apply: `git apply docs/owner-private/patches/order-api-live-tick-ipv4-retry.patch` from Order-API root (paths may need strip).

**Cause:** droplet IPv6 to `api.kite.trade` is dead → Node Happy Eyeballs `ETIMEDOUT` / AggregateError on historical candle ticks. Fix forces IPv4 + retries.
