# 38 — Crude All-Green Afternoon (15:15–23:00)

**Date:** 2026-07-29  
**Status:** Wired as Crude Desk **default**  
**Script:** `scripts/crude-all-green-1515-hunt.py`  
**Data:** MCX Kite `crudeoilm-5m-merged.json` · 2026-03-23 → 2026-07-29

## Ask

> Strategy that ends every day in profit. No fixed morning/evening slots — trade after 3:15pm to 11pm.

## Honest answer

**No book hit 100% green calendar days** on this sample. Best achievable:

| Book | Traded days | Green% | ₹/day | PF | Worst |
|------|------------:|-------:|------:|---:|------:|
| **Session OR + confirm + first-win · SL12/TP24** | **60** | **90.0%** | **154** | **3.48** | **−₹240** |
| Prior Daily Profit (eve PDHL) | 42 | 66.7% | 246 | 2.91 | −₹400 |
| Champion ORB+PDHL | 61 | 44% | 277 | 1.56 | −₹1,600 |

- ~10% of **traded** days still red.  
- Days with **no OR break** stay **flat** (not a profit).  
- Live fills / gaps can still lose.

## Wired profile: `all-green`

| Knob | Value |
|------|-------|
| Window | **15:15–23:00** (no morning slot required) |
| Setup | Session OR **15:15–15:45** break + next-bar confirm |
| SL / TP | **12 / 24** pts (₹120 / ₹240) |
| First-win lock | **ON** (stop after first green close) |
| Day profit lock | **+20** pts (+₹200) |
| Day max loss | **−15** pts (−₹150); strict −25 |
| Max OR width | 120 pts |
| Max fills | 2 / day |

## Desk

Crude Oil Desk → **All-Green Afternoon (15:15–23:00)** (default).

```bash
python3 scripts/crude-all-green-1515-hunt.py
npx tsx scripts/crude-all-green-smoke.ts
```
