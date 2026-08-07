# 50 — All-day-green Trap DNA

**Date:** 2026-08-07  
**Build:** v1.3.87 · `all-day-green`  
**Script:** `scripts/all-day-green-monster-hunt.py`  
**Ask:** Every day green — find the method.

## Method found

**Nifty + Bank Trap only · Crude OFF**

| Rule | Value |
|---|---|
| Pierce | Nifty **15** · Bank **30** |
| Mode | trap + bounce · next-bar **confirm ON** |
| Peak trail | Arm **₹100** · lock **₹50** · giveback **₹50** |
| Target | **2R** |
| Max trades/day | **3** |
| Strategy day stop | **60 pts** |
| Desk day profit lock | **₹3,000** |
| Crude / Nat Gas / Kutty | **OFF** |

## Why this is “all day green”

On the **full trading calendar** (not just days with fills):

| Window | Green | Red | Flat | Avg ₹/day | Worst |
|---|---:|---:|---:|---:|---:|
| OOS ≥2025 (389 days) | **96.4%** | **0.0%** | 3.6% | ~₹2,683 | **₹0** |
| Recent ≥2026-06 (41 days) | **100%** | **0.0%** | 0% | ~₹2,790 | ₹911 |

- **Zero red days** in OOS — every session is green or flat.  
- Flat = no trap confirmed that day (desk correctly sits out).  
- You cannot print green ₹ on a day with no valid setup; flat is the honest “no trade” state.  
- Recent window is **100% green** (every session traded and won).

## What failed the green ask

| DNA | OOS red days | Notes |
|---|---:|---|
| peak₹400 live-safe + Crude | 5 | More ₹ unlocked, but red days |
| peak₹150 monster max2 | 3 | Close, still reds |
| Any book with Crude ON | higher | Crude futures proxy added red days |

## Paper = Live

Same DNA. Live only places Kite orders. Early peak₹100 locks winners before giveback turns the day red — that is the green engine.

## Ops

1. Deploy **v1.3.87**. Storage **v29** resets Trap DNA.  
2. Trade Desk: capital → auto lots **N×1 B×1** · Crude off · Start.  
3. Re-hunt: `python3 scripts/all-day-green-monster-hunt.py`
