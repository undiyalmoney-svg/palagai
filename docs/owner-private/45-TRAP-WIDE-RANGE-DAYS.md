# 45 — Trap on wide-range / directional days (Jul quiet vs Aug 3–4)

**Date:** 2026-08-05  
**Script:** `scripts/trap-wide-range-day-research.py`  
**Cache:** `reports/analyst-cache` Nifty/Bank 5m (Aug 4 ends ~14:20)  
**Baseline DNA:** pierce10 · peak arm₹150/75/75 · soft OFF · RR2 · confirm ON · lots 1/1

## Ask

Handle “this week” style days better — large directional / wide-range (Aug 3 up big, Aug 4 down big) where confirm fails and CE looks stopped — without wrecking quieter high-quality days (Jul 28–31).

## Day shape (Nifty)

| Day | Range | Ret | Ret/Rng | OR 09:15–09:45 |
|---|---:|---:|---:|---:|
| Jul 28–31 | 87–156 | +5…+65 | 0.04–0.45 | 73–100 |
| **Aug 3** | **259** | **+202** | **0.78** | 61 |
| **Aug 4** | **276** | **−228** | **−0.83** | 115 |

Bank same pattern, ~2–3× pts (Aug 3 OR≈335 / Aug 4 OR≈418).

## What wired Trap actually did

| Window | Index ₹ (N+B 1 lot) | Notes |
|---|---:|---|
| Jul 28–31 | **₹22,111** | High-quality quiet week |
| Aug 3 | **₹3,744** | 6 CE fills — all **peak-trail wins** (not hard SL) |
| Aug 4 | **₹3,869** | 4 Nifty PE peak-trail wins · **Bank 0 fills** |

Aug “CE stopped” on the index proxy = **peak-trail arm₹150 giveback lock** (MFE ₹348–₹1092 → locked profit). Hard SL count on Aug 3–4 wired = **0**.

Confirm fails are real (Aug 3 Nifty+Bank: 16 fails / 22 arms) but **not the ₹ leak** — `confirm=OFF` ≈ same Aug ₹ with 3–4× fills, and **hurts Jul + full OOS** (doc 33 / 44).

## Root gap on wide days

**Bank pierce=10 is tiny vs Bank OR 200–400.** On Aug 4 dump, Nifty PE worked; Bank stayed silent. Quiet Jul days already print with pierce10 — the miss is relative pierce on large-structure books/days.

`regimeFilterEnabled` is already **false** on Trap (VolExpand-only DNA). Turning it on is the wrong tool here.

## Recommended changes (evidence-ranked)

### Rec A (preferred) — OR-scaled **bounce** pierce

**Where:** `sr-trap-confirm.engine.ts` + DNA extras  
**Rule:** keep trap pierce at DNA floor; widen **bounce** band with morning OR:

```
bouncePierce = min(cap, max(piercePts, orWidth * mult))
# researched: mult=0.20 · cap=35  (or 0.25 / 40)
```

Wire extras e.g. `bounceOrPierceMult: 0.20`, `bounceOrPierceCap: 35` in:

- `sr-trap-confirm.managed-strategy.ts` extras  
- `TRAP_1LOT_DAILY_DNA_EXTRAS` in `strategy-dna-caps.ts`

| Window | Wired | bounce OR 0.20/cap35 | Δ |
|---|---:|---:|---:|
| Jul 28–31 | 22,111 | **27,281** | +5.2k |
| Aug 3–4 | 7,613 | **16,254** | +8.6k |
| OOS 2025+ avg | 4,256 | **6,409** | +2.2k |
| OOS ≥₹1k | 88.6% | **94.9%** | +6pp |
| OOS p10 | 876 | **1,832** | +956 |

Aug 4 Bank goes 0 → 2 PE fills. Jul quiet week **improves**, not wrecked. Tradeoff: ~3.7 → ~5.4 tpd (more bounce arms on wide OR).

### Rec B (simpler DNA bump) — pierce **10 → 15** (+ optional Bank pierce)

**Where only:** DNA / defaults (no engine structural change)

1. `piercePts: 15` in managed strategy + `TRAP_1LOT_DAILY_DNA_EXTRAS`  
2. Optional Bank override in `generateSignal`: `piercePts: bank ? 30 : 15`

| Variant | Jul 28–31 | Aug 3–4 | OOS avg | ≥₹1k | Notes |
|---|---:|---:|---:|---:|---|
| pierce15 | 24,910 | 8,972 | 5,190 | 91.9% | Helps Nifty Aug4 PE count; **Bank Aug4 still 0** |
| nifty15 + bank30 | 27,545 | 14,395 | 5,946 | 93.1% | Fixes Bank Aug4 silence surgically |

Doc 43 hunt already showed pierce12/15 lift OOS vs pierce10; this is consistent.

## What NOT to do

| Idea | Why not |
|---|---|
| **Turn off next-bar confirm globally** | Same/less ₹, 3–4× churn; OOS avg −₹1.1k; Jul ≥₹1k 100%→87% |
| **Skip CE when day dump / below OR** | Dump-day CE bounces are **net winners** OOS; filter cuts Jul + OOS |
| **trapMode=trap only on wide OR** | Kills bounce edge that makes Jul quality |
| **minConfirmBody ≥ 8** | Cuts Jul/Aug/OOS hard |
| **Enable `regimeFilterEnabled` on Trap** | Built for VolExpand morning stand-down, not Trap bounce DNA |

## Ops (separate — not Trap logic)

Early-start Live bug: index legs only load if index already open at Start. Silent Live on rich Trap days is often **wiring / Start timing / wrong Strat**, not missing DNA (doc 44). Fix ops separately; do not loosen confirm to compensate.

## Suggested ship order

1. **Shipped in v1.3.56:** Rec A bounce OR + Live deferred Start.  
2. **Shipped in v1.3.59:** Rec A+B combined for daily fills — `piercePts=15` · `bankPiercePts=30` · `bounceOrPierceMult=0.25` · `cap=40` · strat storage **v25**.  
3. Keep confirm ON · peak150 softOFF · RR2 · lots 1/1/1.
