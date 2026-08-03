# 39 — Natural Gas Mini daily-profit DNA (2026-08-03)

**Status:** Research candidate (proxy data) · **not** live-wired  
**Instrument:** `NATGASMINI` · ₹50/pt · strike step 5  
**Data:** Yahoo `NG=F` × **85** → MCX-pts proxy (Kite auth expired → no true MCX merge)  
**Scripts:** `scripts/natgas-daily-profit-hunt.py` · `scripts/fetch-natgasmini-history.ts`  
**Artifact:** `reports/natgas-daily-profit/` (gitignored)

## Goal

Closest thing to a **daily-profit** book on Nat Gas Mini (high green-day rate, small SL, confirm).

## Sweep

676 Trap / evening-PDHL / morning-ORB / SOR configs on **60m proxy** (2024-03-11 → 2026-08-03), walk-forward last 30%, then confirmed on **5m** (2026-05-22 → 2026-08-03).

## Wire candidate

```
DNA:     trap_sl1.5_tp3_L0_S3.0_fw1_c1_p0.5
Entry:   S/R trap · pierce 0.5 · EMA50 bias · next-bar confirm ON
Stop:    1.5 pts  (₹75 / lot)
Target:  3.0 pts  (₹150 / lot)
Session: 10:00–22:00 IST
Max/day: 2
First-win lock: ON
Day loss: 3.0 pts (₹150)
Day lock: 0
```

| Sample | Green% | ₹/day | PF | Trade-days | Worst day | Notes |
|--------|-------:|------:|---:|-----------:|----------:|-------|
| 60m IS (2y) | 66.7 | ~72 | 3.78 | 99 | −75 | Primary |
| 60m OOS (last 30%) | 64.0 | ~58 | 2.93 | 25 | — | Survived WF |
| 5m recent | 66.7 | ~67 | 3.00 | 9 | −150 | Same DNA #1; thin window |

## Desk map

1. Experiments → **Nat Gas Mini**
2. Trap-style + confirm · SL/TP as above (do **not** copy Crude Daily Profit’s 20/40 pts — that book is ₹10/pt crude)
3. Paper 1 lot first

## Refresh real MCX bars

```bash
# after Get Token / fresh .kite-auth
FROM=2025-01-01 npx tsx scripts/fetch-natgasmini-history.ts
CACHE=reports/analyst-cache/natgasmini-5m-merged.json python3 scripts/natgas-daily-profit-hunt.py
```

## Caveats

- Proxy basis (NG=F×85) ≠ live NATGASMINI — **re-validate on Kite** before real money.
- ~⅔ green trade-days ≠ “profit every calendar day.”
- Avg ~₹60–75/day/lot is a **small** daily-income book; size carefully on gas volatility.
