# 38 — Crude All-Green (09:00–23:00)

**Date:** 2026-07-29  
**Status:** Wired as Crude Desk **default**  
**Script:** `scripts/crude-all-green-1515-hunt.py` (historical afternoon hunt)  
**Data:** MCX Kite `crudeoilm-5m-merged.json` · 2026-03-23 → 2026-07-29

## Ask

> Trade whenever I start the desk (not only after 3:15). Keep day loss cutoffs.

## Honest answer

**No book hit 100% green calendar days** on this sample. All-Green aims for high green% of **traded** days; live fills / gaps can still lose.

## Wired profile: `all-green`

| Knob | Value |
|------|-------|
| Window | **09:00–23:00** (entries after OR; start anytime desk is on) |
| Setup | Session OR **09:00–09:30** break + next-bar confirm |
| SL / TP | **12 / 24** pts (₹120 / ₹240) |
| First-win lock | **OFF** |
| Day profit lock | **OFF** |
| Day max loss | **−150** pts (−₹1,500 / lot); strict −180 (−₹1,800) |
| Max OR width | 120 pts |
| Max fills | **unlimited** |

## Desk

Crude Oil Desk → **All-Green (09:00–23:00)** (default).

```bash
npx tsx scripts/crude-all-green-smoke.ts
```
