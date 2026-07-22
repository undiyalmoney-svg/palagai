# 25 — Deep research: ≥ ₹1,000 average daily profit (Nifty + Bank)

**Status:** Research only — **no product / strategy code was changed**  
**Date:** 2026-07-22  
**Script:** `scripts/daily-1000-deep-research.py`  
**Machine report:** `/tmp/daily-1000-deep-research/report.json` (reproduce locally)  
**Data:** 5-minute OHLC caches · **2020-01-01 → 2026-07-21** · **1,601** sessions  
**Money:** Nifty ₹65/pt + Bank ₹30/pt · **1 lot** · research day soft-clip **−₹500**

---

## Executive Summary

**Stop condition (1) is met.**

A historically validated framework achieves **≥ ₹1,000 average daily profit** on walk-forward out-of-sample windows, with **zero red months** on the full cache and a hard day-loss bound of ₹500.

| Framework | Train avg | Valid avg | 2026 avg | Full avg | Max DD | Red months | Notes |
|---|---:|---:|---:|---:|---:|---:|---|
| **Current Ruler v1.12** | 967 | **1,322** | **1,482** | **1,119** | **4,703** | **0** | Lowest DD among target-clearing OOS books; Angular DNA already live |
| Always Donch trail (dyn0) | **1,876** | **1,542** | **3,005** | **1,868** | 5,746 | 0 | Highest expectancy; median day **−₹249**; more red sessions |
| Trail-wide-else-2R (no beast/hunter/edge) | **1,295** | **1,550** | **2,927** | **1,509** | 6,000 | 0 | Hard train+valid ≥₹1k; higher DD than Ruler |

**Research recommendation for implementation (when allowed):** keep **Ruler v1.12** as the production framework for the dual objective *avg ≥ ₹1,000* **and** *drawdowns as low as reasonably possible*. Higher-average trail-heavy books clear the profit target but **increase** max drawdown and red-session density.

This is **average daily profit**, not ₹1,000 every calendar day (~27.5% of Ruler sessions print ≥ ₹1,000; median session ₹0 from STAND / flat days).

---

## Best Performing Framework (product-ready)

### Name
**Ruler flow v1.12** (research book identity: `current_ruler_v1_12`)

### Recipe (causal, 09:45 features)
1. While **0 ≤ MTD < ₹3,000** → beast witch (selective entries)
2. While **MTD < 0** → hunter recover
3. Else → **Donch trail on wide** mornings; else Donch 2R / Swing 2R
4. After **2 clipped red days** → edge witch for rest of month
5. Shared arm for Nifty + Bank
6. Day loss soft-clip **₹500** (Angular hard-flattens intraday in Testing + Live)
7. **No month bank** (keep trading past ₹15k MTD)

### Why this beats “always trail” for the stated objective
Always-trail and trail-else-2R beat Ruler on average profit, but:

| Metric (full 2020–2026) | Ruler | Always trail | Trail-else-2R |
|---|---:|---:|---:|
| Avg daily | 1,119 | 1,868 | 1,509 |
| Max drawdown | **4,703** | 5,746 | 6,000 |
| Median session | **0** | **−249** | 0 |
| Max consecutive losses | **7** | 11 | 12 |
| Profit factor | 6.93 | 8.46 | 7.50 |

Ruler is the **Pareto choice** when “keep losses/drawdowns as low as reasonably possible” is co-equal with the ₹1,000 average.

---

## Complete Backtest Results — Ruler v1.12

Walk-forward (selection never used 2026 for choosing Ruler DNA; DNA predates this study):

| Window | Sessions | Traded % | Total ₹ | Avg/day | PF | Max DD | Win% traded | ≥₹1k days | Red months | Worst month |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Train 2020–2023 | 978 | 71.3% | 946,042 | 967 | 6.42 | 4,703 | 48.6% | 26.7% | 0 | 4,142 |
| Validation 2024–2025 | 490 | 80.4% | 647,782 | **1,322** | 7.59 | 3,791 | 47.5% | 28.4% | 0 | 5,528 |
| Test 2026 | 133 | 84.2% | 197,050 | **1,482** | 7.74 | 2,733 | 47.3% | 30.8% | 0 | 9,164 |
| **Full 2020–2026** | **1,601** | **75.1%** | **1,790,874** | **1,119** | **6.93** | **4,703** | **48.1%** | **27.5%** | **0** | **4,142** |

### Yearly totals (Ruler)
| Year | Net ₹ |
|---|---:|
| 2020 | 232,230 |
| 2021 | 355,400 |
| 2022 | 212,738 |
| 2023 | 145,675 |
| 2024 | 348,531 |
| 2025 | 299,251 |
| 2026 (through Jul 21) | 197,050 |

### Arm contribution (full history)
| Arm | Days used | Avg ₹ | Total ₹ | Win rate |
|---|---:|---:|---:|---:|
| DONCH_TRAIL | 399 | 2,288 | 912,823 | 34.1% |
| SWING_2R | 614 | 1,125 | 690,861 | 54.4% |
| DONCH_2R | 136 | 986 | 134,126 | 52.2% |
| DONCH_15R | 63 | 842 | 53,063 | 60.3% |
| STAND | 389 | 0 | 0 | — |

Trail days win less often but dominate expectancy (fat winners). Swing/2R days win more often with capped R-multiples.

---

## Performance Statistics (full history, Ruler)

| Metric | Value |
|---|---:|
| Total profit | ₹1,790,874 |
| Average daily profit | ₹1,119 |
| Average traded day | ₹1,489 |
| Win rate (traded sessions) | 48.1% |
| Profit factor | 6.93 |
| Avg win / avg loss (R:R) | 7.47 |
| Max drawdown | ₹4,703 |
| Max consecutive wins | (see report) |
| Max consecutive losses | 7 |
| Risk per day (hard bound) | ₹500 |
| Return on capital | Not modeled (futures point proxy; no margin schedule in cache) |
| Stability | 0 red months · every year net green · OOS avgs above target |

---

## Monthly Performance Estimate

From **79** calendar months in-cache (Ruler):

| Estimate | ₹ |
|---|---:|
| Average month | **~22,700** |
| Worst month | **4,142** (2022-07) |
| Best month | **74,098** (2024-06) |

Example Junes: 2024 ₹74,098 · 2025 ₹27,808 · 2026 ₹9,567 (green but below ₹1k/day average that month).

---

## Risk Analysis

1. **Day risk is bounded at ₹500** by design (soft clip in research books; Angular Testing/Live hard-flatten).
2. **Path drawdown** can still reach ~₹4.7k from equity peak (sequence of capped reds + STAND).
3. **Fat-tail dependence:** ~¼ of days make the average; skipping “small drive” or weekdays **hurts** expectancy (ablation below).
4. **Soft EOD clip ≠ live fill:** research uses completed ARM books then clips. Live already hard-flattens; prior Angular vs research parity is within a few percent on 2025–26.
5. **Costs / options theta** not fully modeled. Stress with ₹25–₹75/trade before sizing up lots.
6. **No 2018–2019** in cache — conclusions are 2020–2026 only.

---

## What Separates Wins From Losses (evidence)

Condition buckets on Ruler full history (when the morning flag is true):

| Morning condition | n | Avg ₹ | Win% of traded | Avg win | Avg loss |
|---|---:|---:|---:|---:|---:|
| **vwide** OR | 326 | **1,845** | 46.3% | 4,889 | −484 |
| **drive ≥ 0.5** | 761 | **1,726** | 47.6% | 4,249 | −478 |
| **strong** | 854 | **1,672** | 48.0% | 4,090 | −480 |
| **wide** | 818 | **1,641** | 44.9% | 4,612 | −483 |
| calm | 544 | 1,333 | 47.2% | 4,313 | −478 |
| trend (EMA) | 1,267 | 1,179 | 48.5% | 3,497 | −485 |
| gap ≤ 1 ATR | 354 | 1,047 | 46.3% | 3,644 | −478 |
| gap > 1.5 ATR | 1,051 | 1,014 | 48.6% | 3,268 | −487 |
| **drive < 0.3** | 478 | **249** | 44.5% | 2,439 | −491 |
| choppy | 286 | 0 | — | — | — (STAND) |

**Winners:** wide / strong / high-drive mornings → trail book captures outsized R.  
**Losers:** still ~same −₹480 average when capped; edge is **not** avoiding all losses but **keeping them small** while letting wide days run.  
**Always avoid (already in Ruler):** choppy mornings → STAND.

---

## Days / Times / Filters

### Day of week (Ruler full avg ₹/session)
| Day | Avg |
|---|---:|
| Monday | **1,633** |
| Thursday (weekly expiry proxy) | **1,245** |
| Friday | 1,060 |
| Tuesday | 861 |
| Wednesday | 783 |

Ablation: **skipping any weekday lowers** full-history average (e.g. skip Monday → avg ₹787 and introduces red months). Do **not** drop Mondays/Fridays for “safety.”

### When no trade
- Choppy morning (Ruler STAND)
- Beast/edge/hunter witches refuse the setup
- After −₹500 day lock

### Time of day
ARM books already encode entry windows (typically post-OR ~09:45+). This study did not re-optimize intrabar clocks beyond existing DNA; prior universe searches found 10:15 starts often reduce coverage more than they help expectancy for trail books.

### News / volume
No news labels in cache. Volume proxies were not required to clear the ₹1,000 average once morning width/drive + trail/2R router + day-cap are in place. Treat news as unmodeled residual risk.

---

## Trade Management Findings

| Idea | Evidence |
|---|---|
| One trade vs multi | Trail arm is multi-trade and dominates total ₹; fixed 2R arms are 1-trade and stabilize win rate |
| Hold winners longer | Trail >> fixed 1.5R/2R on expectancy (always-trail full avg ₹1,868 vs always-2R ₹882) |
| Early / fixed small TP sniper | **NO_GO** in prior work (docs 23) — cannot clear ₹1k robustly on 5m stop-first fills |
| Partial profits | Not modeled in ARM books; not required to hit target |
| Day loss ₹500 | Essential for zero red months + bounded DD |
| Dyn0 cap (cap ≤ MTD when green) | Nearly identical to fixed ₹500 on always-trail; keeps month from flipping red after a big winner |
| Extra avoid filters (gap, no-trend, low-drive) on Ruler | **Reduce** train average (see avoid scan) — Ruler already selective enough |

### Avoid-scan (train): forcing extra skips on Ruler
Best “skip” is choppy (already ₹0). Skipping low-drive / no-trend / weekdays all **cut** train avg (e.g. skip drive&lt;0.5 → −₹255/day).

---

## Iterative Search Exhaustion

1. Compared 9 frameworks (Ruler, always each ARM, wide-only trail, trail-else-2R, fixed-cap trail).
2. Gated **2,400** single-arm policies (width × drive × gap × trend × calm × arm × cap mode).
3. **Joint hits** (train+valid avg ≥ ₹1,000 **and** 0 red months): **2** — both Donch-trail with loose gates (effectively always-trail).
4. Always-trail beats Ruler on a risk-adjusted score `valid_avg − 0.05·DD + 50·PF`, but **worsens median day and loss streaks**.
5. For the stated dual objective, further ARM-book search does not produce a successor that **raises average without raising drawdown**. Stop condition (1) satisfied; max-expectancy branch documented but not recommended for low-DD priority.

Rejected paths (prior + this study): fixed ₹250/₹150 sniper, trailing sniper grids, “≤3 red sessions/month + ₹1,500 avg” joint target, weekday deletion filters.

---

## Strengths

- Clears ₹1,000 **average** OOS and full history at 1 lot  
- **Zero** red months 2020–2026 in research books  
- Hard day loss bound  
- Causal morning features only  
- Angular implementation already exists and matched research arms historically  

## Weaknesses

- Train avg ₹967 slightly under ₹1,000 (discipline / STAND cost)  
- Only ~28% of days ≥ ₹1,000 — psychologically lumpy  
- Soft research clips vs live microstructure  
- No options premium / slippage stress in primary numbers  
- Cache starts 2020 (no 2018–19 crisis sample beyond COVID era in-cache)  

## Performs best when

- Wide / very-wide opening range  
- Drive ≥ 0.5 / strong morning  
- Trail arm selected after beast phase  

## Performs poorly when

- Low-drive / narrow mornings (many STAND or small expectancy)  
- Sequences of capped −₹500 days (DD buildup)  
- Individual months like 2026-06 (₹9.6k total — still green, below ₹1k/day pace)  

---

## Recommended Implementation Order

*(Research guidance only — this mission did not implement.)*

1. **Keep Ruler v1.12 live** (already default on Nifty/Bank).  
2. Paper/Testing confirmation with 1 lot and −₹500 day rule (already wired).  
3. Optional later research (not required for target): Angular hard-flatten parity for `trail_wide_else_2r_no_router` / always-trail if owner prioritizes **max average** over **min DD**.  
4. Do **not** implement sniper fixed-TP books for this target.  
5. Cost-stress and lot-sizing only after 1-lot live stability.

---

## Confidence Level

| Claim | Confidence |
|---|---|
| ≥ ₹1,000 avg/day achievable at 1 lot on this cache | **High** (multiple frameworks; OOS clear) |
| Ruler is best **low-DD** way to clear the target among tested books | **High** |
| Always-trail is higher expectancy | **High** |
| ₹1,000 **every** day | **Refuted** on this data |
| Results survive heavy costs / regime shift post-2026 | **Medium** — stress before scaling lots |
| News-day edge | **Low** — unlabelled |

**Overall confidence that stop condition (1) is correctly declared:** **High**.

---

## Reproduce

```bash
python3 scripts/daily-1000-deep-research.py
# → /tmp/daily-1000-deep-research/report.json
```

Requires shared helper `/tmp/ruler-profit-boost.py` (same as other Ruler research scripts).

---

## Related docs

- **22** — ₹1,500 + ≤3 red sessions/month → joint **NO_GO**  
- **23** — ₹250/₹150 sniper → **NO_GO**  
- **24** — shorter ₹1,000 decision note (Ruler GO)
