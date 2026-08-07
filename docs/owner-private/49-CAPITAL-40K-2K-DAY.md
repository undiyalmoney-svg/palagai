# 49 — ₹40k capital → ~₹2k/day (₹40k → ₹60k in ~10 sessions)

**Date:** 2026-08-07  
**Build:** v1.3.84+ · `live-exit-safe`  
**Script:** `scripts/capital-40k-2k-day-hunt.py`  
**Cache:** `reports/analyst-cache/*` (gitignored)  
**Artifact:** `reports/daily-profit-research/capital-40k-2k-day-hunt.json`

## Ask

> Trade with ₹40k only. Make ₹40k → ₹60k in 10 days (~₹2k/day).  
> Desk must pick lots, protect capital, paper = live. Find the DNA.

## Auto lots (₹40k)

Premium budget = 60% of capital = **₹24,000**.

| Book | Lots | ATM premium proxy |
|---|---:|---:|
| Nifty 50 | **1** | ~₹10,000 |
| Bank Nifty | **1** | ~₹12,000 |
| Crudeoil Mini | **1** | ~₹1,500 |
| **Total** | | **~₹23,500** (fits) |

Code: `planLotsForCapital()` in `capital-plan.util.ts` — Trade Desk applies this on load.

## Winning DNA (already live-safe wired)

**Index (Nifty + Bank) — Trap Confirm**

| Rule | Value |
|---|---|
| Entry | Swing trap / bounce · **next-bar confirm** · EMA50 bias |
| Pierce | Nifty **15** · Bank **30** |
| Bounce | OR × 0.25 capped 40 |
| Window | 09:45–14:45 · EOD 15:15 |
| Target | **2R** |
| Peak trail | Arm **₹400** · floor max(₹200, peak−₹200) |
| Soft SL cutoff | **OFF** |
| Max trades | unlimited (desk day lock is the cap) |

**Crude — Selective**

| Rule | Value |
|---|---|
| Entry | Trap + confirm · 10:00–23:00 |
| SL / TP | **50 / 200** pts (₹500 / ₹2,000) |
| Max / day | **4** · soft book lock ~₹1k |

**Desk risk**

| Control | Value |
|---|---|
| Day profit lock | **ON ~₹3,000** (above ₹2k target so winners can finish) |
| Strict day stop | OFF by default (opt in ~₹2,950) |
| Kutty / Nat Gas | OFF |

## Hunt evidence (index proxy ₹ + Crude futures proxy)

OOS ≥2025-01-01 · lots 1/1/1 · day lock ₹3k:

| DNA | Avg ₹/day | ≥₹2k% | Green% | P10 | 10-day hit +₹20k |
|---|---:|---:|---:|---:|---:|
| **live-safe peak400 pierce15/30** | **2,586** | **85.2%** | **96.9%** | **1,313** | **95.5%** |
| monster peak150 max2 | 2,545 | 82.9% | 97.4% | 1,192 | 97.3% |
| pierce12 peak150 | 2,551 | 80.0% | 97.9% | 1,262 | 94.9% |

Unlocked (no day lock) live-safe OOS avg **~₹5,089/day** · best day ~₹25k · rolling-10 avg ~₹51k.  
Recent (≥2026-06) with lock: avg **~₹2,218/day** · ≥₹2k **73.5%**.

## Honest ceiling

| Question | Answer |
|---|---|
| Can we hit ₹2k most days? | **Yes in proxy** (~85% OOS with lock). Live option fills + charges will be lower. |
| What’s the max ₹/day? | Unlocked proxy avg ~**₹5k**; single days ~₹25k. Lock keeps the plan in the ₹2–3k band for consistency. |
| Zero-loss trades? | **No DNA is zero-loss.** Best green ~97%. Worst proxy day ~−₹1.9k. Use strict day stop if you want a hard floor. |
| ₹40k → ₹60k in 10 days? | Rolling 10-day +₹20k hit **~95%** in OOS proxy with lock — not a live guarantee. |

## Paper = Live

Same Trap / Selective DNA drives both. Live only adds Kite MARKET + SL-M. Do **not** reintroduce peak₹150 for paper-green hunts (doc 48 tuck-tuck).

## Client job (agent mode)

1. Set **Total capital (₹)** once (default ₹40k) — desk auto-allocates lots.  
2. Each morning: **Get Token** → paste access token.  
3. Trade Desk → Live → Live money → **Start**.  
4. **Keep the browser tab open** all day — desk scans, sizes, and trades.

## Ops

1. Badge **v1.3.86+ · capital-agent**.  
2. Trade Desk capital field + auto lots (persisted).  
3. Re-hunt: `python3 scripts/capital-40k-2k-day-hunt.py`
