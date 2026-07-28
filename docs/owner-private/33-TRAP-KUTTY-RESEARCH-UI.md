# 33 — Trap RCA + Kutty design + Trade Desk UI (2026-07-28)

**Status:** Research complete · **No trading-logic changes** in this PR (UI defaults only)  
**Data:** Kite 5m Nifty+Bank · 2020-01-01 → 2026-07-28 · 1,632 sessions  
**Proxy:** Index pts × ₹65 (Nifty) / ₹30 (Bank) · 1 lot each  
**Script:** `scripts/trap-rca-missed-opportunities.py` → `reports/trap-rca/summary.json`  
**Walk-forward:** train ≤2023 · OOS ≥2024-01-01

---

## Executive verdict

1. **Trap implementation matches its design** (S/R trap/bounce → next-bar confirm → EMA50 bias → wick stop → 3.5R → EOD). It does **not** implement CHOCH/BOS/sideways/volume/re-entry — those belong to other strategies.
2. **Biggest operational miss:** indices **default assignment is Donch Retest**, not Trap. On 2026-07-27/28 Donch-style break+retest density was ~0 while Trap took 2–3 trades/day. If Strat still has Donch live, the desk will look “dead” on choppy days.
3. **Next-bar confirm is the edge** — forcing failed confirms destroys OOS (PF ~1.0, DD −₹1.66L). Do **not** loosen confirm.
4. **Profit giveback is real** — Trap has `profitProtectEnabled: false` and EOD/hard-SL exits only. Today (28-Jul) Nifty ran +₹3,598 MFE then stopped out −₹1,648.
5. **Expiry gap:** weekly roll only after **13:00 IST** on Thursday; mornings still bind **same-day** expiry. Requirement is: never trade current expiry on expiry day → always next weekly (holiday-aware).
6. **UI shipped in this PR:** Trade Desk From/To default to **yesterday**; Strict day stop defaults **unchecked**.

---

## 1. Root cause analysis (implementation first)

### What Trap actually checks (in order)

| Stage | Condition | Soft/Hard | Code |
|-------|-----------|-----------|------|
| Day stop | `dayNetPts ≤ -dayStopPts` (80) | SKIPPED | `sr-trap-confirm.engine.ts` |
| Max trades | `tradesToday ≥ 3` | SKIPPED | same |
| Warmup | day bar index `< swingLb` (5) | WAITING | same |
| Confirm window | pending + time outside 09:45–14:45 | WAITING | same |
| Confirm candle | close continues vs signal close + same-direction body | WAITING | same |
| Confirm risk | fill→stop outside Nifty 4–28 / Bank 8–50 | WAITING | same |
| Entry window | before 09:45 / after 14:45 | WAIT / SKIP | same |
| EMA50 | buy only if close>EMA; sell if close<EMA | blocks arm | same |
| Trap/bounce | wick beyond swing ± pierce(3) or soft bounce | WAITING | same |
| Arm risk | signal risk outside band | WAITING | same |
| Exit | hard SL → 3.5R target → 15:15 EOD | — | `indexRuleExitLogic` exit=`eod` |

### Filters that are **not** in Trap (often assumed)

- CHOCH / BOS / market-structure breaks → other modules (`reversal-detection`, research rules)
- Sideways ATR filter → Smart Pullback Pro only
- Volume filter → not wired (adapter stubs OHLC)
- Re-entry / pullback retest state machine → Donch Retest / Smart PB
- Regime filter → `regimeFilterEnabled: false` on Trap
- Profit protect / swing trail → **off** for Trap (`profitProtectEnabled: false`, exit ≠ `swing_trail`)

### Duplicate / redundant

- Risk band checked at **arm** and again at **confirm fill** — intentional (fill can change risk). Not a bug.
- Bank min/max risk applied in managed strategy **and** engine — redundant, consistent.

### Implementation bugs / wiring mistakes (evidence)

| Issue | Evidence | Impact |
|-------|----------|--------|
| **Strict day stop UI does not affect Trap** | `applyChampionDeskOverrides` only updates Champion PDHL | Checkbox false/true irrelevant when Trap/Donch/Genie active; Trap keeps `dayStopPts: 80` |
| **Research cooldown `cd=3` not in app** | Hunt uses `cd=3`; engine has none | OOS app (cd=0) **₹7.76L** vs cd=3 **₹7.30L** — missing cooldown is **not** hurting OOS |
| **Docs say Trap is default; code default = Donch Retest** | `DEFAULT_CHANNEL_ASSIGNMENTS` → `donch-retest-or-mid-2r` | Users may think Trap is live when it is not |
| **Expiry morning same-day** | `rollSameDay = hhmm >= '13:00'` | Expiry-day morning still selects today’s weekly |

### Rejection tallies (full sample, baseline)

Top reasons (bar events): After entry window · EMA bias blocked SELL/BUY · Trap armed wait confirm · **Trap confirm failed** · Signal risk outside band · Max trades · Day stopped.

**Confirm-failed counterfactual (full sample):** would-be net **−₹18.3L** (418 green / 3069 red). Rejecting them is correct.

---

## 2. Trap validation by subsystem

| Subsystem | Status | Notes |
|-----------|--------|-------|
| Entry quality | OK | Next-bar confirm is the documented edge (doc 31 + this RCA) |
| Exit quality | Weak on winners that reverse | No trail / BE; 3.5R or SL or EOD only |
| Stop loss | OK as designed | Wick ± `slPadPts=2`, clamped vs fill |
| Target | OK | 3.5R from live fill risk |
| Re-entry | N/A | Independent new setups up to 3/day; no “re-entry” state |
| Trend (EMA50) | Working | Blocks counter-EMA traps; removing raises DD (−₹32k OOS) |
| Pullback | Soft bounce mode=`both` | Not a classic pullback engine |
| BOS/CHOCH | Absent | Not part of Trap DNA |
| Sideways filter | Absent | By design |
| Volume | Absent | By design |
| Confirmation candles | OK | Next bar must continue |
| Time filters | OK | 09:45–14:45 entry · 15:15 exit |

---

## 3. Missed opportunity analysis — 27 & 28 Jul 2026 (Kite)

### 2026-07-27 (yesterday) — Trap day net **+₹1,132**

| Book | Side | Entry | Exit | ₹ | MFE ₹ | Why |
|------|------|-------|------|--:|-----:|----|
| Nifty | BUY bounce | 11:55 | 12:10 SL | −965 | 354 | Stopped |
| Bank | BUY trap | 12:10 | 12:15 TP | +3,014 | 4,350 | Target 3.5R |
| Nifty | BUY bounce | 13:00 | 13:30 SL | −916 | 1,531 | Gave back |

**Confirm failed (correctly skipped) — counterfactual:**

| Time | Book | Would ₹ |
|------|------|--------:|
| 10:15 | Nifty | −1,664 |
| 13:40 | Nifty | +2,392 |
| 13:15 | Bank | −834 |
| 13:25 | Bank | −1,028 |
| **Net if forced** | | **−₹1,134** |

**Risk-band rejects (4):** bounce/trap risk 35–72 pts outside bands — no counterfactual fill logged at arm stage.

**EMA blocks:** 10× SELL setups blocked while price was above EMA during the rally — **correct** for trend filter (market +228 Nifty / +394 Bank).

### 2026-07-28 (today) — Trap day net **+₹1,618**

| Book | Side | Entry | Exit | ₹ | MFE ₹ | Issue |
|------|------|-------|------|--:|-----:|-------|
| Nifty | BUY bounce | 10:15 | 15:00 SL | **−1,648** | **3,598** | Classic giveback — open profit → full SL |
| Bank | SELL bounce | 12:35 | 12:55 TP | +3,265 | 3,583 | Worked |

Confirm failed: **0**. Risk rejects: **0**. EMA blocks: 4 (mostly Bank).

**Why the system “did little” if Donch was assigned:** approximate Donch break+retest count on both days ≈ **0** (range-bound / expiry chop). Trap still found 2–3 trades. **Minimum fix:** ensure Strat Paper+Live = **Trap** before blaming filters.

---

## 4. Expiry day rule (research → implement later)

**Current:** `nextWeeklyExpiryDate(asOf, rollSameDay)` with `rollSameDay = time ≥ 13:00`.  
**Required:** on expiry day, **always** select **next** weekly; never current expiry; handle holiday-shifted expiry.

**Holiday handling today:** `isFrontWeeklyExpiry` allows ±3 days vs expected Thursday — good for chain match. Synthetic path still labels expected Thursday.

**Recommended change (not implemented yet):**

1. Detect front weekly expiry date from chain (or Thursday±holiday).
2. If `asOfDay == frontExpiryDay` → force `rollSameDay=true` **all day** (not only after 13:00).
3. Prefer next listed weekly in chain; keep ±3d holiday slack.

OOS Thu expiry trades still profitable (PF 2.25) — issue is **contract selection / gamma**, not “skip Thursdays.”

---

## 5. Trap profit protection (why profits were given back)

**Root cause:** `profitProtectEnabled: false` + exit mode `eod` (no EMA exit, no swing trail). Once price reaches large MFE then reverses to stop, full loss is taken.

**Today’s smoking gun:** Nifty 10:15 BUY · MFE ₹3,598 · exit SL −₹1,648.

### OOS counterfactuals (2024+)

| Variant | Net ₹ | Avg/day | Max DD | PF | WR | Hold |
|---------|------:|--------:|-------:|---:|----:|-----:|
| **Current app (3.5R, no protect)** | **7,75,960** | **1,464** | −16,607 | 2.05 | 39.5% | 47m |
| Research cd=3 | 7,30,330 | 1,378 | −15,729 | 2.01 | 39.1% | 46m |
| Protect 1R→BE | 6,07,408 | 1,146 | **−9,082** | **2.93** | 22.4% | 29m |
| Protect 1R→0.5R | 5,45,633 | 1,029 | −7,194 | 2.63 | 75.5% | 17m |
| **2R only** | **7,82,448** | **1,476** | −12,421 | 2.29 | **53.8%** | 26m |
| 2R + 1R→BE | 6,40,499 | 1,208 | **−6,649** | 2.85 | 37.0% | 18m |
| Force failed confirm | 44,566 | 73 | −1,66,455 | 1.00 | 25% | 35m |
| No EMA | 14,62,203 | 2,336 | −32,009 | 1.99 | 38.3% | 43m |
| No risk band | 14,35,032 | 2,388 | −19,172 | 2.03 | 40.8% | 61m |

**Interpretation:**

- Best **risk-adjusted minimum change:** enable existing `profitProtect` (arm 1R / lock BE) **or** prefer **2R target** (same/higher net, better WR, lower DD).
- Pure protect cuts ~22% net for ~45% DD cut — acceptable if goal is “don’t give it back.”
- Loosening EMA/risk band prints more ₹ but **raises DD** — not minimum-safe improvements.

---

## 6–10. Kutty engine · margin · priority · risk (design only)

**Kutty is not a strategy module** — background execution helper. Must **not** appear in Strat dropdown.

### Feasibility (honest)

A naïve clear-direction EMA-pullback scalp (TP ₹350 / SL ₹200, sideways ATR skip) on recent 60d was **≈ flat/slightly negative**. Kutty is **feasible only** if:

- Direction filter is strict (OR drive + EMA slope + not sideways),
- **1 trade / book / day**,
- Hard cash TP/SL (no hold past target),
- **Disabled whenever Trap is flat and hunting** if free margin < Trap reserve,
- Never averages / never revenge.

### Proposed rules (approve before code)

| Rule | Value |
|------|-------|
| Target | ₹350 |
| Stop | ₹200 |
| Style | MIS options, immediate exit at TP/SL |
| Sideways | skip if ATR14 < 0.7 × ATR SMA20 (Smart-PB definition) |
| Direction | EMA50 slope + close on correct side of EMA + OR mid align |
| Interference | if Trap has open/pending on that index → Kutty blocked on that index |
| Priority | Trap > Kutty always |
| Capital | ₹60,000 total |
| Reserve for Trap | keep ≥ margin for 1 Nifty + 1 Bank Trap lot before Kutty opens |
| Multi-index | Kutty may trade Nifty while Trap holds Bank (and vice versa) if margin OK |

### Margin manager (missing today)

There is **no** broker-margin / exposure service — only lots × P&amp;L. Need a pre-trade gate:

1. Sum open Trap + Kutty used margin (estimate from instrument type).
2. Required margin for new order.
3. Remaining = 60k − used − Trap reserve.
4. If remaining < required → deny Kutty (never deny Trap for Kutty).

---

## 11. Performance — Current vs proposed

| Metric | Current Trap OOS | +2R only | +1R BE protect | +2R & 1R BE |
|--------|-----------------:|---------:|---------------:|------------:|
| Win rate | 39.5% | 53.8% | 22.4% | 37.0% |
| Profit factor | 2.05 | 2.29 | 2.93 | 2.85 |
| Avg daily ₹ | 1,464 | 1,476 | 1,146 | 1,208 |
| Max DD ₹ | −16,607 | −12,421 | −9,082 | −6,649 |
| Expected monthly ₹ | ~30.7k | ~31.0k | ~24.1k | ~25.4k |
| Trades (OOS) | 1,166 | 1,267 | 1,253 | 1,314 |
| Avg hold | ~47m | ~26m | ~29m | ~18m |

---

## 12. UI improvements (implemented this PR)

| Control | Before | After |
|---------|--------|-------|
| From Date | today − 60d | **yesterday (IST)** |
| To Date | today | **yesterday (IST)** |
| Strict day stop (−₹2,950) | `true` | **`false`** (user must opt in) |

Note: UI label is **“Strict day stop”** (not “Strip”). Presets 14d/60d/120d still available and still end at today when clicked.

**Follow-up (not in this PR):** wire Strict day stop / day profit lock into Trap day state (today they only hit Champion PDHL).

---

## 13. Ranked recommendations (approve before trading-logic work)

| Rank | Change | Profit ↑ | Risk ↓ | Complexity | Priority |
|-----:|--------|----------|--------|------------|----------|
| 1 | Ensure Strat assignment = **Trap** (ops) | High on chop days | Neutral | Low | **P0** |
| 2 | Expiry day → **always next weekly** | Medium (avoid gamma junk) | High | Low | **P0** |
| 3 | Enable Trap **profitProtect 1R→BE** *or* switch target **2R** | Neutral→small / similar | High | Low (settings exist) | **P1** |
| 4 | Wire desk Strict day stop into Trap `dayStopPts` | Small | Medium | Low | **P1** |
| 5 | Margin gate + Trap reserve (₹60k) | Neutral | High | Medium | **P1** |
| 6 | Kutty background engine (after margin gate) | Small/uncertain | Needs strict filters | Medium | **P2** |
| 7 | Review risk band widening (not remove) | Potential High | DD rises | Medium | **P2 research** |
| 8 | Remove EMA | Looks High | **DD doubles — reject for now** | Low | **No** |
| 9 | Force failed confirms | **Destroys edge** | Catastrophic | Low | **No** |
| 10 | Add CHOCH/BOS/volume into Trap | Unknown | Unknown | High | **No** (different strategy) |

### Minimum approved package (suggested)

1. Ops: Trap selected on Paper+Live.  
2. Code: expiry always next week on expiry day.  
3. Code: Trap `profitProtectEnabled=true` (arm 1 / lock 0) **or** `targetRMultiple=2`.  
4. Code: desk risk checkboxes apply to active strategy day stops.  
5. Code: margin manager + Kutty behind it.

---

## Evidence artifacts

- `reports/trap-rca/summary.json` (local; `reports/` gitignored)
- `scripts/trap-rca-missed-opportunities.py`
- Prior hunt: `docs/owner-private/31-SR-TRAP-CONFIRM-MAX-EARN.md`

**Auth note:** Kite credentials were used only via `/tmp/kite-auth` for this research fetch — **not** committed.
