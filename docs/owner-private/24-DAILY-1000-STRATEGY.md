# 24 — Daily ₹1,000 profit strategy

**Date:** 2026-07-22  
**Script:** `scripts/daily-1000-strategy-search.py`  
**Data:** 5m caches 2020–2026 · Nifty ₹65/pt + Bank ₹30/pt · **1 lot**  
**Walk-forward:** train 2020–2023 · validation 2024–2025 · untouched test 2026 through cache end

## Decision

**GO — bring the deployed Ruler flow (v1.12).**

That is already the Nifty/Bank Paper + Live default (`ruler-flow`). No DNA swap in this pass.

| Window | Avg ₹/session | Red months | Max red sessions/month | Days ≥ ₹1,000 |
|---|---:|---:|---:|---:|
| Train 2020–2023 | **967** | 0 | 12 | 26.7% |
| Validation 2024–2025 | **1,322** | 0 | 12 | 28.4% |
| Test 2026 | **1,482** | 0 | 11 | 30.8% |
| Full 2020–2026 | **1,119** | 0 | — | — |

Train alone sits just under ₹1,000 because beast / hunter / STAND / edge skip many sessions on purpose. Validation, 2026, and the full cache clear the average target while keeping **zero red months**.

## What “daily ₹1,000” means here

- **Yes:** about ₹1,000 **average** per market session at 1 lot after the −₹500 day-cap.
- **No:** ₹1,000 **every** calendar day. Median session is ₹0 (many STAND / flat days). Only ~27–31% of sessions print ≥ ₹1,000. Fat right tail pays the average.

Earlier consistency work (doc **19**) already showed “green every day at ₹500+” is not available on Nifty+Bank at 1 lot.

## Alternatives checked

| Candidate | Train | Valid | 2026 | Notes |
|---|---:|---:|---:|---|
| **Current Ruler v1.12** | 967 | 1,322 | 1,482 | **Brought** — already live |
| Always Donch trail · dyn0 ₹500 | 1,876 | 1,542 | 3,005 | Higher average, **0** red months, but median −₹500 OOS and up to **17** red sessions/month |
| Wide-only Donch trail | 988 | 1,364 | 2,781 | Red months on train |
| Always Donch 2R | 722 | 1,096 | 1,275 | Below train target |
| Always Swing 2R | 812 | 1,029 | 851 | 2026 under |
| Always Donch 1.5R | 619 | 921 | 1,009 | Under on train/valid |
| Pure sniper fixed TP/SL | — | — | — | **NO_GO** (doc **23**) |
| Trailing sniper (small SL) | ~₹150–300 | — | often negative | **NO_GO** — does not hold ₹1k across windows |

Always-Donch-trail is the only shortlist book that hard-clears ₹1,000 on **both** train and validation with zero red months. It is **not** deployed here: soft end-of-day clips still need Angular hard-flatten parity, and the daily experience is worse (more capped red days). Keep the Ruler router unless a later Angular replay proves a safer swap.

## How to run it in the app

1. Trade Desk → Nifty / Bank  
2. Strategy = **Ruler flow** (default Paper + Live)  
3. Lots = **1** (research DNA)  
4. Testing and Live both enforce −₹500/day stop + flatten  

Recipe (unchanged v1.12):

1. While 0 ≤ MTD < ₹3,000 → beast witch  
2. While MTD < 0 → hunter recover  
3. Else → Donch trail on wide mornings (else 2R / swing) — **no month bank**  
4. After 2 clipped red days → edge witch for rest of month  
5. Shared arm for Nifty + Bank  

## Reproduce

```bash
python3 scripts/daily-1000-strategy-search.py
# → /tmp/daily-1000/report.json
```

Requires the shared helper `/tmp/ruler-profit-boost.py` used by other Ruler research scripts.

Related: doc **22** (₹1,500 + ≤3 red sessions/month = **NO_GO** joint target).
