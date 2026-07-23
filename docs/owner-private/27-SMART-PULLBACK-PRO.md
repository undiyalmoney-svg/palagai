# 27 — Smart Pullback PRO · 1+1 lot ₹500 book (Kite)

**Date:** 2026-07-23  
**Scripts:** `scripts/smart-pb-pro-trader-loops.py`, `scripts/fetch-kite-index-5m.py`  
**Strategy id:** `smart-pullback-pro`  
**Book:** **1 lot Nifty + 1 lot Bank** (₹65/pt + ₹30/pt)

## Pro-trader finding

Raw Pine labels alone do **not** print ₹500/day. The loop that does (Kite 5m OOS 2024+, 635 days):

### Dual DNA (asymmetric book)

| Leg | Entry | Exit | Window | Caps |
|---|---|---|---|---|
| **Nifty primary** | Pine breakout + strong body + close in top/bottom third + **OR-mid** | **3R** | 10:15–14:30 | 2t/day · gap15 · sideways skip |
| **Bank overlay** | Donch-20 **armed break→retest** + strong + OR-mid + EMA side | **1.5R** | 10:15–14:30 | 1t/day · gap30 · sideways skip |
| **Sync** | Take Bank only when **Nifty EMA50 bias** matches Bank direction | — | — | causal / live-observable |

### OOS metrics @ 1+1 lot

| Metric | Value |
|---|---:|
| Avg ₹ / calendar day | **~₹505** |
| Days ≥ ₹500 | **~44%** |
| Green days | **~50%** |
| In ₹500–₹5000 band | **~31%** |
| Coverage | **~99%** |
| Worst day | **~−₹5250** |
| Best day | **~+₹13700** |

| Year | Avg ₹ |
|---|---:|
| 2024 | ~699 |
| 2025 | ~512 |
| 2026 YTD | ~141 (weaker — size down if soft) |

## What failed (so you don’t re-chase)

- Yahoo 60d **EMA pullback · 1.5R** → overfit; on Kite avg **−₹44**
- Trading **both legs always** without bias sync → Bank drag
- Same-day “same direction” using future Nifty fills → **look-ahead**; causal fill-sync ≈ ₹450
- Meta gap/weekday filters → cut coverage more than they helped

## Honest limits

- **Avg ₹500 ≠ every day ₹500.** ~half the days still miss the floor.  
- Band rate ~31% — many green days are **>₹5000** or **<₹500**.  
- Day-stop days hit ~−₹3900 to −₹5250.  
- Index tokens proxy futures; fees/slippage not modeled.  
- **Do not** auto-replace Donch Retest defaults until you paper this book.

## Live playbook

1. Assign **Smart PB PRO · 1+1 ₹500 book** on **Nifty** and **Bank** Paper.  
2. Module auto-profiles: Nifty→breakout·3R·2t · Bank→armed-retest·1.5R·1t.  
3. **Bias sync:** only take Bank signals when Nifty is on the same side of its EMA50.  
4. Stop after day-stop (−60 pts/instrument).  

## App / repro

- Engine: `smart-pullback-pro.engine.ts` (`breakout` + `armed_retest` + OR-mid + close-third)  
- Module: `smart-pullback-pro.managed-strategy.ts` (`channelProfileExtras`)  
- Fetch: `KITE_AUTH='token key:secret' python3 scripts/fetch-kite-index-5m.py`  
- Loops: `python3 scripts/smart-pb-pro-trader-loops.py` → `/tmp/smart-pb-loops/`  
- Push500: `/tmp/smart-pb-loops/push500.json`
