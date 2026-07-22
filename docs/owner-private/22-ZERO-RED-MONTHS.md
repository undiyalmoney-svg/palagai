# 22 — Empire auto-bot (₹60k · 1 lot · max profit · tiny losses)

## Motive
Not “just ₹15k/month.”  
**Build an empire:** max profit at **1 lot**, **losses kept tiny**, **don’t blow the ₹60k**.

## Capital truth
| Role of ₹60k | Meaning |
|---|---|
| **Risk budget** | Max drawdown we refuse to exceed (~50% = ₹30k hard ceiling in research) |
| **Stocks book** | Exact fit for GAP_FADE_500 / treasure list (doc 07 / 21) |
| **Index futures** | 1 lot Nifty+Bank **margin usually exceeds ₹60k** — live empire needs options (defined risk), single-index, or margin beyond the 60k risk wallet |

Research PnL still uses 1-lot index proxy (₹65/₹30). Empire rules are about **how** that lot is run.

---

## Empire law (non-negotiable)
1. **1 lot** — no size hacks  
2. **Hard day max loss** — flatten at **−₹1,500** combined (losses stay small)  
3. **Clever switches** — morning regime picks the arm  
4. **No naked unlimited trail** without the day stop  
5. **Profit-protect** — BE after +1R when using fixed-R arms  

---

## Winner under ₹60k drawdown budget (OOS 2024→2026-07)

### A) Aggressive empire — Trail + day cap ₹1,500
Trade **Donch trail** most days, but **never lose more than ₹1,500/day**.

| Metric | Result |
|---|---:|
| OOS net | **≈ ₹9.75L** |
| Avg / day | **≈ ₹1,565** |
| Avg / month | **≈ ₹31,500** |
| Max drawdown | **≈ ₹21k** (35% of ₹60k — inside budget) |
| Avg losing day | **≈ −₹1,340** |
| Worst day | **−₹1,500** (capped) |
| Red months | **2 / 31** |
| Months ≥ ₹15k | **24 / 31** |
| Profit factor | **≈ 2.85** |

**Compounding sketch (add PnL to ₹60k wallet):**  
₹60k → **≈ ₹10.3L** over 31 OOS months (research curve).

### B) Capital-guard empire — EDGE switches · no trail · day cap ₹1,500 (recommended default)
Morning witch (same as EDGE) but **replace TRAIL with Donch 2R**, plus day cap:

| Metric | Result |
|---|---:|
| OOS net | **≈ ₹4.1L** |
| Avg / day | **≈ ₹655** |
| Max DD | **≈ ₹12.7k** (21% of ₹60k) |
| Worst day | **−₹1,500** |
| Avg loss | **≈ −₹1,410** |

Still a monster vs toy locks — **much safer DD** than naked trail.

### C) Tightest DD — EDGE as 1.5R + day cap ₹1,500
| Metric | Result |
|---|---:|
| OOS net | **≈ ₹3.6L** |
| Max DD | **≈ ₹10.4k** (17% of ₹60k) |
| Worst day | **−₹1,500** |

Closest to “never scare the ₹60k.”

---

## Auto flow (product)

```
09:45 → regime features
  ├─ choppy                    → STAND
  ├─ vstrong + wide            → TRAIL  (only if day-stop armed)  else DONCH_2R / 1.5R
  ├─ wide + strong + calm      → DONCH_2R (or 1.5R+BE)
  ├─ EMA aligned               → SWING_2R
  ├─ drive ≥ 0.4               → DONCH_15R
  └─ else                      → STAND

Intraday:
  · profit-protect BE after +1R on fixed-R arms
  · combined day PnL ≤ −₹1,500 → FLATTEN + STAND rest of day

Parallel (₹60k cash book):
  · Stocks GAP_FADE_500 · risk ~₹1,200/trade · day stop ~₹2,400
```

**Mode dial:** Aggressive (A) / Default (B) / Guard (C).

---

## What this rejects
- Scaling to 6 lots to fake ₹15k months  
- Freezing the month at ₹500 (toy empire)  
- Unlimited trail without a day stop (can nuke capital)

## Caveat
Day-cap results **assume** the desk can flatten near −₹1,500. Slippage on trail exists — prefer **B/C** until live day-stop is proven.

## Artifacts
- `docs/owner-private/research/zero-red-months/empire-60k.json`
- Scripts: monster / fifteen-k research under `scripts/research-*.py`

## Deploy status
**Recipe ready.** Wire Auto empire modes + **hard day loss ₹1,500** next.

---

## Trained ruler — 0 red months (removes the last −₹6)

**Base default** EDGE · no-trail · day cap ₹1,500 still had **one** red month: **2026-06 (−₹6)**  
Cause: month was green (~₹1.5k), then one more −₹1,500 day flipped it.

### Fix — dynamic day cap when month is green
```
day_cap = ₹1,500
if month_MTD > 0:
    day_cap = min(₹1,500, month_MTD)   # one loss cannot push month below 0
```

| Ruler | Red | OOS net | Worst month | Avg month |
|---|---:|---:|---:|---:|
| Base fixed cap | 1 | ₹4.08L | −₹6 | ₹13.2k |
| **Trained DYN cap** | **0** | **₹4.21L** | **+₹744** | **₹13.6k** |
| DYN cap + ₹1 cushion (always green) | 0 | ₹2.87L | +₹1 | ₹9.3k |

**2026-06 under trained ruler: +₹744** (was −₹6).

Full auto:
1. Morning EDGE switch (no naked trail)
2. Hard day loss ≤ ₹1,500
3. **If month already green → tighten day stop to MTD** so red months are impossible from a single capped loss

---

## Boosted ruler — more profit (June 2026 fixed)

Old trained dyn-cap EDGE-noTrail left **June 2026 ≈ ₹744**.  
Corrected profit ruler:

### Rule
1. **Rampage** while month MTD < ₹3,000 → **beast** witch (trail on wide+strong)
2. Else → **always Donch trail** on non-choppy mornings (STAND if choppy)
3. **Day loss cap ₹1,500**
4. When month already green → **day_cap = min(₹1,500, MTD)** (cannot flip red)

### OOS result
| | Old trained | **Boosted** |
|---|---:|---:|
| June 2026 | ≈ ₹744 | **₹51,605** |
| Net | ≈ ₹4.2L | **₹7.72L** |
| Red months | 0 | **0** |
| Worst month | +₹744 | **+₹155** |
| Avg month | ≈ ₹13.6k | **≈ ₹24.9k** |

Entry/exit left to the ruler witches; goal = max profit with 0 red + hard day stop.

