# 22 — Monster auto-bot @ 1 lot (clever switches)

## What you asked for
- **1 lot** (not “trade 6× size”)
- **Clever auto flow** — switch strategies like a monster trader
- Path to big months (₹15k spirit) via skill, not leverage

## Hard facts (OOS 2024→2026-07, 1 lot Nifty+Bank)

### 1) Flat ₹500/day is not enough for ₹15k every month
Even with **perfect** arm pick, days where some arm makes ≥₹500 are only ~72% of sessions (~14/month).  
Clipping those to exactly ₹500 → **~₹5–10k/month**, never a full ₹15k every month.

**₹15k/month at 1 lot needs keeping fat wins** (especially Donch trail on the right mornings), not freezing at ₹500.

### 2) Perfect switching (oracle) already clears the motive at 1 lot
If the bot always picked the best arm that day (look-ahead — not tradable):

| | Oracle @1 lot |
|---|---:|
| Every month ≥ ₹15k | **31/31** |
| Red months | **0** |
| Worst month | **≈ ₹42k** |
| Avg month | **≈ ₹76k** |

So the money is there at **1 lot**. The job is a **smarter causal switcher**.

### 3) Best causal monster found so far — EDGE switcher

Morning (after 09:45) picks **one** arm:

| Regime | Arm |
|---|---|
| Choppy | STAND |
| Very strong + wide OR | **DONCH_TRAIL** (let it run) |
| Wide + strong + calm | **DONCH_2R** |
| EMA aligned | **SWING_2R** |
| Drive ≥ 0.4 | **DONCH_15R** |
| Else | STAND |

**OOS @1 lot:**

| Metric | EDGE monster |
|---|---:|
| Avg / day | **≈ ₹450–520** |
| Avg / month | **≈ ₹9–10k** |
| Months ≥ ₹15k | **13–15 / 31** |
| Red months | **~11–12** |
| OOS net | **≈ ₹2.5–3.2L** |

Optional: **freeze month once MTD ≥ ₹15k** → slightly more months hit 15k (15/31), still not all, still some reds.

Learned EV tables / witch mode grids did **not** beat this hand EDGE router out of sample.

---

## Monster flow (product target)

```
09:45 OR → regime features
     ↓
RAMPAGE? (month MTD low) → prefer TRAIL/OR expansion arms
     ↓
HUNT → EDGE switch table above
     ↓
DEFEND (MTD red) → only calm Donch / STAND
     ↓
BANK (MTD ≥ ₹15k) → STAND unless ultra trail setup
```

**1 lot only. Profit from switches + letting winners run.**

---

## What is NOT the answer
- Scaling to 6 lots to force ₹15k every month — size hack, not a better trader
- Tiny month locks (`regime_lock500`) — green months but toy profits

## Gap still open
Causal bot has not yet matched oracle’s **every month ≥ ₹15k @1 lot**.  
Next research: finer intraday switches, per-book witches, shadow arms mid-session — still 1 lot.

## Deploy
Research recipe. Wire Auto = **EDGE monster @1 lot** when implementing (not 6× lock).
