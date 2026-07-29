# 36 — Crude peers + Trap-style loss cutoffs

**Date:** 2026-07-29  
**Status:** Research + wired on Crude Desk  
**Script:** `scripts/crude-trap-loss-cutoff-hunt.py`  
**Data:** Prefer `crudeoilm-5m-merged.json` (Kite). This run used **CL=F × 85** Yahoo proxy (exploratory — not MCX truth).

## Question

> For **Crude Oil**: other strategy to raise profit %? Add loss cutoffs. Same result style as Trap.

## Short answer

1. **Champion Morning ORB + Evening PDHL** remains the best researched Crude book on the Mar–Jul 2026 MCX hunt (~₹27.5k · 5/5 months green · ~63% green days).  
2. **Nifty Trap DNA ported to Crude** did **not** beat Champion on the recent CL×85 window.  
3. **Trap-style peak-trail / soft SL** helped Daily Income / Trap profiles as optional risk tools, but **hurt Champion** on the proxy — so Champion keeps protect **OFF**.  
4. Wired three Crude Desk profiles with loss cutoffs where they belong.

## Profiles on Crude Desk

| Profile | Entry | SL/TP | Day loss | Day lock | Peak-trail / soft cut |
|---------|-------|-------|----------|----------|------------------------|
| **Champion** (default) | ORB 10–12 + PDHL 18:30–20:30 | 80 / 250 · 80 / 150 | −240 pts (−₹2,400) | off | **off** |
| **Trap Confirm** | S/R trap + next-bar confirm · 3.5R | wick risk | −250 pts (−₹2,500) | off | arm ₹600 / gb ₹300 · soft ₹700 |
| **Daily Income** | same ORB+PDHL | 40 / 80 · 40 / 50 | −50 (−₹500) | +100 (+₹1,000) | same Trap cutoffs |

## Recent proxy window (CL×85, ~May–Jul 2026)

| Book | ₹/day | Green | PF | Worst day |
|------|------:|------:|---:|----------:|
| **champion_bare** | **435** | 49% | 1.66 | −₹1,600 |
| champion + protect + day250 | −102 | 39% | 0.78 | −₹1,600 |
| daily_income + protect | −113 | 41% | 0.66 | −₹1,037 |
| trap_bare | 26 | 50% | 1.05 | −₹1,106 |
| trap + protect + day250 | −122 | 34% | 0.74 | −₹1,878 |

**Takeaway:** on this proxy, keep Champion bare (day −240 only). Trap Confirm is available to paper beside Champion — re-rank when real MCX cache is present.

## Prior MCX hunt (authoritative for Champion)

Mar–Jul 2026 all-day-green hunt (~100 strategies): paired Morning ORB + Evening PDHL ≈ **+₹27,480** · **5/5 months green** · ~**63%** green days · 1 lot × ₹10. All-day-green every calendar day was **not** found.

## How to use

1. Crude Oil Desk → Strategy dropdown  
2. **Champion** = max researched ₹ (default)  
3. **Trap Confirm** = Trap-like DNA + cutoffs (paper first)  
4. **Daily Income** = ₹300–1,000 band with day lock + trail  
5. Live without real money: Live tab · leave Live money unchecked

## Reproduce

```bash
# With Kite auth (best):
FROM=2023-01-01 npx tsx scripts/fetch-crudeoilm-history.ts
python3 scripts/crude-trap-loss-cutoff-hunt.py

# Without auth: script falls back to CL=F × 85 Yahoo proxy
python3 scripts/crude-trap-loss-cutoff-hunt.py
```
