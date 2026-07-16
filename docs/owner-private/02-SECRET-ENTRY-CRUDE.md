# 02 — Secret entry: Crude Oil Mini (evening champion)

**Source file (authoritative):**  
`src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator.ts`

**Called from:**  
`src/app/core/paper-desk/crude-paper-engine.ts` → `replayPaperOnCrude` → `runCrudePdhlEvening`

**UI:** Crude Oil Desk (`/dashboard/crude-oil`) — separate from Nifty/Bank.

**Hunt sample (May–Jul 2026, ₹10/pt, 1 lot futures pts):** ~₹4k–7k/mo green in that short sample — not a guarantee.

---

## Champion DNA (plain English)

| Piece | Rule |
|-------|------|
| Levels | Previous calendar day’s high (PDH) and low (PDL) |
| BUY | Close **> PDH** and close **> open** (bullish candle) |
| SELL | Close **< PDL** and close **< open** (bearish candle) |
| Entry window | **19:00–21:00 IST only** (after office) |
| Stop | Fixed **80** pts from entry |
| Target | Fixed **200** pts from entry |
| Caps | ≤ **2** trades/day · ≤ **8**/month |
| Day loss stop | −**240** pts |
| Force exit | **23:10** IST (also TP/SL earlier) |
| Hold | Typically until TP/SL; max ~4h (e.g. 19:00 → 23:10) |
| ₹/pt | **10** (`CRUDE_RUPEES_PER_POINT`) |

Does **not** change Nifty/Bank DNA.

---

## Line-by-line: constants (1–19)

| Lines | Symbol | Value | Role |
|------:|--------|------:|------|
| 11 | `CRUDE_RUPEES_PER_POINT` | 10 | Money scale for futures pts plan |
| 12 | `CRUDE_STOP_PTS` | 80 | Fixed SL distance |
| 13 | `CRUDE_TARGET_PTS` | 200 | Fixed TP distance |
| 14–15 | `CRUDE_ENTRY_START/END` | 19:00 / 21:00 | Only entry hours |
| 16 | `CRUDE_EXIT_BY` | 23:10 | Session flatten |
| 17–18 | Max trades | 2 / day, 8 / month | Frequency caps |
| 19 | `CRUDE_DAY_LOSS_STOP_PTS` | 240 | Soft day kill |

---

## Line-by-line: state (21–48)

| Lines | Meaning |
|------:|---------|
| 21–28 | `CrudePdhlState` — date, month, day net, trade counts, stop reason |
| 30–39 | `createCrudePdhlState` — empty state |
| 41–48 | `recordCrudeTradeClosed` — add points; bump day+month trade counts; stop day if ≤ −240 |

---

## Line-by-line: `prevDayHl` (50–80) — **level builder**

| Lines | Meaning |
|------:|---------|
| 55–62 | Walk backward from `beforeIndex` to find previous trade date `< tradingDate` |
| 63–65 | No previous day → null |
| 66–75 | Scan all bars of that prev date; track max high / min low |
| 76–79 | Return `{ pdh, pdl }` |

---

## Line-by-line: `runCrudePdhlEvening` (92–170) — **the entry**

| Lines | What happens |
|------:|--------------|
| 98–101 | Date, month (`YYYY-MM`), IST `HH:mm` |
| 103–108 | New day → reset day net / trades / stop |
| 109–112 | New month → reset month trade count |
| 114–116 | Day already stopped → WAITING |
| 117–120 | Day net ≤ −240 → set stop + WAITING |
| 121–123 | Already 2 trades today → WAITING |
| 124–126 | Already 8 trades this month → WAITING |
| 127–132 | Outside 19:00–21:00 → WAITING |
| 134–137 | PDH/PDL missing → WAITING |
| 139–144 | **Secret trigger:** close beyond PDH/PDL **and** candle colour with direction |
| 145–147 | No break → WAITING with level text |
| 149–151 | Entry = close; fixed SL ±80; fixed TP ±200 |
| 153–161 | If −80 would breach day −240 → NO_TRADE |
| 163–170 | Return BUY/SELL with reason string |

### `wait` (172–180)
- WAITING action; prices = close.

---

## Mental flowchart

```
MCX 5m bar
  → day / month reset
  → day stopped or −240?
  → trades < 2 today and < 8 this month?
  → time in 19:00–21:00?
  → PDH/PDL ready?
  → close breaks PDH (green) or PDL (red)?
  → ENTER SL80 TP200
  → manage: SL / TP / 23:10
```

---

## Wiring note
Live crude desk only places/realizes during MCX hours; **signals still only fire in the evening window**. After hours use Testing to replay history.
