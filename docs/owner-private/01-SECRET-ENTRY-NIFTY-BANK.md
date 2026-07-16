# 01 — Secret entry: Nifty & Bank Nifty (champion)

**Source file (authoritative):**  
`src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator.ts`

**Called from:**  
`src/app/core/paper-desk/paper-desk-engine.ts` → `replayPaperOnIndex` → `runPdhlOpeningRange`

**UI:** Trade Desk (`/dashboard/trade-desk`) — Testing + Live paper + Live money.

---

## Champion DNA (plain English)

| Piece | Rule |
|-------|------|
| Opening range | First NSE hour bars: market open → firstHourEnd (09:15–10:15) |
| Bias | Close ≥ OR mid → BUY bias; else SELL bias |
| Trigger | BUY bias + close breaks last swing high · SELL bias + close breaks last swing low |
| Swing | Lookback 3 pivots (`PDHL_SWING_LOOKBACK`) |
| Stop | Candle low (BUY) / high (SELL), floored by min 3 pts, **capped** at maxStop |
| Target | `risk × 1` (1R) |
| Day lock | **Off** (`dailyProfitLockPts = 0`) |
| Day stop | −60 pts on closed index points |
| Entry window | 09:20–15:10 |
| Nifty vs Bank | Same DNA; only SL cap differs (30 vs 45) |

Money scale for planning: **1 index point ≈ ₹65** (`PDHL_RUPEES_PER_POINT`). Live fills are ATM weekly options, not futures points.

---

## Line-by-line: constants & params

| Lines | Code idea | Meaning |
|------:|-----------|---------|
| 7 | `PdhlSignalAction` | BUY / SELL / NO_TRADE / WAITING / SKIPPED |
| 9–17 | `PdhlOrResult` | Signal payload: prices, RR, reason, analysis bag |
| 19–27 | `PdhlOrState` | Per-day net pts, trade counts, stop reason |
| 29–38 | `createPdhlOrState` | Fresh empty day state |
| 41 | `PDHL_RUPEES_PER_POINT = 65` | Your capital plan scale |
| 48–59 | `PdhlOrParams` | Tunables: SL caps, R, day lock/stop, entry window, dna string |
| 62–71 | `PDHL_NIFTY_PARAMS` | **Nifty champion:** cap30, r_1, L0, S60, 09:20–15:10 |
| 74–83 | `PDHL_BANK_PARAMS` | **Bank champion:** cap45, same otherwise |
| 85–94 | Deprecated exports | Old names still alias Nifty params for legacy callers |
| 93–94 | Swing / EMA periods | Swing lookback **3**, EMA exit period **20** (exit used in paper engine) |
| 96–102 | `resolvePdhlOrParams` | `bank-nifty` → Bank params; else Nifty |
| 104–122 | `recordPdhlTradeClosed` | After a close: update day P&L; set dayStoppedReason if lock/stop hit. **Lock only if `dailyProfitLockPts > 0`** (L0 stays free) |

---

## Line-by-line: helpers

### `openingRange` (124–139)
- Filters today’s 5m bars with `time >= marketOpen && time < firstHourEnd`.
- Returns `{ high, low, mid, range }` or null if no bars.

### `swingAtIndex` (146–180) — **secret pivot logic**
- Needs enough bars: `lookback * 2 + 1`.
- Walks pivots from `lookback` to `maxPivot` where a bar’s high (low) is strictly greater (less) than ±lookback neighbours.
- Forward-fills last confirmed swing high/low (hunt-compatible).
- Live path should pass causal series; backtest can pass full series for same confirmation as research.

### `lastConfirmedSwing` (182–187)
- Convenience: swing at last bar index.

### `emaLast` (189–204)
- SMA seed of first `period` closes, then EMA. Used for **EMA-20 exit** in `paper-desk-engine.ts` (not inside this evaluator’s entry).

---

## Line-by-line: `runPdhlOpeningRange` (210–382) — **the entry**

| Lines | What happens |
|------:|--------------|
| 211 | Resolve Nifty vs Bank params from `ctx.instrumentId` |
| 212–219 | Session, current candle, trade date, IST time, full 5m series + day bars |
| 221–228 | New calendar day → reset day counters / stop reason |
| 230–245 | `base` analysis object for UI/debug |
| 247–249 | Before market open → WAITING |
| 251–257 | Before first-hour ready → WAITING (OR not ready) |
| 259–261 | Already day-stopped → NO_TRADE |
| 263–270 | Re-check profit lock / max loss (lock skipped when L0) |
| 272–278 | Outside **09:20–15:10** → WAITING |
| 280–283 | Build OR; missing → WAITING |
| 285 | **Bias:** close ≥ OR mid → BUY else SELL |
| 286–294 | Swing not ready → WAITING |
| 296–301 | **Entry trigger:** bias BUY + close > swing.high → BUY; bias SELL + close < swing.low → SELL |
| 303–312 | No trigger → WAITING |
| 314–328 | Entry = close; stop = candle extreme; reject if risk < 3; **cap risk** at maxStopPts |
| 330–336 | If taking this SL would breach day −60 → NO_TRADE |
| 338–341 | Target = entry ± risk×1R |
| 343–357 | Debug steps for research UI |
| 359–381 | Return BUY/SELL with prices + analysis |

### Helpers `waiting` / `noTrade` (399–428)
- Neutral prices (= close); WAITING vs NO_TRADE semantics for desk UI.

### `clampStopLoss` (384–397)
- Extra clamp helper for coordinators / other callers.

---

## Mental flowchart

```
New 5m bar
  → day reset?
  → market open & OR ready?
  → day stopped?
  → in 09:20–15:10?
  → OR + bias
  → swing ready?
  → break swing with bias?
  → risk ok + day budget ok?
  → ENTER with capped SL + 1R target
```

---

## Do not confuse with
- Older strategies under `strategy-engine/strategies/first-hour-breakout`, `intraday-reversal`, etc. — research / legacy.
- Crude evening PDHL — different file, different desk (doc 02).
