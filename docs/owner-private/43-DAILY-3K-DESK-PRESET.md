# 43 — Daily ₹3k Trade Desk preset

**Date:** 2026-08-04  
**Build:** v1.3.50 · `daily-3k-desk-preset`  
**UI:** Trade Desk → **Apply Daily ₹3k**  
**Artifact:** `reports/daily-profit-research/desk-3k-target.json` (gitignored)

## Ask

> Tomorrow I need ₹3000 min — strategy with Nifty 50, Bank Nifty, Crude Oil Mini.

## Honest answer

No DNA guarantees ₹3,000 every calendar day. Index option fills ≠ cash proxy.  
Goal = **raise hit-rate for ≥₹3k days** while keeping worst-day damage bounded.

## Wired preset

| Book | Strategy | Lots |
|---|---|---:|
| Nifty 50 | S/R Trap + Confirm (peak-trail arm₹400) | **2** |
| Bank Nifty | S/R Trap + Confirm (same DNA) | **2** |
| Crude Oil Mini | Selective (SL20/TP40 · eve · max 2/day) | **1** |
| Nat Gas | Off | — |
| Kutty | Off | — |

Risk toggles on apply: **strict day stop −₹2,950** · **day profit lock +₹5,000**.

## Research (cash-day overlap proxy)

| Lots N/B/C | Avg ₹/day | ≥₹3k days | Worst |
|---|---:|---:|---:|
| 1/1/1 | ~3046 | **42%** | ~+28 |
| **2/2/1** | **~6521** | **71%** | **~−868** |
| 3/2/1 | ~8298 | 77% | ~−1282 |

Crude often contributes **0** on a given cash day; most of the ₹3k path is index Trap. Evening Selective can still add (≤2 fills).

## Tomorrow checklist (Wed session)

1. Open Trade Desk → click **Apply Daily ₹3k**.  
2. Confirm Active Strat = **Trap** (not Genie) on Nifty + Bank.  
3. Start Live (paper first if you want a dry run).  
4. Do **not** expect a fill every hour — Trap needs arm + next-bar confirm.  
5. Crude fires evening window (18:30–21:00 IST) when Selective setup prints.

## Do not

- Loosen Trap next-bar confirm for “more fills.”  
- Switch Crude back to unlimited All-Green as desk default.  
- Treat proxy ≥₹3k% as a live guarantee.
