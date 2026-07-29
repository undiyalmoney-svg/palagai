# 35 — Trap peers + loss cutoffs (profit % hunt)

**Date:** 2026-07-29  
**Status:** Research complete · **day ₹ loss wired** on Trap / Genie / Smart-PB  
**Script:** `scripts/trap-peer-loss-cutoff-hunt.py`  
**Full-sample OOS:** prior Kite hunts (docs 29–34) · **Recent check:** Yahoo 5m 2026-05-07 → 2026-07-29 (~57 sessions)

## Question

> Is there any other strategy to increase the profit percentage?  
> Add loss cutoffs too. Need the same result profile as Trap.

## Short answer

**No peer entry DNA beats Trap on the full walk-forward.**  
To raise the book without abandoning Trap:

| Lever | What it does | Status |
|-------|----------------|--------|
| **Peak-trail + soft SL confirm** | Stops giveback / cuts dead losers | Already wired (docs 33) |
| **Day ₹ loss −₹2,500/leg** | Stops stacking losses after a bad morning | **Wired now** (this doc) |
| **Bank & quit ₹1,000–1,500 + 2R** | Higher green% / PF on recent window; lower max-earn DNA | Research only (not default) |
| **Kutty background scalp** | Extra ~₹800/day OOS beside Trap | Wired (toggle; doc 34) |
| **GENIE / Donch / zone scalp** | Softer or thinner than Trap | Selectable / reject |

## Full OOS baselines (Kite 2024+, index ₹ proxy)

| Book | ₹/day | Green | Red | PF | Net | Notes |
|------|------:|------:|----:|---:|----:|-------|
| Trap max-earn 3.5R (doc 31) | ~1,049–1,109 | ~45% | ~38% | ~2.7–2.9 | ~₹6.4–6.8L | No protect |
| Trap + protect arm600 (doc 33) | ~407 | ~58% | — | ~1.21 | ~₹2.5L | Giveback fixed |
| All-green Trap 2R + bank/quit (doc 32) | ~958 | ~57% | ~26% | — | ~₹5.9L | Flatter |
| GENIE (doc 28/29) | ~523 | — | ~36% | ~1.58 | ~₹3.2L | Smoother, less ₹ |
| Kutty TP600/SL200 (doc 34) | ~838 | ~86% | ~14% | ~18.9 | ~₹5.0L | Background only |
| Zone micro-scalp (doc 30) | ~16 | rare | — | ~1.5–1.8 | tiny | **Reject** |

## Recent window (Yahoo May–Jul 2026) — loss cutoffs matter

Bare Trap **bled** on this stretch; protect DNA flipped it green. Day ₹ loss / bank-quit were tested on top of protect:

| Book | ₹/day | Green | Red | PF | Big ≤−₹900 | Worst day |
|------|------:|------:|----:|---:|----------:|----------:|
| trap_bare | −656 | 36% | 64% | 0.70 | 80 | −₹5.7k |
| **trap_protect** (wired trail+soft) | **647** | **58%** | 42% | 1.30 | 59 | −₹13.0k |
| trap_protect + dayloss ₹2,500 | 744 | 58% | 42% | 1.36 | 57 | −₹6.8k |
| trap_protect + dayloss ₹2,000 | 698 | 56% | 44% | 1.34 | 56 | −₹5.8k |
| bankquit ₹1,500 + 2R + dayloss ₹2k | 916 | 63% | 37% | 1.70 | 37 | −₹5.8k |
| genie_protect | 170 | 55% | 45% | 1.12 | 37 | −₹10.7k |
| kutty_fixed | 63 | 48% | 52% | 1.12 | 0 | −₹800 |
| donch_bare | −512 | 46% | 54% | 0.84 | 109 | −₹6.3k |
| donch_protect | 777 | 65% | 35% | 1.37 | 53 | −₹10.2k |
| trap+kutty (upper bound sum) | 710 | 63% | 37% | 1.67 | 17 | −₹13.8k |

**Takeaways from the recent window**

1. **Protect DNA is mandatory** — bare Trap was −₹656/day; protect → +₹647/day.  
2. **Day loss −₹2,500** keeps Trap’s 3.5R character, lifts ₹/day slightly, cuts the worst day.  
3. **Bank & quit + 2R** prints the best recent ₹/day / PF but is a *different* book (doc 32 green DNA) — not a drop-in for max-earn Trap.  
4. **No other entry family** matched Trap+protect while staying Trap-like. Donch only looked OK *with* protect on this short sample; full OOS still prefers Trap.  
5. **Kutty alone** was weak on this 57-day slice (full OOS still strong) — keep as background, not Strat replacement.

## Wired DNA (v1.3.18+)

Trap / Align Combo · GENIE / Smart Pullback PRO:

```
peak-trail:     arm ₹600 · lock ₹300 · giveback ₹300
soft SL cut:    MFE < 0.75R · 0.55R or ₹700 adverse + confirm
day loss:       −₹2,500 / leg  →  Nifty dayStop ≈ 38 pts · Bank ≈ 83 pts
bank & quit:    OFF (dayBankQuitRs = 0)
target:         Trap 3.5R (unchanged)
```

Hydrate forces these extras so old localStorage cannot keep arm ₹1000 or ignore the day ₹ cap.

## How to raise profit % further (honest)

| Goal | Do this |
|------|---------|
| Same Trap feel, fewer blow-up days | Keep wired protect + **day −₹2,500** (done) |
| More green days / higher PF | Paper **bank & quit ₹1,000–1,500 · 2R · max 2/day** (doc 32) — say the word to wire |
| More total ₹/day | Trap + **Kutty toggle ON** (doc 34) |
| Switch Strat away from Trap | Expect **less** than Trap on full OOS (GENIE ~½ Trap bare; zone scalp ≈0) |

## Not wired

- Bank & quit as default (changes Trap to 2R green book)  
- Donch + Trap protect extras (swing-trail exit path differs; needs its own hunt)  
- Hard ₹ trade caps (destroyed OOS in prior giveback research)

## Reproduce

```bash
# Prefer full Kite cache if present; else Yahoo recent dumps in reports/analyst-cache/
python3 scripts/trap-peer-loss-cutoff-hunt.py
```
