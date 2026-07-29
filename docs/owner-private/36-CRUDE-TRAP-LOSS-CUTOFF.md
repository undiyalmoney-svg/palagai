# 36 — Crude peers + Trap-style loss cutoffs

**Date:** 2026-07-29  
**Status:** Research + wired on Crude Desk  
**Script:** `scripts/crude-trap-loss-cutoff-hunt.py`  
**Data:** **MCX Kite** `crudeoilm-5m-merged.json` · **2026-03-23 → 2026-07-29** · 12,951 bars · 92 sessions  
(Kite instruments dump only exposes near months — this is the live front-month merge.)

## Question

> For **Crude Oil**: other strategy to raise profit %? Add loss cutoffs. Same result style as Trap.

## Short answer (MCX-validated)

1. **Champion Morning ORB + Evening PDHL** is still the best book on this sample (**~₹277/day**, PF 1.56, net **₹16,900**).  
2. **Trap DNA port** does **not** match Trap-on-Nifty results here (~₹19/day, PF ~1.0).  
3. **Peak-trail / soft SL cutoffs destroy Crude expectancy** on Champion and Trap (flip to red). **Do not use** on Crude the way we do on Nifty Trap.  
4. **Loss cutoffs that stay:** day max loss (and Daily Income’s day profit lock).

## MCX results (1 lot × ₹10/pt)

| Book | Net | ₹/day | Green | PF | Worst day |
|------|----:|------:|------:|---:|----------:|
| **champion_bare** (day −240) | **₹16,900** | **277** | 44% | **1.56** | −₹1,600 |
| champion + protect | −₹4,520 | −74 | 46% | 0.81 | −₹2,370 |
| daily_income bare (lock +100 / stop −50) | −₹2,550 | −42 | 41% | 0.88 | −₹800 |
| daily_income + protect | −₹2,160 | −35 | 41% | 0.87 | −₹910 |
| trap_bare 3.5R | ₹1,450 | 19 | 55% | 1.03 | −₹1,750 |
| trap + protect + day250 | −₹11,940 | −155 | 36% | 0.72 | −₹1,890 |

## Wired Crude Desk profiles

| Profile | Entry | SL/TP | Day loss | Day lock | Peak-trail / soft |
|---------|-------|-------|----------|----------|-------------------|
| **Champion** (default) | ORB 10–12 + PDHL 18:30–20:30 | 80/250 · 80/150 | −240 (−₹2,400) | off | **OFF** (hurts) |
| **Trap Confirm** | S/R trap + confirm · 3.5R | wick risk | −250 (−₹2,500) | off | **OFF** (hurts) |
| **Daily Income** | same ORB+PDHL | 40/80 · 40/50 | −50 (−₹500) | +100 (+₹1,000) | **OFF** |

## vs prior hunt note

Earlier all-day-green hunt claimed ~₹27.5k / ~63% green on a similar Mar–Jul sample with paired windows. This replay prints **₹16.9k / 44% green** on the front-month merge — still the clear winner vs Trap/Daily Income, but absolute ₹ depends on contract merge / fill assumptions. Prefer paper on live CRUDEOILM before sizing up.

## How to use

1. Crude Oil Desk → **Champion** (default) for researched ₹  
2. **Daily Income** if you want a hard +₹1,000 day lock / tighter stops  
3. **Trap Confirm** = research only (does not beat Champion on MCX)  
4. Live without real money: Live tab · Live money unchecked

## Reproduce

```bash
# auth: /tmp/kite-auth or KITE_AUTH='token apiKey:accessToken' (never commit)
FROM=2025-01-01 npx tsx scripts/fetch-crudeoilm-history.ts
python3 scripts/crude-trap-loss-cutoff-hunt.py
```
