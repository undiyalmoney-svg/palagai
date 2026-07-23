# 27 — Smart Pullback PRO · GENIE v3 (COMBO / ALONE / SKIP)

**Date:** 2026-07-23  
**Scripts:** `scripts/smart-pb-pro-trader-loops.py`, `scripts/smart-pb-genie-router.py`, `scripts/fetch-kite-index-5m.py`  
**Strategy id:** `smart-pullback-pro`  
**Book:** **1 lot Nifty + 1 lot Bank** (₹65/pt + ₹30/pt)

## The genie (what you asked for)

Each morning the book picks one of:

| Mode | Meaning |
|---|---|
| **BOTH** | COMBO — trade Nifty + Bank (Bank bias-synced) |
| **NIFTY** | ALONE — Nifty only |
| **BANK** | ALONE — Bank only |
| **SKIP** | Sit out the day |

### GENIE v3 rules (causal, known by ~09:45–10:15)

1. **Tuesday → SKIP** (worst weekday edge).  
2. **Friday → BOTH** (best weekday — combo).  
3. **Monday →** if `max(Nifty OR-drive, Bank OR-drive) < 0.35` → SKIP; else BOTH if biases aligned, else stronger-drive leg **alone**.  
4. **Wednesday →** same with drive floor **0.25**.  
5. **Thursday →** BOTH if aligned, else stronger-drive leg **alone**.  
6. **Bank bias-sync:** on BOTH/BANK, only take Bank when direction matches Nifty EMA50 bias.

OR-drive = `|OR last close − OR first open| / OR width` (OR to 09:45).

### OOS @ 1+1 lot (Kite 5m, calendar 2024+, 628 sessions)

| Book | Avg ₹ | Green | Red | ≥₹500 | Band ₹500–5k | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| Always BOTH (bias-sync) | ~525 | ~50% | **~49%** | ~45% | ~33% | ~99% |
| **GENIE v3** | **~507** | ~37% | **~34%** | ~33% | ~24% | **~71%** |
| Oracle (look-ahead upper bound) | ~2210 | ~57% | **0%** | ~56% | ~43% | ~57% |

| Year | GENIE avg ₹ | GENIE red |
|---|---:|---:|
| 2024 | ~697 | ~32% |
| 2025 | ~417 | ~33% |
| 2026 YTD | ~326 | ~39% |

**Honest limit:** causal morning features **cannot** erase all reds. Oracle proves perfect routing kills reds; without look-ahead, GENIE v3 is the best interpretable cut that still holds **avg ≈ ₹500** and stays green every year.

## Dual DNA (legs)

| Leg | Entry | Exit | Window | Caps |
|---|---|---|---|---|
| **Nifty** | Pine breakout + strong + close-third + OR-mid | **3R** | 10:15–14:30 | 2t · gap15 · sideways |
| **Bank** | Donch-20 armed break→retest + strong + OR-mid | **1.5R** | 10:15–14:30 | 1t · gap30 · sideways |

## Live playbook

1. Assign **Smart PB PRO · GENIE 1+1** on Nifty + Bank Paper.  
2. Module auto-profiles legs; **GENIE router is on by default**.  
3. For full COMBO/ALONE (not local-only lite): set peer extras after OR — `geniePeerDrive`, `geniePeerGap`, `geniePeerBias`, and on Bank `genieNiftyBias`.  
4. Without peer extras: local lite still does **Tue SKIP** + Mon/Wed drive skips (treats allowed days as BOTH for that leg).  
5. Stop after day-stop (−60 pts/instrument).  
6. Does **not** replace Donch Retest defaults.

## App / repro

- Engine: `smart-pullback-pro.engine.ts` (`resolveGenieV3Route`, `armed_retest`, OR-mid)  
- Module: `smart-pullback-pro.managed-strategy.ts` v2.1.0  
- Genie search: `python3 scripts/smart-pb-genie-router.py` → `/tmp/smart-pb-genie/`  
- Loops: `python3 scripts/smart-pb-pro-trader-loops.py` → `/tmp/smart-pb-loops/`
