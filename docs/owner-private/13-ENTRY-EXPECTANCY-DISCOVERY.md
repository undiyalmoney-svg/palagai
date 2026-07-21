# 13 — Entry expectancy discovery (pre-filter)

**Question:** What entry conditions have positive expectancy *before* any quality score or weekday overlay?

**Data:** Kite 5m Nifty + BankNifty, 2020-01-01 → 2026-07-21.  
**Split:** train 2020–2023 / test 2024–2026.  
**Constraints shared across concepts:** one position at a time, SL from signal candle (capped 30/45), min risk 3, day stop −60 (unless noted), no Tue/Fri delay.

**Artifact:** `scripts/entry-expectancy-discovery.py` · local results `/tmp/entry-expectancy-*.json`

---

## Verdict

Live champion DNA (**OR mid + swing-3 breakout + 1R + EMA-20**) has **negative** raw expectancy on this history.

Several **other** concepts show **positive train and test** expectancy, green in most/all calendar years. The largest lever is **exit design**, not another OR-swing tweak.

Do **not** deploy yet — next step is paper the winners, then quality-score *on top of* a positive base.

---

## Baseline (champion, no weekday delay)

| | n | WR | Avg pts | Net ₹ | MaxDD ₹ |
|---|---:|---:|---:|---:|---:|
| Train | 11404 | 44.3% | **−0.93** | −315k | −357k |
| Test | 6535 | 42.0% | **−2.05** | −533k | −552k |

Weekday overlays may improve *live* P&amp;L by skipping toxic slices; they do not create a positive base edge in this raw sim.

---

## Exit ablation (same champion entry)

| Exit | Test avg pts | Test n | Test net ₹ |
|---|---:|---:|---:|
| Champ (1R + EMA-20 + EOD) | **−2.05** | 6535 | −533k |
| 1.5R + EOD (no EMA) | −1.62 | 5570 | −305k |
| 2R + EOD | −0.80 | 4979 | −76k |
| Trail swing | −0.91 | 5039 | −122k |
| **EMA-20 only (no fixed TP)** | **+0.49** | 3101 | +113k |
| **SL + hold to close** | **+2.91** | 2657 | +371k |

**Finding:** Fixed 1R + EMA early-exit **destroys** expectancy on this entry. Holding winners (EOD or EMA-only without hard 1R) flips the same signals green OOS.

---

## Concepts with positive train **and** test expectancy

Top combined (test n ≥ 80), slip = 0:

| Concept | Idea | Train avg | Test avg | Test n | Test net ₹ | YoY notes |
|---|---|---:|---:|---:|---:|---|
| **Donchian-20 breakout → EOD** | Close breaks 20-bar high/low; no bias; SL + hold close | +7.92 | **+4.65** | 1863 | +453k | **Green every year 2020–2026** |
| PDH/L **retest** after OR break → EMA-only | OR already broken; retest PDH/L; exit EMA-20 | +11.53 | +4.21 | 502 | +98k | 2021 red |
| Swing-5 + prev-day bias → EMA-only | Break swing-5 with close vs prior close bias | +5.14 | **+4.04** | 2691 | +443k | Green every year |
| PDH/L **breakout** after OR break → EMA-only | Continuation through prior day levels | +5.87 | +3.39 | 2230 | +370k | Green every year |
| Champion entry → EOD only | Same OR-swing entry, different exit | +7.07 | +2.91 | 2657 | +371k | Green every year (2025 weak) |
| OR high/low + EMA50 → EMA-only | Break OR extreme with EMA50 bias | +4.78 | +1.98 | 3529 | +288k | Green every year |

Putting **champion exit** back on Donchian / PDH-L winners → OOS turns **negative** again. Edge is “asymmetric trend continuation held,” not a 1R scalp.

### Profile of the winners

- Win rate **~15–28%** with **positive** avg pts → fat right tail (trend days).
- Structure ≠ champion swing-3 OR-mid alone: **Donchian**, **PDH/L**, **prev-day**, **OR extremes** matter more.
- Pullback/retest helps for PDH/L; pure fade-OR is weak/unstable.
- Donchian lookback 15–20 sweet spot (10 weaker OOS, 30 still green but softer).

### Stress

| Concept | Test avg (0 slip) | Test avg (−2 pts RT) |
|---|---:|---:|
| Donchian-20 → EOD | +4.65 | **+2.65** still + |
| PDH/L retest → EMA | +4.21 | +2.21 still + |
| Swing5 + prev-day → EMA | +4.04 | +2.04 still + |
| Champ entry → EOD | +2.91 | +0.91 still + |
| OR-HL + EMA50 → EMA | +1.98 | **−0.02** fails |

One-trade/day and morning-only (10:15–12:00) still leave Donchian-EOD green OOS.

---

## What did **not** work (pre-filter)

- OR window length alone (30/45/60/90m) on champion stack — still red.
- Bias swaps (ema50 / prev_day / none) on champion stack — still red.
- Retest / EMA20 pullback / fade with **champion exit** — still red or fragile.
- Trail-swing and higher fixed RR without dropping EMA+1R — insufficient.

108 concepts swept; ~20 both-pos after n filter — concentrated in **EOD / EMA-only exits** + **Donchian / PDH-L / prev-day** structures.

---

## Answer to the research question

**Positive expectancy before filtering appears when:**

1. **Entry** rides a clear range break (Donchian-20, PDH/L after OR break, or swing-5 with prior-day bias), and  
2. **Exit** lets winners run (**hold to close**, or **EMA-20 without a hard 1R**).

**Negative expectancy when:** OR-mid + swing breakout is paired with **1R + EMA** (live champion exit stack), regardless of many structure tweaks.

Quality scoring should be applied **after** adopting one of these positive bases — not on top of the current negative-expectancy champion entry/exit.

---

## Recommended next steps (research → paper)

1. **Primary candidate:** Donchian-20 breakout, SL cap, hold to 15:15 (optional 1 trade/day).  
2. **Secondary:** PDH/L breakout or retest only after OR high/low already taken, EMA-20 exit, no 1R.  
3. **Tertiary:** Swing-5 + prev-day bias, EMA-20 exit.  
4. Then: costs (spread/slip beyond 2 pts), options vs futures, weekday overlays as *add-ons*, then quality score for refinement.  
5. Do **not** replace live DNA until paper confirms on the desk path.

---

## Caveats

- Index points sim; not options premium / theta.  
- Multiple testing across 108 concepts — Donchian’s **7/7 green years** is the strongest stability signal.  
- Low WR is structurally expected; size and psychology must match.  
- No live code changes in this pass.
