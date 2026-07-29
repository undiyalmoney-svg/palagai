# 37 — Crude Daily Profit (Trap-style)

**Date:** 2026-07-29  
**Status:** Wired as Crude Desk **default**  
**Script:** `scripts/crude-daily-profit-hunt.py`  
**Data:** MCX Kite `crudeoilm-5m-merged.json` · 2026-03-23 → 2026-07-29 · 12,951 bars

## Ask

> Daily profits Crude strategy like Trap.

## Winner (MCX)

| Book | Net | ₹/day | Green | PF | Worst |
|------|----:|------:|------:|---:|------:|
| **eve_c SL20/TP40 lock+50 stop−40** | **₹10,310** | **246** | **66.7%** | **2.91** | **−₹400** |
| champion_bare (ORB+PDHL) | ₹16,900 | 277 | 44.1% | 1.56 | −₹1,600 |
| daily_income_v1 | −₹2,550 | −42 | 40.7% | 0.88 | −₹800 |

Trap S/R port and morning+evening grids lost to **evening PDHL + next-bar confirm** with Kutty-style tight ₹ TP/SL.

## Wired profile: `daily-profit`

| Knob | Value |
|------|-------|
| Entry | Evening PDHL **18:30–21:00** + **next-bar confirm** |
| Morning | **Off** by default (can re-enable) |
| SL / TP | **20 / 40** pts (₹200 / ₹400) |
| Day profit lock | **+50** pts (+₹500) |
| Day max loss | **−40** pts (−₹400); strict −50 |
| Peak-trail / soft SL | **OFF** (hurts Crude) |
| Max evening fills | 2 / day |

## Honest limits

- **Not 100% green** (~67% on this sample).  
- Lower total ₹ than Champion, but **better green% + tighter worst day** (Trap-like feel).  
- Futures DNA → ATM **CRUDEOILM** CE/PE on the desk.

## Desk

Crude Oil Desk → **All-Green Afternoon** is now the default (see **38**). **Daily Profit (Trap-style)** remains selectable for higher ₹/day with lower green%.

```bash
python3 scripts/crude-daily-profit-hunt.py
npx tsx scripts/crude-daily-profit-smoke.ts
```
