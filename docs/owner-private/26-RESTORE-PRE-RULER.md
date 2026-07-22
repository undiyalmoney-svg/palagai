# Restore pre-Ruler strategies (Donch Retest default)

**Date:** 2026-07-22  
**Branch action:** Remove Ruler; restore last stable index defaults from before Ruler existed (`6bba5ee^`).

## What changed

1. **Removed** `ruler-flow` module, morning util, day-plan / month-state services, Trade Desk Ruler UI, and Ruler research verify scripts.
2. **Restored** Nifty + Bank Paper/Live default to **Donch Retest · OR-mid · 1.5R+BE** (`donch-retest-or-mid-2r`).
3. **Restored** Strategy Manager Paper/Live/Shadow pickers (no Ruler-only lock).
4. Stocks default unchanged: **GAP_FADE_500**.
5. Assignment storage bumped to `v11` so browsers drop Ruler-locked `v10` state.

Crude Desk and unrelated desks kept working (call sites adjusted to restored day-stats / weekday helpers).

## Verification

- `tsc -p tsconfig.app.json --noEmit` — clean  
- Defaults resolve to Donch Retest for nifty/bank paper+live  
- Registry no longer registers Ruler  
- No `ruler-flow` references under `src/`

## Performance comparison (research 5m books, 1 lot, Nifty ₹65 + Bank ₹30)

Honest note: on this **index-points research proxy**, Ruler’s day-capped trail book still prints a higher total than plain Donch 1.5R. The restore follows the owner request to return to the **pre-Ruler product default** (Donch), not to maximize the research score. Live option P&L can diverge from these pts books.

### Full cache 2020-01-01 → 2026-07-21 (1,601 sessions)

| Metric | Restored Donch 1.5R multi (approx.) | Ruler v1.12 (removed) |
|---|---:|---:|
| Total Profit | ₹1,78,995 | ₹17,90,874 |
| Avg Daily Profit | ₹112 | ₹1,119 |
| Win Rate (traded sessions) | 43.8% | 48.1% |
| Profit Factor (sessions) | 1.07 | 6.93 |
| Maximum Drawdown | ₹1,29,009 | ₹4,703 |
| Number of Trades | 9,106 | (session book; ~1.2k traded days) |
| Avg Profit / Trade | ₹19.7 | n/a (day-clipped ARM book) |
| Red months | 40 | **0** |

Donch sim = `donch_retest` · OR-mid · `rr1_5` · multi-trade · 09:45–15:10 (BE lock / day-stop −60 pts in Angular not fully mirrored in this Python approx).

### Recent window 2025-01-01 → 2026-07-21 (378 sessions)

| Metric | Donch 1.5R multi | Ruler v1.12 |
|---|---:|---:|
| Total Profit | ₹20,551 | ₹4,96,300 |
| Win Rate (traded sessions) | 45.1% | 51.7% |
| Profit Factor | 1.04 | 7.74 |
| Max Drawdown | ₹97,533 | ₹2,733 |
| Trades | 2,097 | — |
| Avg / Trade | ₹9.8 | — |

## How to use

1. Open **Strat** → confirm Nifty/Bank Paper + Live = **Donch Retest · OR-mid · 1.5R+BE** (or Reset assignments).
2. Trade Desk Testing / Live paper uses that assignment.
3. Hard-refresh once if an old Ruler assignment was cached.
