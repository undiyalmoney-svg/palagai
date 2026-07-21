# Stocks daily-profit king hunt (NSE EQ)

**Date:** 2026-07-21T01:55:37.666Z
**Capital:** ₹60000 · risk/trade ~₹1200 · day loss idea −₹2400
**Sample:** 2025-01-01 → 2026-07-20 · 54 symbols · 3000ms between API fetches
**JSON:** `reports/stocks-daily-king-hunt.json`

## Verdict
Best realistic band is ~55–65% green with positive expectancy — use treasure watchlist + hard day stop.

| Band | Count |
|------|-------|
| Profitable strategies | 176 |
| Green days ≥70% | 0 |
| Green days ≥60% | 12 |
| Green days ≥55% | 23 |

## Treasure watchlist (desk defaults)
1. **BRITANNIA** · GAP_UP_FADE · green 67.9% · net ₹21459 · worst day ₹-1080 · 53 days
2. **TATACONSUM** · GAP_DOWN_BOUNCE · green 67.2% · net ₹36912 · worst day ₹-1077 · 64 days
3. **NTPC** · GAP_UP_FADE · green 66.7% · net ₹35800 · worst day ₹-1080 · 60 days
4. **HDFCLIFE** · GAP_DOWN_BOUNCE · green 65.7% · net ₹26224 · worst day ₹-1080 · 70 days
5. **SUNPHARMA** · GAP_DOWN_BOUNCE · green 64.4% · net ₹17296 · worst day ₹-1079 · 45 days
6. **CIPLA** · GAP_UP_FADE · green 64.3% · net ₹8614 · worst day ₹-1079 · 42 days
7. **NESTLEIND** · GAP_DOWN_BOUNCE · green 64% · net ₹18607 · worst day ₹-1080 · 50 days
8. **APOLLOHOSP** · GAP_DOWN_BOUNCE · green 63% · net ₹25613 · worst day ₹-1076 · 54 days

## Top by score
1. BRITANNIA GAP_UP_FADE · green 67.9% · ₹21459 · worst ₹-1080
2. TATACONSUM GAP_DOWN_BOUNCE · green 67.2% · ₹36912 · worst ₹-1077
3. NTPC GAP_UP_FADE · green 66.7% · ₹35800 · worst ₹-1080
4. HDFCLIFE GAP_DOWN_BOUNCE · green 65.7% · ₹26224 · worst ₹-1080
5. SUNPHARMA GAP_DOWN_BOUNCE · green 64.4% · ₹17296 · worst ₹-1079
6. CIPLA GAP_UP_FADE · green 64.3% · ₹8614 · worst ₹-1079
7. NESTLEIND GAP_DOWN_BOUNCE · green 64% · ₹18607 · worst ₹-1080
8. APOLLOHOSP GAP_DOWN_BOUNCE · green 63% · ₹25613 · worst ₹-1076
9. BHARTIARTL GAP_UP_FADE · green 62.7% · ₹18703 · worst ₹-1079
10. POWERGRID GAP_DOWN_BOUNCE · green 61.2% · ₹22995 · worst ₹-1080
11. JSWSTEEL GAP_UP_FADE · green 61% · ₹17410 · worst ₹-1080
12. HDFCBANK GAP_UP_FADE · green 60% · ₹10532 · worst ₹-1079
13. SBILIFE GAP_DOWN_BOUNCE · green 59.7% · ₹17680 · worst ₹-1080
14. NESTLEIND GAP_UP_FADE · green 58.1% · ₹8941 · worst ₹-1076
15. SBIN GAP_DOWN_BOUNCE · green 57.5% · ₹6676 · worst ₹-1080

## Risk rules for ₹60k
- Max ~2% risk per entry (₹1,200)
- Soft day stop ~₹2,400 (4%)
- Prefer MIS equity; size qty from stop distance
- Never all-in one name
