# 39 — Natural Gas Mini daily-profit DNA (2026-08-03)

**Status:** Wired in **Trade Desk** (parallel MCX book) + **Experiments → Nat Gas Mini** as profile **Daily Profit (NG)** (`daily-profit-ng`)  
**See also:** Doc **40** for multi-trade / higher-IS-profit bounce (more fills; lower OOS ₹/day).  
**Instrument:** `NATGASMINI` · ₹50/pt · strike step 5  
**Data:** Kite 5m merge · **2026-03-30 → 2026-08-03** (live months only; expired FUT tokens not in instruments dump)  
**Scripts:** `scripts/natgas-daily-profit-hunt.py` · `scripts/fetch-natgasmini-history.ts`  
**Artifact:** `reports/natgas-daily-profit/` (gitignored)

## Goal

Closest daily-profit book on Nat Gas Mini (high green-day rate, tight SL, confirm).

## Sweep

1976 Trap / afternoon / evening-PDHL / morning-ORB / SOR configs on real MCX 5m, walk-forward last 30%.

## Wire candidate (MCX)

```
DNA:     trap_sl1.5_tp3_L0_S3.0_fw1_c1_p0.2_m1
Entry:   S/R trap · pierce 0.2 · EMA50 bias · next-bar confirm ON
Stop:    1.5 pts  (₹75 / lot)
Target:  3.0 pts  (₹150 / lot)
Session: 10:00–22:00 IST
Max/day: 1
First-win lock: ON
Day loss: 3.0 pts (₹150)
Day lock: 0
```

| Sample | Green% | ₹/day | PF | Trade-days | Worst day |
|--------|-------:|------:|---:|-----------:|----------:|
| MCX IS (Mar–Aug 2026) | **68.2** | **~61** | **3.55** | 22 | −75 |
| MCX OOS (last 30%) | **75.0** | **~74** | **4.93** | 8 | — |

Proxy (Yahoo NG=F×85) earlier pointed at the same SL/TP family with pierce **0.5**; on real MCX, **pierce 0.2 + max 1/day** wins.

## Desk map

1. **Trade Desk** → enable **Natural Gas Mini** (hardwired Daily Profit NG; same `crude` module gate as Crude)
2. **Experiments → Nat Gas Mini** (same DNA for lab / profile switching)
3. Trap-style + confirm · SL/TP/pierce as above  
   (do **not** copy Crude Daily Profit’s 20/40 pts — crude is ₹10/pt)
4. Paper 1 lot first

## Refresh bars

```bash
# needs valid KITE_AUTH or .kite-auth (apiKey:accessToken)
FROM=2025-01-01 npx tsx scripts/fetch-natgasmini-history.ts
CACHE=reports/analyst-cache/natgasmini-5m-merged.json python3 scripts/natgas-daily-profit-hunt.py
```

Note: Kite’s instruments dump only lists **live/near** months, so history starts at the oldest listed contract’s listing date (~Mar 2026 for the Aug FUT at fetch time).

## Caveats

- ~⅔–¾ green **trade-days**, not every calendar day.
- Avg ~₹60–75/day/lot is a **small** daily book; gas can gap — size carefully.
- Sample is one front-month era (~90 sessions); re-check after rollover.
