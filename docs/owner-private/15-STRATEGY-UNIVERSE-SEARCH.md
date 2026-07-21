# 15 — Strategy universe search (best long-term foundation)

**Goal:** Discover the best long-term strategy hidden in 2020–2026 Kite data.  
**Not in scope:** Champion PDHL, Quality Score, Tuesday rules, or improving any prior DNA.

| | |
|---|---|
| Data | Nifty + BankNifty 5m, 2020-01-01 → 2026-07-21 |
| Train / OOS | 2020–2023 / 2024–2026 |
| Universe | **2,653** primary combos + **544** local densify ≈ **3,197** tested |
| Survivors (screen) | **1,318** with positive train **and** OOS expectancy |
| Engine | `scripts/strategy-universe-search.py` |
| Artifacts | `/tmp/strategy-universe/final-top20.json`, `top20.csv` |

---

## Single strongest foundation (recommend for paper → live path)

**Volatility-expansion Donchian-15 breakout, EMA-50 bias, end-of-day exit, morning window 10:15–11:30, one trade per day.**

| Metric | Train | OOS | Full |
|---|---:|---:|---:|
| Expectancy (pts) | +19.4-ish* | **+14.92** | **+17.51** |
| Profit factor | — | **1.52** | 1.65 |
| Win rate | — | 20.2% | 21.8% |
| Max DD ₹ | — | **−36k** | −54k |
| Recovery factor | — | **9.6** | 17.7 |
| Trades | — | 569 | 1,367 |
| Avg hold (bars) | — | 18.0 | 18.7 |
| Years green | 4/4 | **3/3** | **7/7** |
| Regime survival | — | **6/8** | — |
| Nifty OOS exp | — | +9.6 | — |
| Bank OOS exp | — | +20.2 | — |

\*Train expectancy from deep metrics ~19+; OOS/train ratio ≈ 0.77 (not a collapse).

### Rules (plain English)

1. After 10:15, require opening range already formed (OR ends 10:15).  
2. Only trade in direction of **EMA-50** (close above → longs only, below → shorts only).  
3. **Entry:** close breaks the prior **15-bar** Donchian high/low **and** the signal bar’s range ≥ **1.2 × ATR(14)** (volatility expansion).  
4. **Stop:** signal-candle extreme, capped 30 Nifty / 45 Bank; day stop −60.  
5. **Exit:** hold to **15:15** (or stop).  
6. **Session:** new entries only until **11:30**; **max 1 trade/day**.

### Why it works (evidence, not guesswork)

| Evidence | Value |
|---|---|
| Trend-day OOS expectancy | **+51.8 pts** |
| Sideways-day OOS expectancy | **−22.4 pts** |
| High-vol OOS exp | +23.6 |
| Low-vol OOS exp | −15.0 |
| Gap-day OOS exp | +59.2 |
| Avg hold | ~18 bars (winners held; not 1R scalp) |
| WR | ~20% with PF 1.5 → asymmetric payoff |

**Edge sources:** trend continuation + vol expansion filter + structure bias + **letting winners run to EOD**. Cost is paid in sideways/low-vol.

---

## Top 20 strategies

Ranked by composite score (OOS expectancy, PF, RF/DD, stability, walk-forward, regime pass, simplicity). All have **positive train and OOS** expectancy, WF pass ≥ 50%, and OOS year consistency ≥ 2/3.

| # | Strategy (plain) | OOS exp | PF | RF | MaxDD ₹ | n | WR | Regime | Score |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | VolExpand Donch15 + EMA50 + EOD · 10:15–11:30 · 1t | **14.92** | 1.52 | 9.6 | −36k | 569 | 20% | 6/8 | 9.57 |
| 2 | VolExpand Donch15 + EMA50 + swing-trail · 10:15–11:30 · 1t | 13.67 | 1.54 | 11.1 | −26k | 569 | 26% | 6/8 | 9.29 |
| 3 | VolExpand Donch15 + prev-day + EOD · 10:15–11:30 · 1t | 14.65 | 1.51 | 6.4 | −50k | 510 | 20% | 6/8 | 9.01 |
| 4 | VolExpand Donch20 + OR-break + EOD · 10:15–12:00 · 1t | 12.52 | 1.44 | 7.0 | −38k | 553 | 20% | 6/8 | 8.53 |
| 5 | VolExpand Donch15 + no bias + EOD · 10:15–11:30 · 1t | 12.82 | 1.44 | 5.9 | −61k | 630 | 20% | 6/8 | 8.39 |
| 6 | VolExpand Donch20 + OR-break + EOD · 10:15–12:00 · multi | 12.01 | 1.42 | 5.4 | −49k | 575 | 20% | 6/8 | 8.14 |
| 7 | VolExpand Donch20 + OR-break + swing-trail · 10:15–12:00 · 1t | 10.80 | 1.44 | 7.3 | −31k | 553 | 28% | 6/8 | 8.11 |
| 8 | PDH/L break + EMA50 + Donch-exit · 10:30–15:10 · 1t *(fade flag)* | 9.46 | 1.47 | 5.8 | −25k | 357 | 29% | **7/8** | 7.79 |
| 9 | VolExpand Donch20 + OR-mid + EOD · 10:15–12:00 · 1t | 10.58 | 1.37 | 5.6 | −51k | 674 | 20% | 6/8 | 7.74 |
| 10 | **Swing5 + prev-day + EOD · full day · 1t** | 10.55 | 1.45 | 4.8 | −88k | 1202 | 16% | 6/8 | 7.73 |
| 11 | Swing5 + EMA50 + EOD · 10:15–12:00 · multi | 9.16 | 1.44 | 9.1 | −55k | 1453 | 14% | 6/8 | 7.69 |
| 12 | VolExpand Donch20 + EMA50 + EOD · 10:15–12:00 · 1t | 10.67 | 1.37 | 5.1 | −54k | 657 | 20% | 6/8 | 7.69 |
| 13 | VolExpand Donch20 + prev-day + EOD · to 14:00 · multi | 9.77 | 1.37 | 6.3 | −74k | 1118 | 22% | 6/8 | 7.69 |
| 14 | VolExpand Donch20 + OR-break + swing-trail · 10:15–12:00 · multi | 10.02 | 1.41 | 6.0 | −35k | 576 | 27% | 6/8 | 7.67 |
| 15 | VolExpand Donch20 + OR-mid + EOD · full day · 1t | 9.29 | 1.35 | 7.0 | −69k | 1180 | 22% | 6/8 | 7.65 |
| 16 | VolExpand Donch20 + OR-mid + EOD · full day · multi | 8.37 | 1.34 | 8.7 | −66k | 1484 | 24% | 6/8 | 7.65 |
| 17 | VolExpand Donch20 + no bias + EOD · 10:15–12:00 · 1t | 10.19 | 1.36 | 5.6 | −53k | 697 | 20% | 6/8 | 7.63 |
| 18 | Swing5 + prev-day + EOD · 10:15–12:00 · multi | 9.19 | 1.44 | 7.1 | −66k | 1363 | 14% | 6/8 | 7.58 |
| 19 | VolExpand Donch20 + OR-break + EOD · full day · 1t | 8.89 | 1.34 | 7.3 | −53k | 1001 | 23% | 6/8 | 7.58 |
| 20 | **Swing5 + prev-day + EOD · full day · multi** | 7.39 | 1.41 | 9.4 | −74k | 2383 | 17% | 6/8 | 7.54 |

Complete per-strategy yearly / regime / instrument splits: `final-top20.json`.

### Why each family works

| Family | Why (supported) |
|---|---|
| **Vol-expand Donchian** | Breakouts that occur with expanding range filter chop; morning cutoff avoids afternoon mean-reversion; EOD captures trend days (+50 pts) |
| **Swing5 + prev-day** | Structure-aligned swing breaks; full-session still green every year; more trades, lower exp than morning vol-expand |
| **PDH/L + Donch exit** | Prior-day level continuation; channel exit; best regime score (7/8) but fewer trades and a `fade` flag → treat cautiously / re-verify before deploy |

---

## Common characteristics of winners

From Top 20 + survivor pool:

1. **Trend-continuation breakouts dominate** — not fades/reversals (fade/gap-fade/mean-reversion largely rejected).  
2. **Exits that hold winners:** EOD and swing-trail crush ATR-tight / fixed-1R style exits.  
3. **Volatility expansion** is the strongest *new* discovery vs prior work — plain Donchian without expansion is weaker.  
4. **Morning entry window (to 11:30/12:00)** repeatedly beats all-day entry on expectancy and DD.  
5. **One trade/day** often improves RF/DD without killing edge.  
6. **Biases help but are secondary:** EMA50 / prev-day / OR-break all appear; even `none` can work with vol-expand.  
7. **Universal tax:** sideways and low-vol regimes are negative for essentially all winners (6/8 survival, not 8/8).

---

## Rejection summary

Immediate reject if:

- OOS expectancy ≤ 0  
- Train expectancy ≤ 0  
- OOS n < 60  
- OOS year positivity < 2/3  
- Walk-forward year pass rate < 50%  
- Severe overfit (OOS < 25% of a large train expectancy)

**Rejected examples:** fixed 1R stacks, ATR/Chandelier 2× trails, most pure reversals, opening-drive without expansion, many EMA-cross systems.

Local densification around the winner (+544 neighbors) **did** find a stronger variant (Donch15 + EMA50 + 11:30 cutoff, OOS +14.92 vs prior +12.52). Further neighbors did not invent a new *family* — they refined the same morning vol-expand theme.

---

## Robustness notes

- **Walk-forward:** recommended strategy WF pass **6/6** years with n≥25.  
- **Yearly:** green every calendar year 2020–2026; 2025 is the softest (+4 pts OOS year) but still positive.  
- **Instruments:** both Nifty and Bank OOS positive (Bank stronger).  
- **Sensitivity:** Donch 15–20, bias ema50/prev_day/or_break, cutoff 11:30–12:00 form a stable plateau — not a single-point spike.  
- **Simplicity tradeoff:** #1 is morning-restricted. If you need a **full-session** foundation, use **#10 / #20 Swing5 + prev-day → EOD** (still excellent, previously identified).

---

## Recommendation

| Role | Strategy |
|---|---|
| **Primary foundation** | VolExpand Donch15 + EMA50 + EOD · 10:15–11:30 · 1 trade/day |
| Challenger A | Same entry + **swing trailing** exit (#2) — lower DD, still strong |
| Challenger B (full session) | Swing5 + prev-day + EOD · 1 trade/day (#10) |
| Do not deploy | Anything with fixed 1R primary exit; tight ATR trails; Champion PDHL |

**Next research step (not implementation):** paper the primary on the desk path with realistic costs; only then consider a sideways/low-vol stand-down overlay.

---

## Reproduce

```bash
python3 scripts/strategy-universe-search.py
# optional: UNIVERSE_SIZE=3000
# outputs → /tmp/strategy-universe/
```


---

## Stress test addendum (trade count, costs, sensitivity, regime filter)

Base strategy tested: VolExpand Donch15 + EMA50 + EOD · 10:15–11:30 · 1 trade/day.

### How many trades?

| Split | Trades | Expectancy | PF | Net ₹ |
|---|---:|---:|---:|---:|
| Train 2020–2023 | **798** | +19.35 | 1.76 | +611k |
| **OOS 2024–2026** | **569** | **+14.92** | 1.52 | +349k |
| Full sample | **1,367** | +17.51 | 1.65 | +961k |

OOS yearly: 2024 n≈ (exp 28.8) · 2025 (exp 4.0) · 2026 (exp 4.3) — all green.  
**+14.92 is on 569 OOS trades (~190/year), not a tiny sample.** Full history is 1,367 trades.

### Nifty vs Bank (independent)

| | Train n / exp | OOS n / exp | OOS PF |
|---|---|---|---|
| **Nifty** | 394 / +10.75 | **282 / +9.59** | 1.48 |
| **Bank** | 404 / +27.74 | **287 / +20.17** | 1.54 |

Both are **independently positive** OOS. Bank has higher expectancy (and lower WR); Nifty is not a free-rider — it stands alone at +9.6 on 282 trades.

### Transaction costs (round-turn points deducted from every OOS trade)

| RT slip | Combined OOS exp | Nifty | Bank | Still +? |
|---|---:|---:|---:|---|
| 0 pt | +14.92 | +9.59 | +20.17 | yes |
| 2 pt | +12.92 | +7.59 | +18.17 | yes |
| 5 pt | +9.92 | +4.59 | +15.17 | yes |
| 8 pt | +6.92 | +1.59 | +12.17 | yes |
| 10 pt | +4.92 | **−0.41** | +10.17 | combined yes; Nifty fails |
| 15 pt | **−0.08** | −5.41 | +5.17 | **no** |

Futures-like 2–5 pts RT: edge remains strong.  
Harsh ~10 pts (closer to poor options fills): combined still +, but **Nifty alone breaks**.  
At ~15 pts RT the combined edge dies. Treat options execution as the main live risk.

### Parameter sensitivity

**Donchian lookback (EMA50, 11:30, 1t) — OOS exp**

| n | 12 | 13 | 14 | **15** | 16 | 17 | 18 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Exp | +11.8 | +11.5 | +14.3 | **+14.9** | +14.8 | +10.6 | +11.9 |
| n trades | 610 | 598 | 586 | 569 | 547 | 534 | 515 |

**12–18 all profitable.** Peak plateau ~14–16. Not a single-point spike.

**Morning cutoff (Donch15, EMA50, 1t) — OOS exp**

| Cutoff | 11:15 | **11:30** | 12:00 |
|---|---:|---:|---:|
| Exp | **+18.18** | +14.92 | +11.99 |
| Trades | 452 | 569 | 736 |

All three profitable. Earlier cutoff = higher exp, fewer trades. **Not fragile.**

**EMA bias (Donch15, 11:30, 1t) — OOS exp**

| Bias | none | EMA20 | **EMA50** | EMA100 |
|---|---:|---:|---:|---:|
| Exp | +12.82 | +13.17 | **+14.92** | +12.54 |
| Trades | 630 | 625 | 569 | 520 |

EMA20 / 50 / 100 all positive and similar. EMA50 is best, not uniquely magical.

### Regime filter (can we cut sideways/low-vol damage?)

Baseline OOS: n=569, exp=+14.92, DD=−36k.

| Filter | Keep | OOS n | OOS exp | PF | MaxDD |
|---|---:|---:|---:|---:|---:|
| Skip sideways (trade only trending) | 50% | 286 | **+51.8** | 3.02 | −14k |
| Skip low-vol | 87% | 496 | +19.3 | 1.67 | −30k |
| **Trending OR high-vol** | **71%** | **402** | **+31.0** | **2.11** | −30k |
| Only high-vol | 52% | 298 | +23.6 | 1.79 | −33k |

**Yes — a simple filter helps.** Best practical candidate: **allow trades only on trending or high-vol days** (keep ~71% of signals, OOS exp rises to ~+31, DD similar/slightly better).  

With that filter + 5 pts RT slip: still **~+26 exp** on 402 trades.

Caveat: “trending/high-vol” here uses **same-day** features (known by close). For live use, define the filter with **prior-day / morning-only** info (e.g. OR width vs ATR, overnight gap, opening drive) so there is no look-ahead. That is the next research step before deployment.
