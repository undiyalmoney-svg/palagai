# 38 — Crude All-Green (09:00–23:00)

**Date:** 2026-07-29  
**Status:** Wired as Crude Desk **default**  
**Data:** MCX Kite `crudeoilm-5m-merged.json`

## Ask

> Trade whenever I start. Cutoffs are **per trade**, not day-wide:
> - profit peaks ₹500 then comes back to ₹240 → stop that trade
> - loss to ₹150 → stop that trade, hunt next opportunity

## Wired profile: `all-green`

| Knob | Value |
|------|-------|
| Window | **09:00–23:00** (entries after OR; start anytime desk is on) |
| Setup | Session OR **09:00–09:30** break + next-bar confirm |
| Per-trade SL | **15 pts = ₹150** / lot |
| Peak trail | Arm **₹500** · lock floor **₹240** · giveback **₹260** |
| Stretch TP | **100 pts = ₹1,000** (trail usually exits first) |
| Day max loss | **OFF** (after SL / drained cut → next opportunity) |
| Max OR width | **OFF** (trade even on wide opens) |
| Max fills | **unlimited** |

## Desk

Crude Oil Desk → **All-Green (09:00–23:00)** (default).

```bash
npx tsx scripts/crude-all-green-smoke.ts
```
