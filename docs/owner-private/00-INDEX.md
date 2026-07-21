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
6. Use **11** (dated) for Trade Rejection Analysis of a session day — every skipped bar’s exact failed condition.

## Not in the deploy
Angular assets come from `src/` + `public/` only (`angular.json`).  
This `docs/owner-private/` folder is local/repo documentation only.
