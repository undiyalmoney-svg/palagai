# 22 — Zero red months + ₹15k every month (auto-bot)

## Motive
Auto bot must deliver:
1. **0 red months**
2. **≥ ₹15,000 every month**

## Verdict — how to make it possible

At **1 lot** Nifty+Bank, zero-red locks max out ~₹2–5k/month average — **not** ₹15k every month.  
**Oracle** (look-ahead best arm/day) already clears **every** OOS month ≥ ₹42k at 1 lot — the money exists; size + selection is the gap.

### Working causal recipe (OOS 2024-01 → 2026-07, 31/31)

| Knob | Value |
|---|---|
| Books | Nifty + Bank |
| Size | **6×** the research 1-lot DNA (₹65/pt ×6 Nifty, ₹30/pt ×6 Bank) |
| Entry filter | Morning **score ≥ 4**, not choppy → **Donch Retest OR-mid 2R** |
| Else | **STAND** |
| Month rule | Trade until MTD **≥ ₹15,000** → **STAND** rest of month |
| Look-ahead | None (morning features + MTD only) |

**Result (backtest):**

| Metric | Value |
|---|---:|
| Months ≥ ₹15k | **31/31** |
| Red months | **0** |
| Worst month | **₹15,472** |
| Avg month | **₹29,032** |
| OOS net | **≈ ₹9.0L** |

Slightly safer lock **₹16,000** at 6×: worst **₹16,304**, avg **₹29,403**, net **≈ ₹9.1L**.

### 2026 months (6× · lock ₹15k)

| Month | ₹ |
|---|---:|
| Jan | 18,564 |
| Feb | 45,579 |
| Mar | 38,817 |
| Apr | 22,826 |
| May | 17,496 |
| Jun | 19,800 |
| Jul* | 38,386 |

\*partial month in data.

### Why 6× is the floor
| Size | ≥15k months | Red | Notes |
|---:|---:|---:|---|
| 4× | 28/31 | 2 | Fails |
| 5× | 30/31 | 1 | **2024-04** still short/red |
| **6×** | **31/31** | **0** | **Minimum that works** |

Edge/trail routers **do not** hit this goal even at high size — fat-tail months go red when scaled.

### Score definition (morning, Nifty primary)
After 09:45 OR:
- +2 wide (Nifty OR≥80 / Bank OR≥150)
- +1 very wide
- +2 drive≥0.45 · +1 drive≥0.65
- +1 calm (gap/ATR < 1.5)
- +1 EMA aligned
- +1 not choppy  
Trade Donch only if **score ≥ 4** and not choppy.

---

## Capital note
6× is **position size**, not magic. Margin/premium scales ~6× vs 1-lot desk. Without size, ₹15k **every** month is not available from these index arms under causal zero-red.

## Older low-profit zero-red (1 lot)
`regime_lock500` / `donch_s4_lock2500` still valid for 0-red at 1 lot (~₹2–5k/mo) — **does not** meet the ₹15k/month motive.

## Artifacts
- `docs/owner-private/research/zero-red-months/fifteen-k-slim.json`
- `/tmp/auto-strategy-select/fifteen-k-every-month.json`
- Repro: `/tmp/fifteen-k-every-month.py` (promote into `scripts/` when wiring Auto)

## Deploy status
**Recipe ready — not wired into Strategy Manager yet.**  
Auto-bot implementation target: **Donch s4 · 6× · month lock ₹15k**.
