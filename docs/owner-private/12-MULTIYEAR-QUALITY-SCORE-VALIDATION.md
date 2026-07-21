# Multi-year quality score validation (2020–2026)

Research only. Kite 5m cache `reports/analyst-cache/{nifty,banknifty}-5m-2020-2026.json`.  
PDHL Opening Range sim **without weekday earliest overlays** (entries 10:15–15:10), SL caps 30/45, 1R, EMA-20 exit, day stop −60.

**Verdict: NO_GO** for deploying `<60 / 60–79 / ≥80` as a live core gate that replaces weekday rules.

---

## Sample

| | |
|---|---|
| Bars | ~119.5k Nifty + ~119.5k Bank (2020-01-01 → 2026-07-21) |
| Trades (no weekday delay) | **17,939** (Nifty 10,004 / Bank 7,935) |
| Train | 2020–2023 → 11,404 trades |
| Test (OOS) | 2024–2026 → 6,535 trades |

Score: signed features → z-score (train) → 50% logreg + 50% profit/DD Nelder-Mead → percentile 0–100 vs train.

---

## 1. Weight stability (YoY)

Train (2020–2023) importance is **concentrated**:

| Feature | Share |
|---|---|
| `breakout_range_vs_atr` | **49.5%** |
| `atr_ratio` | 20.8% |
| `vol20` / `or_close_pos` | ~8% each |
| `pullback_depth` | **1.3%** |

Year-to-year importance correlation mean **0.64** (pairs 0.56–0.72) — directionally stable, but:

- Multiyear weights **do not match** the ~60d discovery (where `pullback_depth` / `ema50_dist_dir` led).
- `breakout_range_vs_atr` stays #1 every year (~22–44% in yearly fits; ~40–53% in expanding WF trains).
- Secondary features rotate (pullback rises in 2024–26 yearly fits; day_trade_num mattered more in 2020).

**Implication:** short-window weight fits overfit. Do not freeze the 60d formula.

---

## 2. Gate performance OOS (2024–2026)

| Bucket | n | WR | Avg pts | Net ₹ | MaxDD ₹ |
|---|---:|---:|---:|---:|---:|
| Baseline (all) | 6535 | 42.0% | −2.05 | −533k | −536k |
| **≥80** | 1259 | 47.7% | −0.12 | **−28k** | −92k |
| ≥65 | 2260 | 46.4% | −0.78 | −96k | −126k |
| **&lt;60** | 3946 | 39.4% | −2.71 | −406k | −406k |
| 90–100 | 597 | 45.9% | −1.57 | −42k | −59k |
| 80–89 | 662 | 49.4% | +1.19 | +15k | −52k |

- Ranking works: ≥80 beats baseline on avg and DD; &lt;60 is toxic.
- **Absolute edge fails:** shared ≥80 is still **net negative** OOS.
- Top decile (90–100) **underperforms** 80–89 OOS → overconfident high scores.

Expanding walk-forward: ≥80 improved net **and** DD vs that year’s baseline in **6/6** years, but OOS years 2024–25 still left ≥80 red or weak. Modal best threshold = **75**, not 80.

---

## 3. Regimes (OOS ≥80)

- Helps most in **high|high** vol×range (avg +0.52, net +₹12k) and some mid buckets.
- Fails or stays red in **low|high**, **mid|low**, **high|low**.
- By session: morning/midday/afternoon ≥80 all near flat-to-red; none carry the book alone.
- **Not robust across all regimes** — cannot claim “≥80 works everywhere.”

---

## 4. Ablation (OOS ≥80)

Dropping most features barely moves results (net ratios ~0.8–1.8 on a negative base).

Dropping **`breakout_range_vs_atr`** collapses ≥80 (n rises, avg −2.21, net −₹177k, DD ~2× worse).

**Fragile:** the gate is mostly a single-feature filter dressed as a score.

---

## 5. Shared vs separate models

| Model | Test ≥80 net ₹ | MaxDD ₹ |
|---|---:|---:|
| Shared | −28k | −92k |
| Nifty-only | −31k | −83k |
| Bank-only | **+17k** | −34k |
| Separate combined | −14k | — |

Bank-specific ≥80 is the **only** clearly green OOS slice. Shared is slightly worse than separate combined; neither justifies replacing live rules.

---

## Recommendation

| Item | Decision |
|---|---|
| Deploy reject &lt;60 / execute ≥80 as **core live gate** | **NO_GO** |
| Replace Tuesday/Friday earliest overlays with score | **NO_GO** |
| Keep current weekday DNA | **YES** |
| Use score as research / soft veto later | Only after redesign |

**Why NO_GO**

1. OOS ≥80 still net-negative (shared).
2. Weights unstable vs short-window discovery; dominated by one feature.
3. Top scores miscalibrated (90–100 worse than 80–89 OOS).
4. Regime holes remain.
5. Bank-only green does not generalize to a shared gate.

**If revisited:** rebuild with expanding WF weights, capped single-feature influence, instrument-specific models, and evaluate **on top of** weekday rules — not instead of them. Prefer threshold search around **75–85** with yearly recalibration, not a frozen 80.

Artifact: `/tmp/multiyear-quality-validation.json` (local; not committed).
