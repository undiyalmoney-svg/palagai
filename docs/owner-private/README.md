# Palagai — Owner private documentation

**PRIVATE — for your use only.**  
These files live under `docs/owner-private/` at the **repo root**. They are **not** under `src/` or `public/`, so the Angular / Vercel build **does not ship them** to the live site.

Do **not** paste these strategy rules into public chats or share the folder casually — this is your edge.

| Doc | What it covers |
|-----|----------------|
| [00-INDEX.md](./00-INDEX.md) | How to read this pack |
| [01-SECRET-ENTRY-NIFTY-BANK.md](./01-SECRET-ENTRY-NIFTY-BANK.md) | **Secret entry** — Nifty / Bank champion DNA, line-by-line |
| [02-SECRET-ENTRY-CRUDE.md](./02-SECRET-ENTRY-CRUDE.md) | **Secret entry** — Crude evening PDHL, line-by-line |
| [05-CRUDE-HUNT-FINDINGS.md](./05-CRUDE-HUNT-FINDINGS.md) | **Stored hunt data** — Mar–Jul 2026 sample, all-day-green miss, champion pair |
| [06-ALMOST-ALL-DAYS-GREEN.md](./06-ALMOST-ALL-DAYS-GREEN.md) | Nifty/Bank research — almost-all-days-green **not** achievable on current DNA |
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
- **Family:** Morning ORB + Evening PDHL (champion pair from Mar–Jul 2026 hunt)
- **Morning:** OR 09:00–10:00 · entries **10:00–12:00** · SL **80** / TP **250** · skip OR **>120** · ≤1/day
- **Evening:** PDHL entries **18:30–20:30** · SL **80** / TP **150** · ≤1/day
- **Exit:** SL / TP / **23:10** · **Day stop:** −150 pts (≈ −₹1,500); optional Strict −₹1,800
- **₹/pt:** 10 · **All-day-green:** not found on sample (see [05-CRUDE-HUNT-FINDINGS.md](./05-CRUDE-HUNT-FINDINGS.md))
- **Code:** `crude-orb-morning.evaluator.ts` + `crude-pdhl-evening.evaluator.ts`
