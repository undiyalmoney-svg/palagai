# 43 — Daily ₹3k Trade Desk preset (hunt answer)

**Date:** 2026-08-04  
**Build:** v1.3.51 · `daily-3k-hunt-answer`  
**UI:** Trade Desk → **Apply Daily ₹3k**  
**Scripts:** `scripts/desk-3k-floor-hunt.py` · `scripts/daily-profit-upgrade-hunt.py`  
**Artifacts:** `reports/daily-profit-research/desk-3k-floor-hunt.json`, `desk-3k-answer.json` (gitignored)

## Ask

> Tomorrow I need ₹3000 min — strategy with Nifty 50, Bank Nifty, Crude Oil Mini.  
> Hunt until you get the answer.

## Answer

**A guaranteed ₹3,000 every calendar day does not exist** in this DNA family.

| Why | Evidence |
|---|---|
| Zero-fill days | ~9–15% of OOS index days have **no** Trap confirm → ₹0 |
| Red traded days | 16/334 OOS traded days are red; scaling lots makes them worse |
| Crude alone | Selective avg ~₹98/day on MCX sample — cannot carry a ₹3k floor |
| Hard floor search | **0 / 14,850** configs had P10 ≥ ₹3,000 |

## Best bounded answer (wired)

Maximize % days ≥ ₹3k subject to worst ≥ −₹1,500 (cash-day overlap proxy, after fill costs):

| Book | DNA | Lots |
|---|---|---:|
| Nifty 50 | Trap + confirm · **pierce 5** · peak-trail arm₹400 · soft 0.45R | **5** |
| Bank Nifty | same | **3** |
| Crude Oil Mini | Selective SL20/TP40 · **10:00–22:00** · max 2/day · confirm | **1** |

| Metric (overlap proxy) | Value |
|---|---:|
| Days ≥ ₹3k | **~79%** |
| Avg ₹/day | **~₹11.4k** |
| Worst day | **~−₹1,115** |
| Green% | **~96%** |

Safer alt (not default): lots **4/2/1** → ~76% ≥₹3k · worst ~−₹510.

Risk toggles on Apply: strict day stop −₹2,950 · day profit lock +₹5,000 · Nat Gas/Kutty off.

## Wired DNA changes (v1.3.51)

1. Trap `piercePts` **3 → 5** (strat storage **v22**).  
2. Crude Selective entry window **18:30–21:00 → 10:00–22:00** (still max 2/day).  
3. Daily ₹3k preset lots **2/2/1 → 5/3/1**.

## Tomorrow checklist

1. Deploy build **v1.3.51**.  
2. Trade Desk → **Apply Daily ₹3k**.  
3. Confirm Active Strat = **Trap** · lots N×5 B×3 C×1.  
4. Start Live.  
5. Expect some flat/red days — hunt answer is hit-rate, not a floor.

## Do not

- Loosen Trap next-bar confirm for “more fills.”  
- Switch Crude to unlimited All-Green.  
- Treat ~79% as a live guarantee.
