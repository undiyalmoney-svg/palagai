# 20 — S/R · Pullback · Retest daily ₹500

**Date:** 2026-07-21  
**Script:** `scripts/sr-pullback-retest-daily500.py`  
**Grid:** 3600 candidates · OOS calendar 2024+ (623 days)  
**Book:** Nifty ₹65/pt + Bank ₹30/pt

## Thesis

Breakout chasing is fat-tailed. **Support/resistance retests** and **pullbacks** with a fixed **R-multiple target** should raise green-day rate toward a usable daily ₹500 plan.

## Winner

**Donchian-20 break → retest · OR-mid bias · 2R target · 1 trade/day · 09:45–15:10**

| Metric (1 lot each) | Value |
|---|---:|
| Green calendar days | **50.6%** |
| Days ≥ ₹500 | **48.0%** |
| Coverage | **99.4%** |
| Avg ₹ / day | **195** |
| Median traded day | **+106** (first positive median in index search) |
| Trades | 1230 |
| Lots for ~₹500 avg | **~2.5–3** |

Id: `donch-retest-or-mid-2r` · **Nifty/Bank Paper+Live default**

### Deployed default (profit-protect + multi-entry, 2026-07-22)

Live defaults:

| Setting | Value |
|---|---|
| `targetRMultiple` | **1.5** |
| `profitProtectEnabled` | **true** |
| `profitProtectArmR` | **1** |
| `profitProtectLockR` | **0** (break-even) |
| `maxTradesPerDay` | **3** (was 1 — avoid one-and-done live days) |

Day stop −60 still caps damage. Display name: **Donch Retest · OR-mid · 1.5R+BE**. Strategy id unchanged.

## Twin (higher green, lower avg)

**Swing-5 retest · EMA50 · 2R · 1t · 09:45–15:10**

- Green **53.1%** · ge500 **49.4%** · avg ₹149 · median traded **+483**
- Id: `swing-retest-ema50-2r` (selectable)

## Why this beats VolExpand / Inside Break for “daily”

| | VolExpand | Inside Break | **Donch Retest 2R** |
|---|---:|---:|---:|
| Green cal % | 14% | 37% | **51%** |
| Median traded | deep red | deep red | **+₹106** |
| Avg @ 1 lot | ₹561 | ₹578 | ₹195 |
| Path to ₹500 | 1 lot | 1 lot | **~3 lots** |

VolExpand wins raw expectancy per trade; **retest+2R wins day-consistency**.

## Still honest

- Not green every day (~half of days still red/flat).
- Worst day still ~−₹3300 at 1 lot (day stop 60 pts) — size carefully.
- Futures/index proxy research; options theta not modeled here.
- **Does not transfer to stocks** — see doc **21** (NO_GO vs GAP_FADE_500).

## Reproduce

```bash
python3 scripts/sr-pullback-retest-daily500.py
# → /tmp/sr-pullback-retest/summary.json
```
