# 28 — Align Combo · GENIE (Nifty + Bank together / alone)

**Date:** 2026-07-23  
**Strategy id:** `align-combo-genie`  
**UI name:** **Align Combo · GENIE**  
**Book:** 1 lot Nifty + 1 lot Bank (index DNA; map SELL → PE / BUY → CE on desk)

## What this is

The strategy for the playbook you showed: **both indices dumping → short the move together**; if only one is clear, trade that leg alone; if chop, skip.

| Mode | When | Action |
|---|---|---|
| **BOTH** | Nifty + Bank same bias (aligned) | Trade **combo** in that direction |
| **NIFTY** / **BANK** | One leg stronger OR-drive | Trade **alone** |
| **SKIP** | Tuesday / weak morning drive / chaos | Sit out |

### Example day (your screenshot)

- Nifty −0.56%, Bank −1.11% → **aligned down** → mode **BOTH** / short  
- Entry: break lower (structure short)  
- SL: above swing high (red box)  
- Target: R-multiple into the green zone  
- Desk option map: SELL index → **PE** (like NIFTY 24200 PE +₹35k day — size differs; futures 1+1 is the researched proxy)

## DNA (same proven legs as Smart PB GENIE)

| Leg | Entry | Exit | Caps |
|---|---|---|---|
| Nifty | Pine breakout + strong + close-third + OR-mid | **3R** | 2t · 10:15–14:30 |
| Bank | Armed Donch retest + OR-mid | **1.5R** | 1t · bias-sync to Nifty |

GENIE v3 weekday gates: Tue SKIP · Fri BOTH · Mon/Wed drive floors · Thu align→alone.

OOS (Kite 5m 2024+ @ 1+1): **~₹507/day**, red **~34%** (vs ~49% always-combo), coverage ~71%.

## How to run

1. **Strategy Manager** → Nifty / Bank / Stocks → pick **Align Combo · GENIE** for Paper (also sets Live on that channel).  
2. **Trade Desk** (Nifty/Bank): Testing uses Paper assignment; Live uses Live assignment.  
3. **Stocks Desk**: choose **Align Combo · GENIE** in the strategy dropdown (paper Testing + Live). Default remains GAP_FADE_500.  
4. After OR on index (~09:45), optional peer extras: `geniePeerDrive`, `genieNiftyBias`.  
5. Does **not** replace Donch Retest or GAP_FADE_500 defaults.

## Code

- Module: `align-combo-genie.managed-strategy.ts`  
- Engine: `smart-pullback-pro.engine.ts` (`resolveGenieV3Route`)  
- Twin research name: `smart-pullback-pro` (same DNA)
