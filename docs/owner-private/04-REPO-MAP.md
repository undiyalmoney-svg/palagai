# 04 — Repo map (what lives where)

Palagai is an Angular SSR app: browser UI + Node server for Kite proxy / order forward.

## Top level

| Path | Role |
|------|------|
| `src/app/` | Application code |
| `src/environments/` | `environment*.ts` — order API path, lots, allowLiveMoney, egress IP |
| `src/server.ts` | SSR: forwards `/api/order-kite` → DigitalOcean droplet |
| `proxy.conf.json` | Local: proxy order API to `168.144.28.89:3000` |
| `public/` | Static assets shipped with build |
| `docs/owner-private/` | **This documentation (not deployed)** |
| `reports/` | Local research outputs (gitignored) |
| `scripts/` | Analysis / discovery CLIs |

## Features (UI)

| Path | Role |
|------|------|
| `features/login/` | App username/password gate |
| `features/dashboard/` | Shell + nav |
| `features/dashboard/trade-desk/` | Nifty + Bank Testing / Live / Live money |
| `features/dashboard/crude-oil-desk/` | Crude Mini Testing / Live / Live money |
| `features/dashboard/get-token/` | Kite OAuth / paste token / IP+URL copy helper |
| `features/dashboard/order-test/` | Tiny real-order IP smoke test |
| `features/dashboard/settings/` | Instruments refresh, lots preference |
| Other dashboard tabs | Mostly redirected to trade-desk (legacy routes) |

## Core — trading path (care about these)

| Path | Role |
|------|------|
| `core/strategy-engine/strategies/pdhl-opening-range/` | **Secret Nifty/Bank entry** |
| `core/strategy-engine/strategies/crude-pdhl-evening/` | **Secret Crude entry** |
| `core/paper-desk/paper-desk-engine.ts` | Index replay + exits + options P&L |
| `core/paper-desk/paper-trade-desk.service.ts` | Trade Desk orchestration / Kite fetch |
| `core/paper-desk/crude-paper-engine.ts` | Crude replay + exits |
| `core/paper-desk/crude-paper-desk.service.ts` | Crude Desk orchestration |
| `core/live-desk/live-order-executor.service.ts` | Real Kite orders |
| `core/kite/` | API client, session, credentials, historical limits |
| `core/utils/option-chain.util.ts` | ATM weekly Nifty/Bank options |
| `core/utils/crude-option.util.ts` | ATM CRUDEOILM mini options |
| `core/auth/` | App login + guards |
| `core/config/session.config.ts` | NSE vs MCX session clocks |
| `core/constants/instruments.const.ts` | Instrument IDs / symbols |
| `core/services/lots-preference.service.ts` | Lots in localStorage |
| `core/services/instrument-store.service.ts` | Instruments CSV cache |

## Core — research / legacy (not Trade Desk DNA)

| Path | Role |
|------|------|
| `core/research-platform/` | Strategy research UI engines |
| `core/backtesting/` | Generic backtest runner |
| `core/strategy-engine/strategies/first-hour-breakout/` | Older strategy |
| `core/strategy-engine/strategies/intraday-reversal/` | Older strategy |
| `core/strategy-engine/utils/*` | Filters, momentum, PA helpers used by research |
| `core/trading/`, `core/reporting/`, `core/data/` | Shared domain helpers |

## Environments (important flags)

| Key | Meaning |
|-----|---------|
| `orderApiBaseUrl` | Usually `/api/order-kite` |
| `allowLiveMoney` | Must be true for real orders |
| `orderEgressIp` | `168.144.28.89` — whitelist in Kite |
| `defaultLots` | Default lots multiplier |
| `devKiteSession` | Optional local-only; **never commit tokens** |

## Annotated secret sources
Full line commentary for the two entry files:

- [ANNOTATED-pdhl-opening-range.evaluator.md](./ANNOTATED-pdhl-opening-range.evaluator.md)
- [ANNOTATED-crude-pdhl-evening.evaluator.md](./ANNOTATED-crude-pdhl-evening.evaluator.md)
