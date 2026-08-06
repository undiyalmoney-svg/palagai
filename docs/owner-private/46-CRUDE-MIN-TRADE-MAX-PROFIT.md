# 46 — Crude min-trade max-profit DNA

**Date:** 2026-08-06  
**Build:** v1.3.63 · `crude-trap-profit`  
**Script:** `scripts/crude-min-trade-max-profit-hunt.py`  
**Cache:** `reports/analyst-cache/crudeoilm-5m-merged.json` (2026-03-23 → 2026-08-04)  
**Charge model:** ₹50 / round-trip · ₹10/pt · 1 lot

## Ask

> Big Crude profits all day (long session). Not many trades — even 4 with 3 good is enough.  
> Charges must not burn. After a huge green day, next trade must not drain.  
> Profit + profit with min trades. Research OK — ship a profitable DNA.

## Why unlimited SL30/TP60 failed

| DNA (full sample after ₹50/RT) | tpd | net ₹/day | green | ≥₹1k |
|---|---:|---:|---:|---:|
| **wired unlimited SL30/TP60** | **9.2** | **−306** | 33% | 11% |
| old max2 SL30/TP60 | ~2.0 | ~−70 (OOS) | ~59% | low |

Many fills → charges win. Need **few, larger** winners.

## Winner (wired as Trade Desk Selective)

```
entry:   Crude Trap + confirm (swing S/R · pierce 0 · trap+bounce)
SL/TP:   50 / 200 pts  (= ₹500 / ₹2,000)
window:  10:00–23:00
max/day: 4
day lock: +100 pts (= ₹1,000) — stop hunting after solid green
day stop: OFF
trail:   OFF
```

| Sample | net ₹/day | tpd | green | ≥₹1k | PF |
|---|---:|---:|---:|---:|---:|
| Full (87d) | **~347** | **2.1** | **61%** | **40%** | 1.71 |
| OOS (~29d) | ~289 | 2.2 | 65% | 29% | 1.61 |
| IS (~67d) | ~362 | 2.0 | 59% | 45% | 1.76 |

One TP hit (~₹2k) can lock the day before a later SL drains it. Median ~2 fills/day — charge-safe vs 9+.

## Not chosen

| Idea | Why not |
|---|---|
| Unlimited / All-Green | Charge burn (doc 41) |
| Session-OR SL50/TP200 evening-only | Full-sample net only ~₹26/day |
| Max 3 instead of 4 | Lower net ₹/day (~285) |
| Day lock ₹2k | Slightly worse net; more late losers |

## Ops

1. Deploy **v1.3.63**.  
2. Trade Desk → Crude on (Nifty/Bank optional) → Stop → Start Live money.  
3. Expect ≤4 Crude fills; after ~+₹1k day net on Crude book, it stands down.
