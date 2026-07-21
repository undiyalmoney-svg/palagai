# 14 — Multi-year strategy foundation research

**Objective:** Find the strongest long-term trading foundation with genuine positive expectancy **before** filters.  
**Data:** Kite 5m Nifty + BankNifty, 2020-01-01 → 2026-07-21.  
**Split:** train 2020–2023 · OOS 2024–2026.  
**Rules:** research only — no production DNA changes. Champion PDHL optimization is closed.

**Engine:** `scripts/multi-year-strategy-foundation.py` · artifacts `/tmp/strategy-foundation/`  
**Charts:**

<img alt="Base OOS expectancy" src="/opt/cursor/artifacts/base-oos-expectancy.png" />
<img alt="OOS equity curves" src="/opt/cursor/artifacts/oos-equity-top-strategies.png" />
<img alt="Yearly expectancy" src="/opt/cursor/artifacts/yearly-expectancy-heatmap.png" />

---

## Executive verdict

| Rank | Strategy | OOS exp (pts) | OOS PF | OOS Sharpe | OOS MaxDD ₹ | Regime surv | Verdict |
|---|---|---:|---:|---:|---:|---|---|
| **1** | **Swing-5 + prev-day bias → EOD** | **+7.39** | 1.41 | 1.92 | −94k | 6/8 | **Foundation candidate** |
| 2 | Donchian-55 → Donchian exit | +6.38 | 1.28 | — | −54k | 6/8 | Strong alternate (Turtle-style) |
| 3 | Donchian-20 → EOD | +4.65 | 1.21 | 1.42 | −106k | 6/8 | Simplest robust breakout |
| 4 | PDH/PDL break → EOD | +5.67 | 1.30 | — | −83k | 6/8 | Strong structure variant |
| 5 | Swing-5 + prev-day → EMA | +4.04 | 1.25 | 1.49 | −80k | — | Good if same-day flatten preferred |
| — | Donchian-20 → ATR/Chandelier (2×) | **−4.20** | 0.77 | −2.71 | −524k | 0/3 yrs | **REJECT** |
| — | Champion OR-swing → 1R+EMA | **−2.05** | 0.83 | −3.83 | −536k | 0/3 yrs | **REJECT** (already known) |

**Foundation recommendation:** `Swing-5 breakout with previous-day close bias, initial SL (capped), hold to 15:15`.  
Positive train **and** OOS, green **every calendar year 2020–2026**, Monte Carlo path DD stress still ends positive when net&gt;0, fails mainly in **sideways / low-vol** regimes (expected for trend systems).

Do **not** reintroduce fixed 1R as the primary exit.

---

## Task 1 — Base strategy comparison

Shared constraints: one position at a time, SL from signal candle (cap 30 Nifty / 45 Bank), min risk 3, day stop −60, entries after 10:15, no weekday overlays.

### OOS (2024–2026) scoreboard

| Strategy | Net ₹ | Exp | WR | PF | Sharpe | RF | MaxDD ₹ | Avg W | Avg L | Best W | Worst L | n | Hold (bars) | Stab |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Donch20 → EOD | +453k | **+4.65** | 20.1% | 1.21 | 1.42 | 4.26 | −106k | 134 | −28 | 1591 | −45 | 1863 | 12.9 | 81.7 |
| Donch20 → EMA | +148k | +0.97 | 24.7% | 1.05 | 0.55 | 1.43 | −103k | 84 | −26 | 1224 | −45 | 2245 | 8.8 | 69.2 |
| Donch20 → ATR trail 2× | −518k | **−4.20** | 28.5% | 0.77 | −2.71 | −0.99 | −524k | 48 | −25 | 711 | −45 | 2664 | 5.3 | 9.1 |
| Donch20 → Swing trail | +270k | +2.15 | 24.5% | 1.11 | 0.97 | 3.28 | −82k | 92 | −27 | 1206 | −45 | 2170 | 9.5 | 81.7 |
| Donch20 → Chandelier 2× | −518k | **−4.20** | 28.5% | 0.77 | −2.71 | −0.99 | −524k | 48 | −25 | 711 | −45 | 2664 | 5.3 | 9.1 |
| PDH/L break → EMA | +370k | +3.39 | 25.9% | 1.24 | 1.73 | 3.98 | −93k | 68 | −19 | 1224 | −45 | 2230 | — | 80.9 |
| PDH/L retest → EMA | +98k | +4.21 | 27.7% | 1.21 | 1.20 | — | −28k | — | — | — | — | 502 | — | 78.7 |
| Swing5 + prev-day → EMA | +443k | +4.04 | 21.8% | 1.25 | 1.49 | — | −80k | — | — | — | — | 2691 | — | 87.3 |
| Champion 1R+EMA | −533k | **−2.05** | 42.0% | 0.83 | −3.83 | −0.99 | −536k | 24 | −21 | 45 | −45 | 6535 | 2.1 | 13.2 |

**Note:** In this engine, ATR trail and Chandelier use the same ratchet (`extreme ± k·ATR`), so results match. Both **fail** at k=2.0 (avg hold ~5 bars — cuts the right tail). Wider k (≥3) only approaches breakeven OOS — still inferior to EOD/swing-trail.

### Full-sample (2020–2026) highlights

| Strategy | Net ₹ | Exp | PF | Sharpe | RF | MaxDD | Years + |
|---|---:|---:|---:|---:|---:|---:|---|
| Donch20 → EOD | +1.59M | +6.74 | 1.34 | 1.96 | 14.9 | −106k | 7/7* |
| Swing5+prev → EOD | +1.84M | +7.0-ish | 1.41 | ~2.1 | ~7–14 | −94k | **7/7** |
| Champion | −0.87M | −1.33 | 0.89 | neg | neg | −869k | 0/7 OOS years |

\*Donch20 EOD OOS years all green; full sample years all green in deep dive.

Monthly series for every strategy are in `/tmp/strategy-foundation/all_strategies.json` (`monthly` key). Equity curves for top accepted strategies saved as `equity_oos_*.json`.

---

## Task 2 — Why profitable strategies work (evidence)

### Shared edge (winners vs Champion)

| Evidence metric (OOS) | Champion | Donch20 EOD | Swing5+prev EOD |
|---|---:|---:|---:|
| Avg hold (bars) | 2.1 | **12.9** | **10.6** |
| Hold winners / losers | ~1.1× | **5.1×** (36 / 7) | **6.0×** (35 / 6) |
| MFE / MAE | 1.00 | **1.77** | **1.78** |
| Avg winner / |avg loser| | ~1.1 | **~4.8** | **~7.1** |
| Capture of MFE on wins | 0.55 | **0.71** | **0.73** |
| % trades on trendish days | 63% | 58% | 58% |

**Conclusions supported by data:**

1. **Better exits (holding winners longer)** — primary. Same breakout families die under 1R/ATR2 and live under EOD/EMA/swing-trail. Expectancy delta vs Champion for Donch20 EOD: **+6.7 pts**; hold delta **+10.8 bars**.
2. **Trend following** — winners cluster on days with large |open→close| vs range; OOS expectancy on **trending** days for Swing5+EOD is **+31.4 pts** vs **−11.6** sideways.
3. **Larger winners, not higher win rate** — WR 17–26% with payoff ≥2. Champion’s 42% WR with ~1R payoff loses.
4. **Market structure** — prev-day bias + swing-5 and PDH/L after OR-break add directional context; pure noise breakouts without hold time fail.
5. **Not** “smaller losses” as the main story — avg losers stay near the stop cap (−20 to −28). Edge is right-tail capture.

### Strategy-specific

| Strategy | Dominant edge source |
|---|---|
| Donch20 → EOD | Classic channel breakout + full-session winner hold |
| Swing5 + prev-day → EOD | Structure filter (trade with prior-day location) + EOD hold → highest OOS exp |
| PDH/L break → EMA | Prior-day level continuation; EMA keeps more trades than EOD but lower exp than EOD variant |
| PDH/L retest → EMA | Pullback quality after break; fewest trades, still +OOS |
| ATR/Chandelier 2× | **Fails** — trail too tight (hold ~5 bars), payoff collapses |

---

## Task 3 — Market regime analysis (OOS expectancy)

Foundation `Swing5 + prev-day → EOD`:

| Regime | OOS exp (pts) |
|---|---:|
| Trending | **+31.4** |
| Sideways | **−11.6** |
| High vol | **+12.9** |
| Low vol | **−2.2** |
| Bull day | +7.8 |
| Bear day | +7.0 |
| Gap day | **+21.9** |
| Wide range day | **+29.3** |
| **Survival** | **6 / 8** |

Donch20 → EOD and Turtle-55/20 show the same pattern: thrive in trend/high-vol/gap/wide-range; bleed in chop/low-vol.

**No strategy in this study is profitable in every regime.** Trend foundations must accept sideways drawdowns or later add a *regime filter* (only after base edge is locked).

---

## Task 4 — Robustness

### Out-of-sample
All recommended strategies: train exp &gt; 0 **and** OOS exp &gt; 0. Champion and ATR2 fail OOS.

### Year-by-year (Swing5 + prev → EOD)
| Year | Exp | Net ₹ | Pass |
|---|---:|---:|---|
| 2020 | +9.91 | +400k | ✓ |
| 2021 | +9.30 | +352k | ✓ |
| 2022 | +3.23 | +157k | ✓ |
| 2023 | +5.07 | +231k | ✓ |
| 2024 | +11.20 | +400k | ✓ |
| 2025 | +2.48 | +125k | ✓ |
| 2026 | +9.61 | +175k | ✓ |

Walk-forward (fixed rules, each year as test): **6/6** years pass (exp&gt;0, n≥30).

### Sensitivity (Donchian → EOD, OOS exp by lookback)
| n | 10 | 15 | 20 | 25 | 30 | 40 |
|---|---:|---:|---:|---:|---:|---:|
| Exp | +2.91 | +4.45 | +4.65 | +4.10 | +3.80 | +5.83 |

Stable positive across 10–40 — **not a fragile n=20 spike**.

Chandelier/ATR sensitivity: k=1.5–2.5 deeply negative; k=3.0 ≈ flat. Reject as primary exit.

### Monte Carlo
Order-shuffle does **not** change final P&amp;L (sum invariant). Useful output is **path MaxDD**:
- Swing5+EOD OOS: MaxDD p50 ≈ −73k, p5 ≈ −111k (vs realized −94k).
- Final&gt;0 whenever net&gt;0 (100% for accepted).  
Bootstrap-with-replacement not required to reject losers (ATR2 / Champion already 0% positive finals).

### Rejection rule applied
Rejected if OOS exp≤0, or &lt;50% WF years pass, or n_oos&lt;80. **36/88** strategies rejected; **52** accepted for ranking.

---

## Task 5 — New discoveries (beyond the original list)

| Discovery | OOS exp | Notes |
|---|---:|---|
| **Swing5 + prev-day → EOD** | **+7.39** | Best overall (exit upgrade of known entry) |
| Donchian-55 → Donch exit | +6.38 | Turtle-style; strong RF / lower DD |
| Donchian-55 → EOD | +6.32 | |
| Vol-expansion Donch20 → EOD | +6.29 | Slightly higher DD |
| PDH/L break → EOD | +5.67 | Beats PDH/L→EMA |
| Turtle 55/20 | +5.16 | |
| Opening drive → EOD/EMA | weak / rejected | Not competitive |
| EMA pullback variants | mixed | Generally below breakout+EOD |

**Stronger long-term expectancy than Donch20→EOD exists:** primarily **Swing5+prev→EOD** and **longer Donchian (55) with channel/EOD exits**.

---

## Task 6 — Exit research (same entries × exits)

Best OOS expectancy by entry family:

| Entry | Best exit | OOS exp | Next best |
|---|---|---:|---|
| Donchian-20 | **EOD** | +4.65 | Swing trail +2.15 · EMA +0.97 · ATR/Chand **FAIL** · 1R+EMA **FAIL** |
| PDH/L break | **EOD** / swing trail | +5.67 / +4.81 | EMA +3.39 |
| PDH/L retest | **Swing trail** | +6.25 | EOD / EMA still + |
| Swing5 + prev-day | **EOD** | **+7.39** | Swing trail +5.33 · EMA +4.04 |

**Exit ranking (maximizes expectancy, controls DD):**  
1. **End of Day**  
2. **Swing trailing stop**  
3. **EMA-20 (no fixed TP)**  
4. Donchian opposite-channel exit (especially with longer entry channel)  
5. Hybrid EMA+ATR — not better than pure EOD here  
6. **ATR/Chandelier 2× — reject**  
7. **Fixed 1R (+EMA) — reject**

---

## Task 7 — Final ranking

Scored on OOS expectancy, stability, MaxDD/RF, PF, WF consistency, simplicity, deploy readiness.

| Rank | Strategy | Why |
|---|---|---|
| **1** | Swing-5 + previous-day bias → **EOD** | Highest OOS exp, 7/7 years green, PF 1.41, Sharpe ~1.9, simple rules |
| **2** | Donchian-55 → Donchian exit (Turtle-style) | Excellent RF/DD, 6/8 regimes, classic trend logic |
| **3** | Donchian-20 → EOD | Simplest breakout; sensitivity-stable; slightly lower exp than #1–2 |
| **4** | PDH/L break → EOD | Strong structure; good exit matrix winner |
| **5** | Swing-5 + prev-day → EMA | If forced to flatten before close |
| **REJECT** | Champion 1R+EMA | Negative expectancy (closed research) |
| **REJECT** | Donch20 ATR/Chandelier 2× | Negative OOS, cuts winners |
| **REJECT** | Quality Score as live gate | Prior study NO_GO — not revisited |

**Overfit checks:** lookback sensitivity for Donch EOD stays green; WF years all pass for #1; both Nifty and Bank OOS positive for Donch20 EOD and Swing5 family.

**Live deployment readiness:** research-ready foundation **yes** for paper trading. Production wiring / options vs futures / costs beyond point sim = **next phase**, not this pass.

---

## Recommended path forward

1. **Lock foundation:** Swing-5 + prev-day bias + capped SL + **EOD exit** (paper).  
2. Keep Donchian-20→EOD and Turtle-55/20 as challenger A/Bs on the same paper desk.  
3. Only after base edge confirms live: consider **sideways/low-vol stand-down** as an *add-on* (not OR/Tuesday tweaks).  
4. Do **not** optimize Champion PDHL further.  
5. Do **not** put Quality Score in front of a negative base.

---

## Reproducibility

```bash
# requires reports/analyst-cache/{nifty,banknifty}-5m-2020-2026.json
python3 scripts/multi-year-strategy-foundation.py
# outputs → /tmp/strategy-foundation/summary.json, leaderboard.csv, equity_oos_*.json
```
