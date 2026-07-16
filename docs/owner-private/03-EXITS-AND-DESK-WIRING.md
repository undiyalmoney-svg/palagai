# 03 — Exits and desk wiring

## Nifty / Bank exits

**File:** `src/app/core/paper-desk/paper-desk-engine.ts`  
**Function:** `checkIndexExit` (approx lines 80–118)

Order of checks on each 5m bar while a paper trade is open:

1. **Stop** — BUY: low ≤ stop · SELL: high ≥ stop → exit at stop  
2. **Target** — BUY: high ≥ target · SELL: low ≤ target → exit at target  
3. **EMA-20** — `emaLast(closes, 20)` · BUY exits if close < EMA · SELL if close > EMA → exit at close (`EMA-20 exit`)  
4. **Session** — time ≥ `15:15` → exit at close (`Market close (15:15 candle)`)

Entry signal itself comes from `runPdhlOpeningRange` on flat bars (no open trade).

### Replay loop sketch (`replayPaperOnIndex`)
1. Skip warm-up bars; filter by from/to dates.  
2. If open → try exit → `recordPdhlTradeClosed` + day net.  
3. Else → `runPdhlOpeningRange` → on BUY/SELL resolve ATM weekly option → open paper.  
4. Option premiums enriched via historical option candles when available; else estimated.  
5. Lots multiplier scales **option ₹** (and live money qty), not index points.

### Desk service
`paper-trade-desk.service.ts`
- Testing: fetch Nifty+Bank 5m (chunked for Kite 100-day limit), replay, optional option histories, cancel/timeouts.  
- Live: poll ~60s in 09:15–15:30; `realOrders` gated by `environment.allowLiveMoney`.  
- Live money: `LiveOrderExecutorService` MIS MARKET + SL-M.

---

## Crude exits

**File:** `src/app/core/paper-desk/crude-paper-engine.ts`  
**Function:** `checkFuturesExit`

1. SL / TP on futures levels (80 / 200)  
2. Time ≥ `CRUDE_EXIT_BY` (**23:10**) → exit at close  

No EMA exit on crude champion.

### Desk service
`crude-paper-desk.service.ts` — same Testing / Live / Live money pattern for CRUDEOILM + ATM mini options.

---

## Live money (both desks)
- Checkbox + ack + confirm dialog.  
- Orders go via DigitalOcean fixed egress IP (`environment.orderEgressIp` = `168.144.28.89`).  
- App login is shared; **Kite API key/secret/token are per browser**.

---

## Guards / routes
See `src/app/app.routes.ts`:
- `/login` → guest  
- `/dashboard/*` → auth  
- Trade Desk / Crude / Order Test / Settings → also need Kite session  
- Get Token → auth only (can complete Kite redirect)
