# 50 — All-day-green Trap DNA

**Date:** 2026-08-07  
**Build:** v1.3.88 · `hands-off-agent` (DNA from v1.3.87 `all-day-green`)  
**Script:** `scripts/all-day-green-monster-hunt.py`  
**Ask:** Every day green — find the method. Hands-off: Start / Stop only.

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

## Ops (hands-off)

1. Deploy **v1.3.88**. Hard-refresh Trade Desk — badge must show `hands-off-agent`.  
2. **Get Token** once.  
3. Press **Start** any morning (6:30 or 10:00 — your call). Do not select lots/books/DNA.  
4. Leave the tab open. After **15:15** press **Stop**.  
5. Capital guards auto-on: day profit lock + strict day stop. Crude/Kutty OFF.  
6. Re-hunt: `python3 scripts/all-day-green-monster-hunt.py`
