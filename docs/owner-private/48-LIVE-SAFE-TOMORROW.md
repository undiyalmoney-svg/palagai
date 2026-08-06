# 48 — Live-safe for tomorrow (paper≠Live pain)

**Date:** 2026-08-06  
**Build:** v1.3.65 · `live-safe`  
**Why:** Owner: paper green / Live tiny or empty · ₹8–10 tuck-tuck · stop after one · signals not on Kite.

## Root causes (confirmed)

| Pain | Cause |
|---|---|
| tuck-tuck ₹8–10 | Trap **peak₹150** (v1.3.64 monster) + SL amend without LTP cushion |
| Stop after ~1 trade | Crude **first-win** · Trap **max 2** · desk lock ~₹1.5k/book |
| Desk signal, no Kite | Crude had **no liveHook** (open+SL in one poll skipped ENTRY) |
| Paper ₹ ≠ Live ₹ | By design after v1.3.57 — Profit ₹ = **Kite fills only** |

## Wired (v1.3.65)

**Index Trap:** pierce15 · Bank30 · bounce OR · **peak₹400/200/200** · soft OFF · unlimited max · dayStop 80  
**Crude Selective:** Trap **SL50/TP200 · ≤4 · lock ₹1k · 10:00–23:00** · first-win **OFF**  
**Code:** Crude liveHook + flush · tick mutex · SL modify uses LTP + NFO min gap · force-close fires onClose  
**Storage:** **v28**

## Tomorrow ops

1. Badge **v1.3.65 · live-safe**  
2. Settings → Refresh Instruments (expiry / CE chain)  
3. Stop → Start **Live money** · Nifty + Bank + Crude · 1/1/1  
4. Event log must show **ENTRY** (not only desk SKIP)  
5. Day profit lock still ON (~₹1.5k per index book when both on) — turn OFF only if you want to run past that

## Honesty

Proxy hunts can look 98% green while Live option fills + charges do not. Live-safe DNA prioritizes **real Kite money path** over paper green %.
