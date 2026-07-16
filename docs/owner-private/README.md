# Palagai — Owner private documentation

**PRIVATE — for your use only.**  
These files live under `docs/owner-private/` at the **repo root**. They are **not** under `src/` or `public/`, so the Angular / Vercel build **does not ship them** to the live site.

Do **not** paste these strategy rules into public chats or share the folder casually — this is your edge.

| Doc | What it covers |
|-----|----------------|
| [00-INDEX.md](./00-INDEX.md) | How to read this pack |
| [01-SECRET-ENTRY-NIFTY-BANK.md](./01-SECRET-ENTRY-NIFTY-BANK.md) | **Secret entry** — Nifty / Bank champion DNA, line-by-line |
| [02-SECRET-ENTRY-CRUDE.md](./02-SECRET-ENTRY-CRUDE.md) | **Secret entry** — Crude evening PDHL, line-by-line |
| [03-EXITS-AND-DESK-WIRING.md](./03-EXITS-AND-DESK-WIRING.md) | Exits (EMA / TP / SL / session) + how desks call the engines |
| [04-REPO-MAP.md](./04-REPO-MAP.md) | Every major folder / file role in the app |
| [ANNOTATED-pdhl-opening-range.evaluator.md](./ANNOTATED-pdhl-opening-range.evaluator.md) | **Every line** of Nifty/Bank entry source |
| [ANNOTATED-crude-pdhl-evening.evaluator.md](./ANNOTATED-crude-pdhl-evening.evaluator.md) | **Every line** of Crude entry source |

## Quick champion cheat sheet

### Nifty 50 / Bank Nifty (Trade Desk)
- **Family:** Opening-range bias + swing breakout  
- **Entries:** 09:20–15:10 IST  
- **Target:** 1R · **Day profit lock:** OFF · **Day stop:** −60 pts  
- **Exit:** SL / TP / EMA-20 / 15:15 close  
- **Nifty SL cap:** 30 · **Bank SL cap:** 45  
- **₹/pt (index plan):** 65  
- **Code:** `src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator.ts`

### Crude Oil Mini (Crude Desk)
- **Family:** Previous-day high/low break + candle colour  
- **Entries:** 19:00–21:00 IST only  
- **SL / TP:** 80 / 200 · **≤2/day · ≤8/month · Day loss stop:** −240  
- **Exit:** SL / TP / 23:10  
- **₹/pt:** 10  
- **Code:** `src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator.ts`
