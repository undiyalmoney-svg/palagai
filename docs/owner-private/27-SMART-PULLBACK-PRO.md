# 27 — Smart Pullback PRO (Pine) · daily ₹ research

**Date:** 2026-07-23  
**Script:** `scripts/smart-pullback-pro-daily-research.py`  
**Strategy id:** `smart-pullback-pro`  
**Book:** Nifty ₹65/pt + Bank ₹30/pt · **1 lot each**

## Thesis

TradingView **Smart Pull back PRO** prints many BUY/SELL labels. The money question is not “does it signal?” — it is **which entry family** + **when to exit** for a usable ₹500–₹5000 daily band.

## Data (this environment)

| Series | Source | Span |
|---|---|---|
| Primary | Yahoo `^NSEI` / `^NSEBANK` **5m** | ~57 sessions (≈60d max Yahoo keeps) |
| Sanity | Yahoo **60m** | ~2y · OOS calendar 2024+ |

No Kite futures cache here — results are **index spot proxy**, not live futures fills. Re-run on Kite 5m when auth is available.

## What actually printed money (recent 5m)

**Winner DNA**

| Knob | Value |
|---|---|
| Entry | **EMA50 pullback** (close above/below EMA50, bullish/bearish candle, wick touches EMA) |
| Exit | **1.5R** hard target (BE protect did **not** help on this sample) |
| Window | **09:45–15:10** |
| Max trades / day / instrument | **2** |
| Min bars between same-side signals | **30** |
| Sideways skip | **ON** (`ATR < SMA(ATR,20)×0.7` and `|EMA−EMA[5]| < 10`) |
| Stop | candle extreme, capped Nifty 30 / Bank 45; day stop −60 pts |

### Recent 5m metrics (1+1 lot, calendar days)

| Metric | Smart PB winner | Donch Retest baseline (same sample) |
|---|---:|---:|
| Days ≥ ₹500 | **61.4%** | 26.3% |
| Green calendar | **63.2%** | 31.6% |
| In ₹500–₹5000 band | **56.1%** | 22.8% |
| Avg ₹ / day | **~1140** | **−1146** |
| Median traded day | **+1365** | −1222 |
| Best / worst | +7731 / **−3832** | +6054 / −5273 |
| Coverage | 89% | 96% |

Traded-day view: **~69% ≥ ₹500**, **~63% inside ₹500–₹5000**, a few days **> ₹5000**, and **~10 red days ≤ −₹2000**.

### Entry family ranking (top of grid)

1. **`pullback` + `rr1_5`** — best daily consistency  
2. **`pb_reject` + `rr1_5`/`rr2`** — fewer trades, still useful twin (strong body + close beyond prior H/L)  
3. Raw Pine **`breakout` same-bar** family — did **not** lead the money grid  
4. Trading **both** breakout+pullback — noisier than pullback-only

## Exit answer (short)

- **Take profit at 1.5R** — highest share of days landing in the ₹500–₹5000 band.  
- **2R** raises average ₹ but drops band hit-rate (more giveback / fewer completes).  
- **EOD / EMA exits** underperformed fixed R on this sample.  
- **BE after +1R** did not beat plain 1.5R here (unlike Donch Retest defaults).

## Honest limits

- **Not every day ₹500.** ~35–40% of calendar days are still red/flat on the winning DNA.  
- **Worst day ~−₹3800** at 1+1 lot with day-stop 60 — size carefully.  
- **60m long sample** does **not** validate the same DNA (different timeframe). Treat 5m ~60d as a **recent regime** result, not multi-year proof.  
- Spot ≠ futures; slippage/fees not modeled.  
- **Do not auto-replace** Donch Retest as Paper/Live default until Kite multi-year 5m confirms.

## App wiring

- Engine: `src/app/core/strategy-manager/engines/smart-pullback-pro.engine.ts`  
- Module: `src/app/core/strategy-manager/modules/smart-pullback-pro.managed-strategy.ts`  
- Select **Smart PB PRO · EMA pullback · 1.5R** in Strategy Manager (Nifty/Bank).  
- Extras: `signalMode` = `pullback` | `breakout` | `both` | (use `pb_reject` via research script; app uses pullback/breakout/both).

## Reproduce

```bash
python3 scripts/smart-pullback-pro-daily-research.py
# → /tmp/smart-pb-pro/summary.json
```
