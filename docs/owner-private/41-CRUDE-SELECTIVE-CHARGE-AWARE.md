# 41 — Crude Selective (charge-aware, max 1/day)

**Date:** 2026-08-04  
**Status:** Wired as Trade Desk default **`selective`** — **v1.3.63:** Trap SL50/TP200 · ≤4/day · day lock ₹1k (doc **46**). Experiments keeps All-Green in picker.  
**Script:** `scripts/crude-selective-hunt.py`  
**Artifact:** `reports/crude-selective/summary.json` (gitignored)  
**Data:** MCX `crudeoilm-5m-merged.json` · 2026-03-23 → 2026-08-03 · ₹10/pt · charge model **₹50/roundtrip**

## Ask

> Yesterday overall ≈ −₹63 but Crude **charges ~₹1000**. Do not overtrade commodity.  
> Even **one** trade should aim to finish green. Session is long (09:00–23:15) — wait for a real opportunity.

## What All-Green did wrong (charge lens)

| Book | Trades | tpd | Gross | Charges (@₹50) | After charges |
|------|-------:|----:|------:|---------------:|--------------:|
| **All-Green unlimited** (full sample) | 997 | **12.6** | +₹31.4k | **₹49.9k** | **−₹18.5k** |
| All-Green on **2026-08-03** (sim) | 112 | — | +₹3.2k | **₹5.6k** | **−₹2.4k** |
| Live 2026-08-03 (broker) | 20 option RT | — | ~+₹1 prem | **~₹1.0k** | **~−₹63** day |

OR that day was **7601–7790 (189 pts)** with **no OR-width skip** + **unlimited re-entries** + SL-M blocked on commodity options → churn.

## Wire candidate

```
DNA:     session_or · SL40 / TP80 · OR width ≤ 60 · eve 18:30–22:00
Entry:   Session OR (09:00–09:30) break · next-bar confirm · EMA bias in hunt
Max/day: 1 · first-win lock ON
Day loss: 40 pts (₹400)
Trail:   OFF
```

| Sample | Green% | tpd | ₹/day gross | ₹/day after ₹50 | PF | Worst day |
|--------|-------:|----:|------------:|----------------:|---:|----------:|
| IS (~65d) | 48% | 1.00 | ~146 | **~96** | 1.83 | −400 |
| OOS (~28d) | **59%** | **1.00** | ~253 | **~203** | 2.73 | −400 |
| **2026-08-03** | — | **0** | 0 | **0** | — | skipped (OR 189 > 60) |

Honest: **not 100% green** on IS. Selective = skip bad days + one shot when OR is sane — not scalp churn.

## Profile

Experiments → Crude → **`Selective (1/day · OR≤60)`** (`selective`)

**Auto Trader (Autobot / Server Live)** Crude DNA = **Selective** (fixed); Crude checkbox **OFF** by default.  
**Trade Desk Local Live** Crude DNA = **Selective** (same). All-Green remains only on Experiments profile picker.

## Autobot deploy (Order-API droplet)

```bash
# 1) Palagai — merge/push Selective + rebuild strategy core
cd palagai
node scripts/server-live/build-strategy-core.cjs   # needs sibling ../Palagai-Order-API

# 2) Order-API — commit strategy-core + live.worker (crudeStrategy selective)
cd ../Palagai-Order-API
git add live/strategy-core.cjs live/live.worker.js live/live.store.js
git commit -m "Auto Live Crude = Selective (max 1/day)"
git push origin main

# 3) Droplet 168.144.28.89
ssh root@168.144.28.89
cd /var/www/Palagai-Order-API
git pull
pm2 restart trading-backend

# 4) App (Vercel) — merge palagai PR so Auto Trader UI shows Selective
# 5) Auto Trader → Push Kite token → Start (paper first)
```

## Refresh / re-hunt

```bash
# needs valid Kite auth
FROM=2025-01-01 npx tsx scripts/fetch-crudeoilm-history.ts
CHARGE_RS=50 python3 scripts/crude-selective-hunt.py
```

## Next (when you say go)

1. Paper Selective on Experiments for a few sessions.  
2. If it feels right → Trade Desk Crude default = Selective (keep All-Green selectable).  
3. Separately: commodity option SL should not use bare SL-M (Zerodha blocks it).
