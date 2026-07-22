# 22 — Ruler ₹1,500/session training (1 lot)

## Decision

**NO_GO for the combined target.** Do not change Angular Ruler yet.

At one lot, the available Nifty + Bank books can exceed ₹1,500 average per
market session, or they can be restricted to at most three red sessions per
month. No causal recipe found here does both out of sample.

## Exact target

- Nifty ₹65/point + Bank ₹30/point
- one lot
- average at least ₹1,500 over **all market sessions**, including STAND days
- no more than three red sessions in **any** month
- causal morning inputs available by 09:45

## Validation design

The search does not select on the latest period:

| Window | Use |
|---|---|
| 2020–2023 (978 sessions) | train |
| 2024–2025 (490 sessions) | validation |
| 2026 through July 21 (133 sessions) | untouched test |

`scripts/ruler-1500-daily-search.py` searched **25,200** combinations:

- five existing Ruler ARM books
- any / wide / very-wide opening ranges
- seven morning-drive thresholds
- five gap thresholds
- optional EMA trend and calm-regime requirements
- fixed and dyn0 loss caps at ₹500 / ₹1,000 / ₹1,500
- unrestricted trading or a hard three-red-session monthly breaker

## Result

**Joint hits: 0 / 25,200** on both train and validation.

| Policy | Train avg/session | Validation avg/session | 2026 avg/session | Red-session result |
|---|---:|---:|---:|---|
| Current Ruler | ₹967 | ₹1,322 | ₹1,482 | avg 7.5 / 8.6 / 8.4 per month |
| Best stable ≥₹1,500: non-choppy Donch trail, dyn0 ₹500 | ₹1,876 | ₹1,542 | ₹3,005 | avg 9.9 / 11.4 / 11.1; max 15 / 17 / 14 |
| Best max-3-red: wide + drive≥0.4 Donch trail, dyn0 ₹500, lock after 3 reds | ₹301 | ₹749 | ₹274 | max 3 every month |

The high-average policy works through many capped losses plus occasional large
trail winners. It is **not** a ₹1,500 daily-income policy: validation still has
about eleven red sessions per month.

The max-three-red policy stops early after losses and misses later fat-tail
winners. Its average is far below target and unstable in the untouched 2026
test.

## Angular comparison

The existing Angular DNA replay for 2025-01-01 through 2026-07-21 reports:

- 378 / 378 morning ARM choices match research
- Angular day-capped score ₹503,264
- research day-capped score ₹496,300
- Angular average **₹1,331/session**, below ₹1,500
- zero red research months

The ₹6,963 score difference is fill simulation, not a router mismatch. This
confirms that the current Angular code does not already satisfy the target.

## Upper bound

An oracle that chooses the best ARM after seeing each day's outcome averages
₹3,748 train, ₹3,573 validation, and ₹4,521 in 2026. This proves the books
contain enough payout, but it is look-ahead and cannot be traded. The missing
piece is a causal morning signal that reliably identifies those winning ARM
days.

## Important cap warning

The search uses completed daily ARM books and then clips the day's loss. The
app now uses an intraday hard flatten. A research winner must pass the slower
Angular replay before deployment; soft-clipped totals alone are not enough.

## Reproduce

```bash
python3 scripts/ruler-1500-daily-search.py
```

Full output:

```text
/tmp/ruler-1500-daily-search/report.json
```

## Next safe choice

1. Keep current Ruler: lower all-history average, zero red research months.
2. Optimize for ₹1,500 average and accept roughly 10–11 small red sessions per
   month, then verify intraday Angular fills.
3. Keep the three-red-session requirement and accept that the evidenced
   average is currently below ₹1,500.

Do not label option 2 as “₹1,500 per day”; it is only a long-run mean driven by
fat-tail winners.
