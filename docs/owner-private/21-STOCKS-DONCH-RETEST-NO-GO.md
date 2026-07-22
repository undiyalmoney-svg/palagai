# 21 — Donch Retest on stocks? **NO_GO**

**Date:** 2026-07-22  
**Script:** `scripts/stocks-donch-retest-check.py`  
**Book:** treasure 8 (APOLLOHOSP … TATACONSUM) · capital ₹60k · risk 2.5% · max 3/day  
**Data:** Yahoo daily OHLC (Kite token expired); 5m spot ~60d on 4 names

## Verdict — **NO_GO for stocks**

Donch Retest · OR-mid · 2R is an **index** DNA. On equities it loses; **GAP_FADE_500** remains the stocks path.

| Strategy (OOS 2024+) | Avg ₹/day | Green among traded | Days ≥ ₹500 | Net ₹ |
|---|---:|---:|---:|---:|
| **GAP_FADE_500** | **+414** | **58.5%** | 38.2% | **+262k** |
| Donch Retest 2R (daily adapt) | **−84** | 35.6% | 10.6% | **−53k** |
| Swing Retest 2R | +12 | 43.5% | 12.3% | +7.6k |

5m spot (Yahoo ~60d, 4 names): Donch avg **−₹178**/traded day — still red.

## What to run

| Channel | Strategy |
|---|---|
| Nifty / Bank | **Donch Retest · OR-mid · 2R** |
| Stocks Desk | **GAP_FADE_500** (unchanged) |
| Stocks Strategy Manager | Do **not** use Donch Retest (removed from stocks supports; default VolExpand placeholder only) |

## Reproduce

```bash
python3 scripts/stocks-donch-retest-check.py
# → /tmp/stocks-donch-retest/summary.json
```

Refresh Kite token later for a full equity 5m replay if desired — daily + 5m spot already agree on NO_GO.
