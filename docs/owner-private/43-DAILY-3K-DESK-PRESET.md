# 43 — Daily ₹1k–₹3k with **1 lot** (hunt answer)

**Date:** 2026-08-04  
**Build:** v1.3.54 · `desk-defaults`  
**UI:** Trade Desk loads Daily ₹1k–₹3k by default (no Apply button)  
**Scripts:** `scripts/desk-1lot-1k-3k-hunt.py` · `scripts/desk-3k-floor-hunt.py`  
**Artifacts:** `reports/daily-profit-research/desk-1lot-1k-3k-hunt.json` (gitignored)

## Ask

> Need ₹1,000–₹3,000 with **one lot**. Hunt until you find that DNA.

## Answer (wired)

**1-lot DNA found.** Not a hard every-day floor (~5% zero-fill), but the best robust ≥₹1k hit-rate at lots **1/1/1**.

| Book | DNA | Lots |
|---|---|---:|
| Nifty 50 | Trap + confirm · **pierce 10** · peak-trail **arm₹150** · **soft OFF** · **2R** | **1** |
| Bank Nifty | same | **1** |
| Crude Oil Mini | Selective **SL30/TP60** · **10:00–22:00** · max 2/day · confirm | **1** |

Desk defaults: **day profit lock +₹3,000** on · **strict day stop** off (opt in) · Nat Gas/Kutty off.

## Research evidence

### Index OOS (2025-01-01→2026-08-04, 1 lot N+B)

| DNA | ≥₹1k% | P10 | Avg | Worst | tpd |
|---|---:|---:|---:|---:|---:|
| prior pierce5 arm₹400 softON | 74.9% | 0 | 2634 | −1012 | 2.7 |
| pierce6 arm₹200 softOFF | 82.7% | 211 | 3300 | −825 | 2.9 |
| pierce8 arm₹200 softOFF | 86.3% | 466 | 3696 | −398 | 3.3 |
| **pierce10 arm₹150 softOFF** | **88.6%** | **823** | **4256** | **−77** | **3.7** |
| pierce12 arm₹150 softOFF | 89.6% | 908 | 4625 | −77 | 4.1 |

IS 2023–24 for pierce10: ≥₹1k **90.5%** · P10 **₹1,027** (holds OOS).

Jul–Aug 2026 (1 lot): **100%** days ≥₹1k · P10 ~₹2,973.

### Desk overlap + Crude SL30/TP60 (1/1/1)

| | ≥₹1k% | P10 | Avg | Worst |
|---|---:|---:|---:|---:|
| raw | ~87–89% | ~700 | ~4.2–4.6k | ≥ −700 |
| + day lock ₹3k | ~87–89% | ~700 | ~₹2.4k | same |

Day lock ₹3k puts hit days into the **₹1k–₹3k band**.

## Why not 100% every day

~5–6% calendar days still have **zero Trap confirms** → ₹0. No DNA in 20k+ 1-lot configs made P10 ≥ ₹1,000 on the full overlap window. Closest floor-ish: OOS index P10 **₹823** (pierce10).

## Tomorrow checklist

1. Deploy **v1.3.54**.  
2. Open Trade Desk — defaults already armed (Trap · 1/1/1 · day lock +₹3,000 · strict stop off).  
3. Start Live.

## Wired changes (v1.3.52)

1. Trap DNA → pierce**10** · peak**150/75/75** · soft **OFF** · RR**2** (strat storage **v23**).  
2. Crude Selective → SL**30**/TP**60** · 10:00–22:00 · max 2.  
3. Desk day profit lock **₹5,000 → ₹3,000**.  
4. Preset lots **1/1/1**.
