# 51 — 2026-08-10 all losses RCA (−₹592.85)

**Build fix:** v1.3.108 · `autobot-option-stop` (Trade Desk + Autobot parity)  
**Positions (MIS, qty 0):**

| Leg | P&L |
|---|---:|
| BANKNIFTY AUG 57600 PE | −72.00 |
| BANKNIFTY AUG 57700 PE | −309.00 |
| NIFTY 11th AUG 24600 CE | −211.25 |
| RELIANCE (smoke test) | −0.60 |
| **Total** | **−592.85** |

## Root cause

Auto Bot / Order-API was still on **stale Trap DNA** in `strategy-core.cjs`:

| Setting | Stale Autobot (what ran) | Trade Desk (intended) |
|---|---|---|
| piercePts | **3** | 20 |
| bankPiercePts | (same 3) | 40 |
| maxTradesPerDay | **0 (unlimited)** | 3 |
| peak trail arm | **₹600** | ₹100 |
| dayStopPts | 80 | 60 |

`pierce3` + unlimited entries fires scrap traps all morning. Two Bank PE scratches then a Nifty CE — classic churn. RELIANCE −₹0.60 is the Auto Bot **Test BUY/SELL** smoke, not Trap.

Index `dayStopPts` did **not** save the day: option premium lost hundreds while index-point net stayed under the stop.

## Trade Desk check (browser Live)

DNA on Trade Desk was already correct (pierce20 / max3 / peak₹100) after Start.
What was still wrong for a desk-shaped day:

| Issue | Effect |
|---|---|
| `strictDayStop` is **index pts** (~₹2,950 band) | −₹72 / −₹309 option scratches never trip it |
| Option stand-down used **prior-tick** snapshot | Same-tick Bank close + Nifty open still placed the 3rd fill |
| UI said “All-day green · strict stop” | Hid the real option −₹350 brake |

v1.3.107: enrich **before** flush, gate opens on **current-tick** option ₹, surface option stop in the bar.

## Wired fix

1. Autobot Trap DNA ≡ Trade Desk: **pierce20 · Bank40 · peak₹100 · max3 · 3.5R · dayStop 60**  
2. Option-₹ day-loss stand-down at **−₹350/lot** combined — blocks the 3rd scratch after −₹381 Bank.  
3. Trade Desk flush uses current-tick enriched option ₹ (not prior snapshot).  
4. **Autobot** two-pass replay + **option OHLC fetch** so stand-down uses premium ₹ (not index proxy).  
5. Auto Bot UI shows option stop −₹350 (same as Trade Desk).  
6. Patch bundle: `docs/owner-private/patches/autobot-desk-parity-310a/` (bot cannot push Order-API).

## Ops (do this before next Live start)

```bash
# On a machine with Order-API write access — see APPLY.md
cd Palagai-Order-API
# copy strategy-core.cjs + daily-desk-defaults.js + live.worker.js
# push, then on droplet:
cd /var/www/Palagai-Order-API && git pull && pm2 restart trading-backend

# DNA check — must print: 3 20 100
node -e 'const c=require("./live/strategy-core.cjs"); const t=c.createTrapStrategy(); t.initialize(); console.log(t.getSettings().maxTradesPerDay, t.getSettings().extras.piercePts, t.getSettings().extras.profitLockArmRs)'
```

Hard-refresh Trade Desk / Auto Bot — badge must show **v1.3.108 · autobot-option-stop**.  
Do **not** press Test BUY on RELIANCE during the cash session unless you intend a smoke fill.
