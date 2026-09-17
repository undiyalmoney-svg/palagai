# 47 — Crude "Steady ₹500" (₹300–₹1000/day target, 1 mini lot)

**Date:** 2026-09-17
**Profile id:** `steady-500`
**Instrument:** CRUDEOILM (Crude Oil Mini) · **₹10 / point**, lot 10

## Goal

A tight, selectable Crude Bot strategy to run **live paper (no real money)** that aims for a
**₹300–₹1000/day** band on **1 mini lot** (30–100 net points at ₹10/pt).

## DNA

| Field | Value | ₹ (1 lot) |
|---|---|---|
| Entry | Opening-range breakout (OR 09:00–09:45), close beyond OR + candle colour | — |
| Entry window | 09:45–22:00 | — |
| Stop | 35 pts | −₹350 |
| Target | 50 pts | +₹500 |
| Day profit lock | +100 pts → stop new entries | +₹1000 ceiling |
| Max trades/day | 3 | — |
| Skip | OR width > 150 pts | — |
| Day loss stop | champion −240 pts (strict −295) | −₹2400 / −₹2950 |

One TP lands ₹500; a second stacks toward the ₹1000 lock. **Paper-first target, not a
guarantee** — losing days can still hit the day loss stop.

## Where it lives

- Profile: `crude-strategy-profile.ts` → `CRUDE_STEADY_500_PARAMS` (`entryMode: 'session-or'`)
- Engine: `crude-paper-engine.ts` routes `session-or` → `runCrudeSessionOr`
- Smoke: `scripts/crude-steady-500-smoke.ts` (SL35/TP50, ₹1000 lock, ≤3/day)

## How to run (live paper)

1. Open **Crude Bot** (`/dashboard/crude-bot`).
2. **Crude strategy** dropdown → **Steady ₹500 (₹300–1,000)**.
3. Leave **Live money** unchecked → **Run paper** (paper fills, no real orders).
4. Lots default from funds; use 1 for the ₹300–₹1000 band.

## Deploy note (live path)

Crude Bot paper + live run through the Order-API droplet (`/api/live`). For the new profile
to take effect there:

1. Rebuild strategy-core: `node scripts/server-live/build-strategy-core.cjs`
2. Deploy `live/strategy-core.cjs` + the updated `live.worker.js` / `daily-desk-defaults.js`
   (patches under `docs/owner-private/patches/autobot-desk-parity-310a/`) to the droplet.

The worker now passes `config.crudeStrategy` straight into `resolveCrudeStrategyProfile`
(safe fallback for unknown ids), and `normalizeStartConfig` no longer collapses it to
`all-green | selective`.
