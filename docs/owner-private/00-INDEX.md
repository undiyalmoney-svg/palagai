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
6. Use **13** for pre-filter entry expectancy discovery (what has a long-term edge before quality scoring).  
7. Use **14** for multi-year strategy foundation ranking (base compare, exits, regimes, robustness) — **Swing5+prev→EOD** recommended foundation.  
8. Use **15** for large strategy-universe search (~3k combos) — **VolExpand Donch15 + EMA50 + EOD (10:15–11:30, 1t)** as strongest discovered foundation.

## Not in the deploy
Angular assets come from `src/` + `public/` only (`angular.json`).  
This `docs/owner-private/` folder is local/repo documentation only.
