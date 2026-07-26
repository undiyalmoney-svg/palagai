# 30 — Zone pullback micro-scalp (“2% many times”)

**Date:** 2026-07-26  
**Chart:** Smart Pullback PRO (demand/supply boxes + PULLBACK BUY/SELL) on Nifty 5m  
**Script / output:** `scripts/zone-pullback-micro-scalp-hunt.py` · `reports/zone-micro-scalp/summary.json`  
**Book proxy:** Nifty pts × ₹65 (same lot proxy as other hunts)  
**Walk-forward:** train 2020–2023 · test 2024–Jul 2026  
**GENIE:** left unchanged

## What the chart is doing

The friend’s sample is **not** GENIE (few trades, big R). It is:

1. **Impulse candle** births a green demand / red supply box  
2. Price **leaves** the box  
3. **First retest** into the box + rejection candle → entry  
4. **Stop** just beyond the zone (tiny risk)  
5. **Target** small (~6–12 Nifty pts ≈ ~2% of ATM option premium at δ≈0.5)  
6. Repeat whenever another box retests

That matches “many small wins, very little loss” *on a good day* — labels everywhere on the screenshot.

## Hunt DNA (what we coded)

| Piece | Rule |
|-------|------|
| Zone birth | Body ≥ 1.5–2.0 × avg body(10) |
| Tradeable | Age ≥ 3 bars · left zone by 8–15 pts · first touch only |
| Invalidate | Close breaks through zone |
| Entry | Touch + rejection (bullish in demand / bearish in supply) |
| Stop | Zone extreme ± 2 pts (not a fixed fat SL) |
| Target | Fixed 8–12 pts **or** 1.5–2R |
| Day book | Optional bank & quit (e.g. +12 / −20 pts) |

Also tested Pine-style **EMA50 touch pullback** with the same small TP/SL.

## Verdict (honest)

**“Daily profit with almost no losses” does not survive walk-forward on Nifty 5m.**

| Style | OOS picture | vs GENIE (~₹523/day combo) |
|-------|-------------|----------------------------|
| Take **many** zone retests | Edge thin or negative; high trade-days still ~20% red | Far worse |
| Take **rare** selective long-only zone | Small edge (e.g. ~₹7–16/day, PF ~1.5–1.8) but only **~5–9% of days** traded | Tiny money |
| Best “more opportunities” both-halves | ~**38%** days traded · green **17%** · red **20%** · ~₹16/day | Still ~30× smaller than GENIE |

So:

- The **pattern on the chart is real** (impulse → box → pullback).  
- The **edge is not** “use all opportunities, never lose.” That is cherry-picked day + survivor bias.  
- Tight zone stops **help** vs fixed fat SL (fixed-SL versions bled).  
- Selectivity (strong impulse, leave-then-retest, long-only) **raises PF** but **kills frequency** — opposite of the friend’s pitch.

## Best partial DNA found (research only — not wired)

**Selective long demand:** `imp2.0 · leave15 · TP12 · maxRisk10 · any/long`  
- OOS ~₹9.5k total · ~₹16/day · green 4.4% · red 4.1% · traded 8.5% · PF 1.76  

**More opportunities:** `imp1.5 · leave8 · 1.5R · maxRisk10 · both`  
- OOS ~₹9.9k · ~₹16/day · green 17% · red 20% · traded 38% · PF modest  

Neither approaches GENIE on net, avg/day, or reliability.

## Why the friend can still “look” unbeatable

1. **One chart day** with a clean trend + many labels ≠ multi-year expectancy.  
2. **Options 2%** on a winner feels huge; losers + theta + spread are invisible on an index chart.  
3. **Bank & quit** on a green morning hides afternoon wipeouts (we already saw this help Crude more than Nifty micro-scalps).  
4. Proof screenshots usually show **wins**, not the full ledger.

## Recommendation

| Goal | Action |
|------|--------|
| Keep making serious ₹ | Stay on **Align Combo · GENIE** |
| Keep hunting “2% scalp” | Need **his exact filters** (time, weekday, only-with-trend, option exit rules) — chart alone is not enough |
| Wire this DNA | **No** — edge too small / too rare vs GENIE |

Token was available for live candles; hunt used existing `nifty-5m-2020-2026` cache (no live API burn).
