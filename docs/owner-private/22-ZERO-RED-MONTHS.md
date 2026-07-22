# 22 — Zero red months (research)

## Goal
Find a **causal** auto-router (morning features + month-to-date only) with **0 red months** and positive net, on Nifty+Bank 1 lot (₹65/₹30 pt proxy).

## Verdict

### Achieved: OOS 2024-01 → 2026-07 (31 months)
**0 red months is real** for this window. Best practical policy:

| Policy | Green | Red | Net OOS | Avg/month | Worst month |
|---|---:|---:|---:|---:|---:|
| **`regime_lock500`** (recommended) | **31/31** | **0** | **₹82,828** | **₹2,672** | **+₹606** |
| `donch_s4_lock2500` (max OOS $) | 31/31 | 0 | ₹1,50,001 | ₹4,839 | +₹2,579 |
| `regime_freeze_green` (lock at >0) | 31/31 | 0 | ₹73,204 | ₹2,361 | +₹1 |
| Always Donch 2R (no lock) | 21/31 | 10 | ~₹1.2L* | — | deep reds |
| BEST_EDGE_ROUTER (no lock) | 21/31 | 10 | ₹3.15L | ₹10k | −₹20k |

\*Edge/Donch full expectancy is higher but **not** zero-red.

### Not achieved: full sample 2020 → 2026
Among **10k+** causal policies tested:
- **Min red months while profitable ≈ 3** (`regime_freeze`): **2022-11, 2023-02, 2023-03**
- **0** policies with full-sample zero-red **and** net > 0
- COVID + early-2023 hole months cannot be skipped with morning filters without also killing OOS greens or turning into many small locked-red months

### Hard ceiling (day level)
Even the best morning filters on Donch 2R top out ~**53% WR** (full) / ~**59% WR** (OOS).  
**No** filter with ≥3 trades is 100% day-green. Zero-red months therefore require **month-state control** (freeze/lock), not a perfect day signal.

---

## Winner rule — `regime_lock500`

**Each calendar month:**

1. After 09:45 OR, compute Nifty morning regime (width, drive, gap/ATR, EMA stack).
2. If month MTD **≥ ₹500** → **STAND** rest of month.
3. Else pick arm:
   - **STAND** if choppy (not wide & drive < 0.30)
   - **DONCH_2R** if wide & drive ≥ 0.35
   - **SWING_2R** if EMA aligned (px > ema20 > ema50 or mirror sell)
   - else **STAND**
4. Run same arm on Nifty + Bank (1 lot each).

**OOS arms used:** ~60 Donch / 51 Swing / 512 Stand days.

**Walk-forward:** 2024 alone 12/12 green (₹34.3k); 2025+ 19/19 green (₹48.5k).

---

## Why earlier “freeze once green” missed April 2024
`donch_freeze_once_green` (always Donch until MTD>0) ended **2024-04 at −₹3,462** — never got green, kept trading.  
Regime gating skips many of those hole-digging days; lock at ₹500 stops giving back after a small green.

---

## What was tried (and failed for full-sample zero)
- 1k+ freeze/lock/max-loss/patient/oneshot/soft-freeze policies  
- 7k+ full-sample grid (score × gap × calm × wide × book)  
- Skip-predicate compositions on the last 3 red months  
- No-dig (stand when MTD<0) — creates **more** small red months  
- 24k morning filters for 100% day WR — **none**  
- Weekly freeze — still many reds  
- Nifty-only freeze — OOS zero possible, lower net; not full-sample zero  

---

## Trade-off vs Edge router
| | Edge (expectancy) | Zero-red lock |
|---|---:|---:|
| OOS net | ~₹3.15L | ~₹0.83L (`regime_lock500`) |
| Red months | 10/31 | **0/31** |
| Style | Keep trading edge | Bank the month early |

Not the same product. Zero-red **intentionally leaves money on the table**.

---

## Artifacts
- `/tmp/auto-strategy-select/zero-red-slim.json` — hunt winner list  
- `/tmp/auto-strategy-select/zero-red-stress-slim.json` — lock grid + IS/holdout  
- `/tmp/auto-strategy-select/zero-red-windows.json` — window robustness  
- `/tmp/auto-strategy-select/zero-red-last3-fix.json` — 2022-11 / 2023-02 / 2023-03 diagnosis  
- Repo copies under `reports/zero-red-months/`  
- Repro scripts: `scripts/research-zero-red-months.py` (wrapper notes)

## Deploy status
**Research only.** Not wired into Strategy Manager. Deployed defaults remain Donch 1.5R+BE max 3.
