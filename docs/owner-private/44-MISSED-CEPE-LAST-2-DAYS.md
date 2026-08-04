# 44 — Missed CE/PE last 2 days (1-lot exact)

**Date:** 2026-08-04 evening  
**Script:** `scripts/missed-opportunity-audit-2d.py`  
**Cache:** Nifty/Bank/Crude 5m (Aug 4 only to **14:20** — afternoon incomplete)

## Friend claim
- Yesterday (Mon 3): **₹3,000**
- Today (Tue 4): **₹4,000**
- Minimal loss

## Exact 1-lot wired DNA (Trap pierce10 + Crude Selective)

| Day | Index ₹ proxy (1/1/1) | Option ~Δ0.5 approx |
|---|---:|---:|
| **Mon 3 Aug** | **₹3,944** | **~₹1,952** |
| **Tue 4 Aug** (to 14:20) | **₹3,519** | **~₹1,504** |

Index proxy **already matches/beats** friend 3k/4k — **if Trap was actually live**.

Paper showing ~₹500 ≈ option premium / partial closes, not “DNA made only ₹500.”

## Why so many CE/PE looked missed

Trap **arms** on a sweep/bounce, then needs **next-bar confirm**. Most “I see a CE/PE buy” moments are **ARM** bars — entry is the **next** bar only if it continues.

### Mon 3 Aug (full day)

| Book | Arms | Entered | Confirm failed | EMA blocked | Catch rate |
|---|---:|---:|---:|---:|---:|
| Nifty | 14 | 4 | **10** | 7 | **29%** |
| Bank | 8 | 2 | **6** | 6 | **25%** |
| Crude | — | 2 | — | — | max 2/day |

### Tue 4 Aug (to 14:20)

| Book | Arms | Entered | Confirm failed | EMA blocked |
|---|---:|---:|---:|---:|
| Nifty | 6 | 4 | 1 | 8 |
| Bank | 1 | 0 | 1 | 8 |
| Crude | — | 1 (−₹350) | — | — |

## If we forced every arm (no confirm)

Mon desk ≈ **₹3,956** (vs ₹3,944 with confirm) but **23** index fills vs **6**.  
Same money, more churn — confirm is **not** the profit leak those two days.

## Live sat silent Mon + Tue

That is **not** “no setups.” Proxy had many arms/fills. Silent live ⇒ Strat on **Genie** (Tue skip + weak Mon) or Trap DNA not loaded.

## Friend-style OR-break (different DNA)

OR-break PE crushed Tue dump (Nifty alone ~₹9.6k index proxy) but was **weak/red Mon**. Not a safer replacement for Trap.

## Action

1. Confirm build **v1.3.52** + Active Strat = **Trap**  
2. Compare **Index ₹** on desk to friend, not only Option ₹  
3. Do **not** disable confirm to chase every CE/PE candle  
