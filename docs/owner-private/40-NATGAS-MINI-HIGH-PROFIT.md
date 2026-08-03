# 40 — Nat Gas Mini high-profit / multi-trade DNA (2026-08-03)

**Status:** Research candidate · OOS-stable multi-trade · **not** live-wired  
**Companion:** Doc **39** = max-1 daily-profit (higher OOS ₹/day, fewer trades)  
**Data:** Kite MCX NATGASMINI 5m · 2026-03-30 → 2026-08-03 · OOS from 2026-07-01  
**Scripts:** `scripts/natgas-high-profit-hunt.py` · `scripts/natgas-high-profit-oos-hunt.py`  
**Artifact:** `reports/natgas-high-profit/` (gitignored)

## Goal

More **₹/day** and more **trades/day** than doc 39’s max-1 trap.

## Reality check

| Book | IS ₹/d | IS tpd | OOS ₹/d | OOS tpd | OOS green | Notes |
|------|-------:|-------:|--------:|--------:|----------:|-------|
| Doc 39 max-1 trap SL1.5/TP3 | 61 | 1.0 | **74** | 1.0 | 75% | Best OOS ₹/day |
| **This wire** bounce SL5/TP10 trail | **81** | **2.3** | 44 | **2.0** | **76%** | More trades; OOS still +EV |
| Bounce SL2/TP4 m4 (IS leader) | 78 | 2.7 | **−16** | 2.3 | 36% | Overfit — do not wire |

No multi-trade book beat doc 39’s **OOS ₹/day** on this sample. The win is **~2 trades/day** with **positive OOS** and higher in-sample profit.

## Wire candidate (multi-trade)

```
DNA:     bounce_sl5_tp10_m5_c1_p0.5_full_tr3-1.5_S15
Entry:   Soft bounce (touch swing + reclaim) · pierce 0.5 · EMA50 · next-bar confirm ON
Stop:    5 pts (₹250) · trail after +3 pts → stop at best−1.5
Target:  10 pts (₹500)
Session: 10:00–22:00 IST
Max/day: 5
First-win: OFF
Day loss: 15 pts (₹750)
Cooldown: 1 bar after exit
```

| Sample | ₹/day | tpd | Green% | PF | Days | Worst |
|--------|------:|----:|-------:|---:|-----:|------:|
| IS (full) | **80.5** | **2.28** | 63.1 | 1.67 | — | — |
| OOS (≥2026-07-01) | **43.6** | **1.95** | 76.2 | 1.53 | — | — |

Near-ties (same OOS stats): `bounce_sl5_tp15_m4…tr3-1.5` / `…m5…S20` — prefer SL5/TP10 as cleaner R=2.

## Desk map

1. Experiments → **Nat Gas Mini**
2. Bounce / soft S/R reclaim (not strict pierce-trap) + confirm  
3. SL 5 / TP 10 / trail 3→1.5 · up to 5 entries · no first-win lock  
4. Paper 1 lot — worst day can be larger than the max-1 book (−₹250/stop)

## When to use which

- **Want steadier OOS ₹/day, fewer fills:** doc **39** (`trap_sl1.5_tp3…p0.2_m1`)
- **Want more action / more IS profit:** this doc **40** bounce SL5/TP10 trail

## Caveats

- One front-month era only; re-hunt after rollover.
- More trades ⇒ more costs; include brokerage before going live.
- Tight bounce SL2/TP4 books look great in-sample and **fail OOS** — ignore those.
