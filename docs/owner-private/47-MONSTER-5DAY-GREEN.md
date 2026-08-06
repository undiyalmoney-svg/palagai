# 47 — Monster hunt: all-5-days-green desk DNA

**Date:** 2026-08-06  
**Build:** v1.3.64 · `monster-5day-green`  
**Script:** `scripts/monster-5day-green-hunt.py`  
**Window:** desk overlap 2026-03-23 → 2026-08-04 (90 sessions)  
**Charges:** index ₹40/RT · Crude ₹50/RT (futures proxy)

## Ask

> All 5 days green — not waiting for dump results. Hunt like a monster.  
> Filter bugs faced so far.

## Bugs already filtered (keep)

| Fix | Version |
|---|---|
| Live Nifty/Bank place on bar open/close | 1.3.58 |
| Profit ₹ = Kite fills only | 1.3.57 |
| SKIP spam / false miss | 1.3.60 |
| Confirm stays ON | always |

## Winner (wired)

**Index Trap (N+B)**  
`pierce15 · Bank pierce30 · bounce OR · peak₹150/75/75 · soft OFF · RR2 · max 2/day · dayStop 40`

**Crude Selective**  
`eve Trap · SL30/TP60 · first-win · ≤2 · 18:30–22:00`

**Desk:** day profit lock ₹3k still on by default.

### Overlap results (proxy)

| Metric | Value |
|---|---:|
| Green days | **97.8%** |
| Red days | **1.1%** |
| Rolling 5 all-green | **93.0%** |
| Full weeks all-green | **17 / 18 (94.4%)** |
| Max green streak | **83** |
| Avg ₹/day | ~₹3.6k (with max2) / ~₹5.2k (unlim peak150) |
| ≥₹1k | ~89–92% |
| Worst day | **−₹50** |

Wired uses **max 2/day** on index (same 97.8% / 93% win5 as unlimited peak150, less churn than rocket unlimited).

## Why not peak₹400 hold-longer

peak400 still ~95.6% green / ~83% win5 on this window — good, but **loses** ~10pp of 5-day-all-green vs peak150. Owner ask = green week first.

## Honest ceiling

Not a live guarantee. Proxy ≠ option fills. Overlap is ~4 months. Goal of the DNA is **max probability** of a green week, not a promise of forever.

## Ops

1. Deploy **v1.3.64** (strat storage **v27**).  
2. Stop → Start Live money · Nifty + Bank + Crude on · 1/1/1.  
3. Expect few Crude fills (evening first-win) — that is intentional so Crude cannot dump the week.
