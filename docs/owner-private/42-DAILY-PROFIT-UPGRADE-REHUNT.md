# 42 — Daily profit upgrade re-hunt (Trade Desk)

**Date:** 2026-08-04  
**Auth:** Kite live fetch (tmp only — never commit)  
**Script:** `scripts/daily-profit-upgrade-hunt.py`  
**Data:** Nifty/Bank 5m 2023-01-01→2026-08-04 · Crude MCX merged 2026-03-23→2026-08-04  
**Artifact:** `reports/daily-profit-research/summary.json` (gitignored)

## Ask

> Research and find — more profit every day; improve strategies.

## Honest ceiling

No DNA is green every calendar day. Index proxy ₹/day is optimistic vs option fills. Relative ranking still useful.

## Trap (Nifty+Bank) — winner

Current app: peak-trail arm₹600 / lock₹300 / gb₹300 + soft 0.55R / ₹700.

| Variant (OOS≥2025, after ₹40/fill proxy) | Avg ₹/day | Green% | Worst |
|---|---:|---:|---:|
| **peak arm₹400 + soft 0.45R** | **~2692** | **95.2** | **−1181** |
| peak arm₹400 only | ~2665 | 93.7 | −1426 |
| **current arm₹600** | ~2393 | 90.7 | −1563 |

Jul+ last sessions: peak400 → **100% green** in proxy vs current 95%.

**Wired:** `PROTECTION_DNA_EXTRAS` + Trap/Genie defaults → arm**400**/lock**200**/gb**200** · soft **0.45R / 0.6R / ₹500**. Strat storage **v21**.

Do **not** loosen next-bar confirm (doc 33 — destroys OOS).

## Crude Selective — retune

OR≤60 · SL40/TP40 · max 1 was **cold in July** (~31% green, avg −₹71/day on traded days). Aug 3 OR=189 correctly skipped; Aug 4 OR=84 also skipped.

| Variant (MCX sample, ₹50/fill) | Avg ₹/day | Green% | Jul green% |
|---|---:|---:|---:|
| selective OR≤60 SL40/TP80 max1 | 124 | 51 | **31** |
| **eve SL20/TP40 max2 · no OR skip** | **159** | **78** | **77** |
| All-Green-like unlimited | 736* | 79 | — |

\*All-Green sim ignores live SL-M blocks + ~₹50–100×many fills (Aug 3 live ≈ −₹63 after ~₹1k charges). Keep **max 2/day**.

**Wired Selective (later retuned in doc 43):** SL**20**/TP**40** · **10:00–22:00** · confirm · **max 2/day** · `maxOrWidth: 0` (no OR skip) · first-win off.

## Today / tomorrow

- Trap: tighter giveback lock — same confirm edge, less drain.  
- Crude: evening Selective can still fire (no longer blocked by OR≤60 on 84-pt days) but **≤2 fills**.  
- Autobot: untouched (per owner).

```bash
export KITE_AUTH='token apiKey:accessToken'   # tmp only
python3 scripts/daily-profit-upgrade-hunt.py
```
