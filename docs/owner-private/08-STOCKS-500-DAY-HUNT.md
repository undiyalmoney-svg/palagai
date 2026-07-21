# Stocks ₹500/day hunt (honest)

**Date:** 2026-07-21  
**Method:** open-only rank (gap size) · **no EOD look-ahead** pick  
**Book:** APOLLOHOSP, BRITANNIA, CIPLA, HDFCLIFE, NESTLEIND, NTPC, SUNPHARMA, TATACONSUM  
**Capital:** ₹60,000 · day loss clip −₹2,400

## Verdict — FOUND

Fade **≥0.3% gap-ups** on the 8-name book · **stop 1.5%** · **risk 2.5%** · **max 3** names/day (largest gaps first).

| Metric | Value |
|--------|-------|
| Avg / weekday (calendar) | **₹522** |
| Avg / signal day | ₹640 |
| Green signal days | 57.5% |
| Days hitting ≥₹500 | 48.8% |
| Worst day (clipped) | −₹2,400 |
| Sample | 2020-01 → 2026-07 · ~1320 signal days / 1618 weekdays |

DNA: `GAP_FADE|g0.003|s0.015|t0|r0.025|wALL|max3`  
Desk default: **`GAP_FADE_500`**

Safer twin (slightly lower size): `g0.003|s0.012|r0.02|max3` → cal ₹513 · green 57.8%.

## Caveats
- Not every weekday is green — expect ~43% red/flat signal days.
- Tiny 0.3% gaps fire often; slippage/costs not modeled — paper first.
- An earlier “₹1800/day” basket was **invalid** (picked winners using EOD |P&L|) and was discarded.

## Files
- `reports/stocks-500-day-honest.json`
- `scripts/research-stocks-500-honest.ts`
- Desk: strategy `GAP_FADE_500` + max-3 gap rank
