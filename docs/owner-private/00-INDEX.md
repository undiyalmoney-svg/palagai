# 00 — Index

## Purpose
Owner reference for Palagai: how the app is laid out, and **exactly** how the secret entry rules work so you can re-read them without digging through chat history.

## What “secret entry” means here
The **live Trade Desk / Crude Desk** do **not** use the old research strategies as the primary DNA.  
They use the **champion** evaluators:

1. Nifty / Bank → `runPdhlOpeningRange` (+ EMA exit in paper engine)  
2. Crude Mini → `runCrudePdhlEvening`

Those two files are the product “secret sauce.” Docs 01–03 expand them **line by line**.

## How to use
1. Read **01** and **02** when you need the entry rules.  
2. Read **03** when exits or desk wiring confuse you.  
3. Use **04** as a map when searching the repo.  
4. Use **05** for login / Get Token / IP whitelist pointers.  
5. Use **07** for Stocks Desk treasure watchlist (equity day strategies).  
6. Use **17** for Strategy Manager (multi-strategy Paper/Live/Shadow; Champion remains default).  
7. Use **18** for VolExpand morning regime filter (fixes Mar‑2026 stand-down).  
8. Use **19** for daily ₹500 consistency search (Inside Break vs VolExpand; stocks GAP_FADE still best green-day rate).  
9. Use **20** for S/R · pullback · retest daily ₹500 (**Donch Retest OR-mid 1.5R+BE** default on indices).  
10. Use **21** for stocks check — **Donch Retest is NO_GO on equities**; keep **GAP_FADE_500**.  
11. Use **26** for **Ruler removal** — restore Donch Retest as Nifty/Bank Paper+Live default.  
12. Use **27** for **Smart Pullback PRO** (Pine) — EMA pullback · 1.5R daily ₹ research (selectable, not default).  
13. Use **31** for **S/R Trap + Confirm** max-earn hunt (wired selectable).  
14. Use **33** for **Trap RCA + Kutty design + Trade Desk UI defaults** (Kite 5y evidence; no trading-logic change yet).  
15. Use **34** for **Kutty daily-profit champion** (TP ₹600 / SL ₹200 · ~₹838/day OOS).  
16. Use **39** for **Nat Gas Mini daily-profit** trap DNA (MCX · SL 1.5 / TP 3 · max 1/day · best OOS ₹/day).  
17. Use **40** for **Nat Gas Mini multi-trade** bounce DNA (SL 5 / TP 10 trail · ~2 tpd · higher IS ₹/day).  
16. Use **36** for **Crude Trap peers + loss cutoffs** (Champion stays strong ₹; Trap Confirm selectable).  
17. Use **37** for **Crude Daily Profit (Trap-style)** — evening PDHL + confirm.  
18. Use **38** for **Crude All-Green Afternoon** — Session OR 15:15–23:00 · ~90% green · desk default.  
19. Use **41** for **Crude Selective (charge-aware)** — Trade Desk default; retuned in **42**.  
20. Use **42** for **Daily profit upgrade re-hunt** — Trap peak-trail arm₹400 + Crude Selective SL20/TP40 max 2/day.  
21. Use **43** for **1-lot Daily ₹1k–₹3k** — Trap pierce10 · peak₹150 · soft OFF · Crude SL30/TP60 · lots 1/1/1 (~89% ≥₹1k).

## Not in the deploy
Angular assets come from `src/` + `public/` only (`angular.json`).  
This `docs/owner-private/` folder is local/repo documentation only.
