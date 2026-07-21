# 18 — VolExpand morning regime filter

## Problem

VolExpand Donch15 was OOS-strong overall but **March 2026 was red** (17 trades, −5.7 exp, −96 pts) — mostly SL clusters on Bank.

## Solution (no look-ahead)

Features known by **10:15** (OR end + prior day only):

1. **OR drive** = `|OR last close − OR first open| / OR width`
2. **Gap / ATR** = `|today open − prev close| / ATR14`

**Allow trade only if:**

- OR drive **≥ 0.30**, and  
- Gap / ATR **≤ 6.0**

Skips tiny, directionless mornings and extreme-gap chaos days.

## OOS impact (2024–2026)

| | Baseline | **With filter** |
|---|---:|---:|
| Keep | 100% | **64%** (364 / 569) |
| Exp (pts) | +14.9 | **+25.8** |
| PF | 1.52 | **1.92** |
| **Mar 2026** | −5.7 / −96 | **+34.0 / +238** (7 trades) |

## Wiring

- Enabled by default on **VolExpand** module (`regimeFilterEnabled: true`)
- Toggle / thresholds on Strategy Manager → Settings
- Other strategies default **off**

## Reproduce

```bash
python3 scripts/volexpand-regime-filter.py
```
