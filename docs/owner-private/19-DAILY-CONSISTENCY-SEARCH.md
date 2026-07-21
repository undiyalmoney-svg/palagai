# 19 — Daily ₹500 consistency search (Nifty + Bank)

**Date:** 2026-07-21  
**Script:** `scripts/daily-consistency-search.py`  
**Data:** 5m caches 2020–2026 · **OOS calendar days 2024+** (623 days)  
**Money:** Nifty ₹65/pt + Bank ₹30/pt · 1 lot each when both fire

## Goal

Find an index strategy that approaches **₹500 every trading day** (green-day coverage / days ≥ ₹500), not only peak trade expectancy.

## Honest verdict

**No directional Nifty+Bank strategy in this search is green every calendar day.**  
None has a **positive median traded day** — averages are fat-right-tail (big winners, many red days).

| Goal | Best pick | OOS snapshot |
|------|-----------|--------------|
| **Average ~₹500 / calendar day** (keep expectancy) | **VolExpand Donch15 · EMA50 · EOD · 10:15–11:30 · 1t** (current default) | avg **₹561** · green cal **13.8%** · cov **61%** · ge500 **13.5%** · n=569 |
| **Max green-day / days ≥ ₹500 share** | **Inside Break · no bias · EOD · multi-trade · full session** | avg **₹578** · green cal **37.2%** · cov **99.7%** · ge500 **35.3%** · med **−₹2596** · worst **−₹5651** · n=2358 |
| **Avg nearest ₹500 + decent green** | Donch15 · OR-break bias · EOD · multi-trade | avg **₹521** · green **31.6%** · cov **95.8%** |
| **True day-consistency (equities)** | Stocks Desk **GAP_FADE_500** (doc 08) | ~**57%** green signal days · cal avg ~₹522 |

## How to read the rankings

- Raising **green-day %** on indices means **more trades / fuller session** (mom, swing, inside-break multi-trade). That lifts the share of days that print ≥ ₹500 but **deepens the red median** and worst day.
- VolExpand’s calendar green % looks low because many days have **no trade** (median ₹0). Among traded days it is still only ~23% green — it wins on **size of winners**, not frequency.
- Regime filter on VolExpand (doc 18) raises expectancy / Mar‑26 but **does not** fix daily green rate (cov falls to ~43%).

## Recommendation

1. **Keep VolExpand as default** if the ask is “about ₹500 **on average** per trading day” at 1 lot Nifty+Bank.
2. **Paper Inside Break** (`inside-break-eod` in Strategy Manager) if the ask is “be green / hit ₹500 **as often as possible**” — expect ~1 in 3 calendar days ≥ ₹500 and many deep red days; size down or keep day stop tight.
3. For **highest researched green-day rate** toward ₹500/day, use **Stocks GAP_FADE_500**, not index breakouts.

## Wired in app

- Module: `InsideBreakManagedStrategy` · id `inside-break-eod`
- Selectable in Strategy Manager / backtest registry · **not** assigned as Paper/Live default

## Reproduce

```bash
python3 scripts/daily-consistency-search.py
# → /tmp/daily-consistency/summary.json
# → reports/daily-consistency-summary.json (local; /reports/ is gitignored)
```

Universe helper: `scripts/strategy-universe-search.py` (research).
