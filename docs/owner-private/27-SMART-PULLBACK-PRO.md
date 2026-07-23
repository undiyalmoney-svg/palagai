# 27 — Smart Pullback PRO (Pine) · Kite daily ₹ research

**Date:** 2026-07-23  
**Scripts:** `scripts/smart-pullback-pro-daily-research.py` (+ Kite cache runner)  
**Strategy id:** `smart-pullback-pro`  
**Book:** Nifty ₹65/pt + Bank ₹30/pt · **1 lot each** (unless noted)

## Thesis

TradingView **Smart Pull back PRO** prints many BUY/SELL labels. The money question is **which entry family** + **when to exit** for a usable daily ₹ band.

## Data

| Series | Source | Span |
|---|---|---|
| **Truth** | Kite 5m `256265` / `260105` | 2020→2026 · **OOS calendar 2024+ (635 days)** |
| Overfit check | Yahoo 5m ~60d | showed a false “pullback · 1.5R” winner |

Auth for fetch: `KITE_AUTH='token apiKey:accessToken'` (never commit tokens). Cache path: `reports/analyst-cache/*-5m-2020-2026.json` (gitignored).

## Kite OOS winner (deploy DNA)

| Knob | Value |
|---|---|
| Entry | **Pine breakout** — close beyond prior H/L + EMA50 side + same-bar “retest” tol + strong body |
| Exit | **2R** hard target |
| Window | **10:15–14:30** |
| Max trades / day / instrument | **1** |
| Min bars between same-side | **30** |
| Sideways skip | **OFF** (did not help leaders) |
| Stop | candle extreme, cap Nifty 30 / Bank 45; day stop −60 pts |

### Metrics @ 1+1 lot (OOS 2024+)

| Metric | Smart PB breakout·2R | Yahoo pullback·1.5R on Kite | Notes |
|---|---:|---:|---|
| Days ≥ ₹500 | **~49%** | ~37% | |
| Green calendar | **~52%** | ~43% | |
| In ₹500–₹5000 | **~39%** | ~34% | |
| Avg ₹ / day | **~₹138** | **−₹44** | Yahoo winner **does not transfer** |
| Median traded | **~+₹372** | −₹371 | |
| Best / worst | +6600 / **−3300** | / −5694 | day-stop bound |
| Coverage | ~99% | ~93% | |

### By year (breakout · 2R · 10:15–14:30 · 1t)

| Year | ≥₹500 | Green | Avg ₹ |
|---|---:|---:|---:|
| 2024 | 54% | 57% | ~300 |
| 2025 | 44% | 47% | ~13 |
| 2026 YTD | 49% | 53% | ~65 |

## Path to ₹500 / day

At **1+1 lot**, avg is ~₹138 — **not** ₹500–₹5000 daily.  
Rough sizing: **~3.5–4 lots each** → ~₹500 avg (same DNA), with worst days scaling too (~−₹12k at 4×).

## Entry / exit answers

**Enter:** Pine **breakout+strong** (EMA-filtered), morning-mid session only (10:15–14:30), one trade.  
**Exit:** **2R**. 1.5R hits the ₹500 band slightly more often but lower average; EOD/EMA exits lost.

EMA **pullback** labels are plentiful but **lose money** on Kite multi-year OOS when sized 1+1.

## Honest limits

- **Cannot promise min ₹500 every day** at 1 lot — ~half the days miss.  
- Worst day ~**−₹3300** @ 1+1 with day-stop 60.  
- Index spot tokens used as research proxy; futures/options theta not modeled.  
- **Do not replace** Donch Retest Paper/Live defaults on this DNA alone.

## App wiring

- Engine: `src/app/core/strategy-manager/engines/smart-pullback-pro.engine.ts`  
- Module: `src/app/core/strategy-manager/modules/smart-pullback-pro.managed-strategy.ts`  
- Select **Smart PB PRO · breakout · 2R** in Strategy Manager.  
- Extras: `signalMode` = `breakout` | `pullback` | `both`

## Reproduce

```bash
# after Kite fetch into reports/analyst-cache/
python3 scripts/smart-pullback-pro-daily-research.py   # Yahoo probe
# Kite OOS grid output: /tmp/smart-pb-kite/summary.json
```
