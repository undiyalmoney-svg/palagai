# 16 — Vehicle comparison: can VolExpand run profitably on traded instruments?

**Strategy:** VolExpand Donchian-15 + EMA-50 bias → EOD · entries 10:15–11:30 · 1 trade/day  
**Sample:** OOS 2024–2026 · **569** signals (Nifty 282 + Bank 287)  
**Script:** `npm run research:vehicle-comparison` → `/tmp/vehicle-comparison/summary.json`  
**Artifacts:** `reports/vehicle-comparison/`

---

## Verdict

**Futures / synthetic futures: yes. ATM weekly options (live desk path): no.**

Index OOS expectancy (~+14.9 pts) survives futures fees and synthetic friction. It does **not** survive a realistic ATM weekly options model (delta capture minus theta + spread). The paper-desk **0.5Δ fallback looks green but is misleading** — it ignores theta.

| Vehicle | OOS exp ₹ | Net ₹ | WR | PF | Nifty exp | Bank exp | Call |
|---|---:|---:|---:|---:|---:|---:|---|
| Index proxy | **+614** | +349k | 20% | 1.51 | +623 | +605 | baseline |
| **Nifty/Bank futures** | **+554** | +315k | 20% | 1.44 | +563 | +545 | **GO** |
| **Synthetic futures** | **+399** | +227k | 20% | 1.29 | +373 | +425 | **GO** |
| ATM weekly (desk 0.5Δ, no θ) | +227 | +129k | 20% | 1.34 | +232 | +222 | optimistic only |
| **2-step ITM weekly** | **+109** | +62k | 20% | 1.09 | +25 | +192 | GO (fragile on Nifty) |
| Monthly ATM | +54 | +31k | 20% | 1.07 | +11 | +96 | GO (thin on Nifty) |
| 1-step ITM weekly | +38 | +22k | 20% | 1.04 | **−49** | +123 | CONDITIONAL |
| **ATM weekly realistic** | **−40** | **−23k** | 19% | 0.95 | **−132** | +50 | **NO_GO** |

Lots: Nifty **65**, Bank **30** (current NFO). Fees: futures ₹60 RT, options ₹80, synthetic ₹120 + ~2 pt friction.

---

## Why ATM weekly fails

Mean OOS index move is **+9.6 pts (Nifty)** / **+20.2 (Bank)**.

ATM weekly captures ~0.5× that in premium, then pays:

- **Theta** over a morning→EOD hold (scaled by DTE; base full-day θ ≈ 8 premium pts @ DTE~3)
- **Spread/slip** ≈ 2 premium pts RT

Nifty break-even under base model: expected premium ≈ **+0.2 pts** → **−₹68/trade after fees**. Bank still scrapes positive on higher index expectancy, but combined is red.

### Theta sensitivity (ATM weekly, combined)

| Full-day θ (prem pts) | OOS exp ₹ | Still +? |
|---:|---:|:---:|
| 0 (spread only) | +72 | yes |
| 4 | +16 | marginal |
| **6** | **−12** | **no** |
| 8 (base) | −40 | no |
| 12 | −96 | no |

Edge dies once daily theta ≳ **~5–6 premium pts** — well inside normal weekly ATM behaviour.

---

## Desk delta vs reality (live calibration)

Kite **cannot** supply multi-year expired option 5m fills (tokens leave the instruments dump). Four recent live-contract fills (Jul 2026) were checked:

| Date | Index pts | Real prem Δ | Desk 0.5Δ | Realistic model |
|---|---:|---:|---:|---:|
| 2026-07-14 Nifty SELL | −30 | **−19.5** | −15.0 | −18.8 |
| 2026-07-16 Nifty BUY | −22 | **−18.5** | −11.2 | −19.5 |
| 2026-07-17 Nifty BUY | −30 | **−20.9** | −15.0 | −19.2 |

On losers, **real premium fell harder than 0.5× index**. The realistic model tracked fills; the desk fallback was too kind. (One Bank sample was noisy / near-expiry oddity — not used as proof.)

---

## Market structure (live)

- **Nifty:** weeklies still listed (plus monthlies).
- **Bank Nifty:** live NFO chain is **monthly-only** (no weeklies). Live Bank path ≠ “ATM weekly”; use **futures** or **monthly options**.
- Historical Bank weeklies in this study are a **counterfactual** vehicle for comparison, not today’s attach path.

---

## Per-vehicle notes

1. **Futures** — Best match to the index research. Same-day EOD → basis ≈ 0. Both indices strongly green. **Preferred live vehicle** if the desk can attach futures (resolver exists; not wired today).
2. **Synthetic futures** — CE−PE ≈ futures with double costs; still clearly green. Useful if futures segment unavailable but options are.
3. **ATM weekly (live desk today)** — **Do not deploy** this foundation on ATM weeklies expecting the index +14.9 to show up in option ₹.
4. **ITM1 / ITM2 weekly** — Higher delta helps; ITM2 clears both indices under base assumptions but Nifty expectancy is thin (+₹25). Worse liquidity / wider spreads than ATM — treat as research, not auto-deploy.
5. **Monthly ATM** — Lower theta helps; Nifty barely green. Aligns better with **Bank’s live monthly-only** chain; still weak vs futures.
6. **Desk 0.5Δ paper P&L** — Useful UI fallback only. **Not** a profitability certificate.

---

## Recommendation

| Priority | Action |
|---|---|
| 1 | If deploying VolExpand: **trade Nifty + Bank futures** (or synthetic), not ATM weeklies. |
| 2 | Keep **ATM weekly live desk** on hold for this DNA until a higher-expectancy / shorter-hold / ITM path is proven on real premiums. |
| 3 | Optional research: ITM2 or monthly on Nifty-only with prior-day regime filter (from doc 15) — still second to futures. |
| 4 | Do **not** change production Champion DNA from this note; this is vehicle research on the universe-search foundation. |

---

## Method limits

- Options OOS P&L is **modelled** (delta − θ − spread), not multi-year tape. Directionally consistent with live spot-checks and with doc 15’s “edge dies ~15 pts RT” stress.
- Futures P&L = index pts × lot − fees (same-day). Continuous futures 5m for expired months not required for this hold style.
- Lot sizes are **current** (65 / 30). Older years had different lots; ₹ ranking is “if we trade this way now.”

```bash
npm run research:vehicle-comparison
# → /tmp/vehicle-comparison/summary.json
```
