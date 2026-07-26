# 31 — S/R Trap + Confirm (legend max-earn ceiling)

**Date:** 2026-07-26  
**Status:** **Wired as Nifty/Bank Paper+Live default** (`sr-trap-confirm`) · DNA max-trades auto-sync on strategy switch  
**GENIE:** remains selectable (no longer the indices default)  
**Script:** `scripts/sr-trap-confirm-max-earn-hunt.py`  
**Reports:** `reports/sr-trap-max-earn/summary.json` · `champion-detail.json`  
**Proxy:** Nifty pts × ₹65 · Bank pts × ₹30 · 1 lot each  
**Walk-forward:** train 2020–2023 · test 2024–Jul 2026  
**Fill realism:** next-bar confirm enters at **next open** (not stale prior close)

### App caps

| Channel | Default strategy | Max trades/day |
|---------|------------------|----------------|
| Nifty | S/R Trap · Confirm | **3** |
| Bank | S/R Trap · Confirm | **3** |

## Friend decode (what we hunted)

| His words | Coded DNA |
|-----------|-----------|
| Support / resistance zones | Causal swing high/low (lookback 5) |
| Find **traps** | Liquidity sweep: wick **beyond** level, close **back inside** |
| Confirm | **Next bar** continues in trap direction + EMA50 bias |
| Support reaction → buy | Bear trap at swing low |
| Resistance reaction → sell | Bull trap at swing high |
| Max earn (not 2% scalp) | Target **3–3.5R**, stop beyond trap wick |

**Critical discovery:** same-bar entry ≈ **dead** (OOS ~₹12k, PF ~1.0).  
**Next-bar confirm** is the whole edge — matches “trap **and** confirm.”

## Profits printed (validated)

### vs GENIE (OOS 2024+)

| Book | Net | Avg/day | Red% | Max DD | PF |
|------|----:|--------:|-----:|-------:|---:|
| **GENIE** (live default) | ₹3,21,283 | ₹523 | 35.7% | −₹34,119 | 1.58 |
| **TRAP + next confirm · rr3.5** | **₹6,43,849** | **₹1,049** | 37.0% | −₹15,452 | 2.90 |
| **TRAP + bounce · p3 · rr3.5** | **₹6,81,152** | **₹1,109** | 37.8% | −₹13,901 | 2.72 |
| **TRAP + bounce · p3 · rr2.0** (smoothest) | **₹6,73,265** | **₹1,097** | **28.8%** | −₹10,329 | **3.55** |

Edge vs GENIE (pure trap rr3.5): **+₹3.22L OOS · +₹526/day**.

### Pure trap DNA — year by year (all green)

| Year | Trap rr3.5 net |
|------|---------------:|
| 2020 | ₹1,75,980 |
| 2021 | ₹2,88,148 |
| 2022 | ₹2,38,096 |
| 2023 | ₹2,63,586 |
| 2024 | ₹2,33,820 |
| 2025 | ₹2,04,841 |
| 2026* | ₹2,05,189 |

\*partial year

### Legs (OOS, trap rr3.5)

| Leg | Net | Avg/day |
|-----|----:|--------:|
| Nifty | ₹4,16,475 | ₹678 |
| Bank | ₹2,27,375 | ₹370 |

## Champion rules (research — not wired)

```
Book:     Nifty + Bank (independent desks, 1 lot each)
Entry:    Swing lb=5 trap (wick beyond S/R, close back inside)
Confirm:  NEXT 5m bar continues + close vs EMA50
Stop:     Beyond trap wick (−/+ 2 pts)
Target:   3.5R  (or 2.0R for smoother / higher PF)
Session:  09:45–14:45 IST
Max/day:  3 trades per index
Risk cap: Nifty 4–28 pts · Bank 8–50 pts
```

## Why this is the “legend” path (and why we’re not flipping GENIE yet)

1. **Beats GENIE on net, avg/day, PF, and drawdown** in walk-forward.  
2. DNA matches the friend’s story (zones → trap → confirm → reaction).  
3. Still a **research proxy** (index pts × lot ≠ live option ₹).  
4. No GENIE-style day router yet (Tue skip / drive align) — optional next layer.  
5. **Do not wire over GENIE** until paper-tested live; GENIE stays the known production book.

## Wired as default

Nifty/Bank Paper+Live default = **S/R Trap · Confirm** · max **3** trades/day · **3.5R**.  
Strategy Manager auto-applies DNA max-trades when you switch Paper/Live strategy.

## Recommendation

| Goal | Method |
|------|--------|
| **Max profit (default)** | **S/R Trap · Confirm** |
| Prior smoother book | Align Combo · GENIE (selectable) |
| Paper first | Yes — option ₹ ≠ index proxy |
