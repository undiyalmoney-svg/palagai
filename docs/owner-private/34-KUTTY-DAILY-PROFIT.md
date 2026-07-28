# 34 — Kutty daily-profit hunt (2026-07-28)

**Status:** Research complete · champion DNA wired  
**Data:** Kite 5m Nifty+Bank · 2020→2026-07-28  
**Proxy:** pts × ₹65 / ₹30 · 1 lot each  
**Script artifact:** `reports/kutty-daily-hunt/summary.json`  
**Walk-forward:** train ≤2023 · OOS ≥2024

## Goal

Daily income from **Kutty** (background scalp; Trap priority unchanged).

## Sweep

448 configs: trap+bounce · next-bar confirm · EMA50 · TP/SL ₹ grids · windows · mt1/2 · OR filter · first-win lock · wide-OR skip.

## Current vs champion (OOS 2024+)

| Book | Avg/day | Green% | Red% | PF | Net | Max DD | Monthly ~
|------|--------:|-------:|-----:|---:|----:|-------:|----------:|
| **Previous Kutty** (TP350/SL200) | ₹434 | 78.6% | 21.4% | 8.75 | ₹2.58L | −₹1,400 | ~₹9.1k |
| **Champion** (TP600/SL200) | **₹838** | **86.2%** | **13.8%** | **18.91** | **₹4.98L** | **−₹1,200** | **~₹17.6k** |

## Champion DNA (wired)

```
Entry:   S/R trap or soft bounce + EMA50 bias
Confirm: NEXT 5m bar continues (enter at open)
Target:  ₹600
Stop:    ₹200
Session: 10:00–14:30 IST
Max/day: 2 per index
OR filter / first-win / wide-OR skip: OFF (hurt avg more than they helped)
```

## Year-by-year (champion, both books)

| Year | Avg/day | Green% | Red% | Net | PF |
|------|--------:|-------:|-----:|----:|---:|
| 2020 | ₹847 | 83.8 | 16.2 | ₹1.99L | 18.2 |
| 2021 | ₹840 | 84.5 | 15.5 | ₹1.96L | 14.4 |
| 2022 | ₹887 | 90.8 | 9.2 | ₹2.12L | 25.7 |
| 2023 | ₹911 | 90.3 | 9.7 | ₹2.16L | 20.6 |
| 2024 | ₹801 | 86.0 | 14.0 | ₹1.83L | 19.6 |
| 2025 | ₹900 | 89.3 | 10.7 | ₹2.11L | 26.1 |
| 2026* | ₹792 | 81.1 | 18.9 | ₹1.05L | 11.9 |

\*partial

## Notes

- Still **index ₹ proxy** (not live option fills).
- Kutty stays **off Strat dropdown**; Trade Desk **Kutty scalp** toggle controls it (default OFF).
- Never blocks Trap; margin reserve unchanged.
