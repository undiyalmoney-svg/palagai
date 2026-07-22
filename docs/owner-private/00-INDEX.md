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
11. Use **22** for **zero red + ₹15k every month** auto-bot recipe — **Donch s4 · 6× · lock ₹15k** (OOS 31/31); 1-lot locks stay ~₹2–5k/mo.

## Not in the deploy
Angular assets come from `src/` + `public/` only (`angular.json`).  
This `docs/owner-private/` folder is local/repo documentation only.
