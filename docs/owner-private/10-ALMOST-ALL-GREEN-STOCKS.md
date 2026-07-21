# Almost-all-days green (stocks EOD)

**Date:** 2026-07-21  
**Book:** treasure 8 · 106k+ combos · honest open rank  
**Sample:** 2020-01 → 2026-07 (~1618 weekdays)

## Hard truth
**Every weekday green is not available** on day-bar equity with ₹60k (no look-ahead).  
Ceiling found: **~70% of all weekdays green**, or **~89% green when we cherry-pick rare signals**.

## A) Max green when we trade (sit out often)
`GAP_BOUNCE` · gap≥0.8% · stop 2.5% · TP 0.6% · max 1 · **Tue+Wed only** · prior range≥1.5%

| Metric | |
|--------|--|
| Signal green | **89.3%** |
| Red streak max | **1** |
| Coverage | only **~7%** of weekdays |
| Avg / signal | ₹179 |

→ Great win-rate, **not** almost every day.

## B) Best “almost every day” (ship this) — `ALMOST_GREEN_MIX`
`MIX_GAP` · gap≥**0.5%** either way · stop **2.5%** · TP **0.5%** · risk 2.5% · **max 1** name (largest gap) · all weekdays

| Metric | |
|--------|--|
| Signal green | **~82%** |
| **Calendar green** (every weekday) | **~70%** |
| Coverage (we trade) | **~86%** of weekdays |
| Avg / weekday | ~₹25–55 (small TP by design) |
| Worst day | ~−₹1,500 |
| Max red streak | ~5 |

### Rules
1. At open, scan treasure book for gap ≥0.5% up **or** down.  
2. Take **one** name: largest |gap|.  
3. Gap-up → **SELL** · Gap-down → **BUY**.  
4. Exit at **+0.5%** target or **−2.5%** stop or EOD.  
5. No gap → **sit out** (flat).

## Operating principle
**Selectivity buys green rate. Forced daily trades destroy it.**

JSON: `reports/almost-all-green-hunt.json`
