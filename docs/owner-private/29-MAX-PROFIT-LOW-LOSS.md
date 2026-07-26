# Max profit / low loss hunt vs GENIE

**Date:** 2026-07-25  
**Script:** `scripts/max-profit-low-loss-hunt.py`  
**Output:** `reports/max-profit-low-loss/summary.json`  
**Book:** 1 lot Nifty + 1 lot Bank (pts × 65 / × 30)  
**Walk-forward:** train 2020–2023 · test 2024–Jul 2026

## Honest ceiling

Inside the same Smart-PB DNA family (pine_bo Nifty + armed_retest Bank), **no book 2×’d GENIE’s profit while cutting losses**.  
Trade-off is real: more net ↔ more red/drawdown, or smoother ride ↔ slightly less net.

Oracle look-ahead (impossible live) still sits ~₹2,200/day — so the gap is **information**, not a missing indicator.

## GENIE baseline (OOS 2024+)

| Metric | Value |
|--------|------:|
| Net | ₹3,21,283 |
| Avg/day | ₹523 |
| Red days | 35.7% |
| Max DD | −₹34,119 |
| Profit factor | 1.58 |

## Best upgrades found (144 books tested)

### 1) Max profit with *less* drawdown (recommended)

**GENIE v3 · Nifty 3R · Bank 2.5R** (today Bank is 1.5R)

| | GENIE now | **New** |
|--|--:|--:|
| OOS net | 3,21,283 | **3,31,294 – 3,32,644** |
| Avg/day | 523 | **540 – 542** |
| Max DD | −34,119 | **−28,719** |
| Red % | ~34–36 | ~35 |

**Change:** only raise Bank target from **1.5R → 2.5R**. Router stays GENIE.  
Why it works: Bank was leaving money on the table at 1.5R; letting winners run to 2.5R adds ~₹10–11k OOS and **shrinks** drawdown.

### 2) Least pain (smoothest) — if “less loss” matters more than max ₹

**SKIP_WEAK · Nifty 3R · Bank 2.5R**  
(skip Tue + skip if max OR-drive < 0.40; else GENIE-style BOTH/alone)

| | GENIE | SKIP_WEAK B2.5 |
|--|--:|--:|
| OOS net | 3,21,283 | 3,13,260 |
| Avg/day | 523 | 510 |
| Red % | 34% | **27%** |
| Max DD | −34,119 | **−25,199** |
| PF | 1.59 | **1.69** |

Slightly less money, clearly better ride.

### 3) Best efficiency (net / |DD|)

**nifty_first · Nifty 2.5R · Bank 1.5R** — net/dd ≈ 14.6, DD only −₹19.7k, but OOS net lower (~₹2.88L).

## What did *not* work

- Bank-only books → much less net (~₹95–98k OOS)
- Pushing Bank to 3R → more net in-sample, worse OOS DD than 2.5R
- Replacing GENIE router with always-BOTH → more red days
- Profit-protect exits (earlier research) → lower net

## Recommendation

| Goal | Method |
|------|--------|
| **Max profit + less DD** | Keep GENIE router · **Bank target 2.5R** |
| **Fewer red / smaller DD** | SKIP_WEAK router · Bank 2.5R |
| Stay as-is | Current GENIE N3/B1.5 |

**Not wired yet** — wait for owner go-ahead.
