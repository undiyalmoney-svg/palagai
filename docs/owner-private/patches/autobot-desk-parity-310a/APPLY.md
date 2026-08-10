# Autobot ≡ Trade Desk (v1.3.108 · autobot-option-stop)

**Urgent — 2026-08-10:** Auto Bot ran **stale pierce3 / unlimited** DNA → −₹592.85
(2×Bank PE + Nifty CE). Trade Desk + Autobot now share option −₹350 stand-down on
**current-tick premium ₹** (not index pts). See `docs/owner-private/51-AUG10-ALL-LOSSES-RCA.md`.

Cursor bot cannot push to `Palagai-Order-API` (403). Apply on a machine with write access:

```bash
cd Palagai-Order-API
git checkout -b cursor/autobot-option-stop-409a
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/strategy-core.cjs live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/daily-desk-defaults.js live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/live.worker.js live/
git add live/strategy-core.cjs live/daily-desk-defaults.js live/live.worker.js
git commit -m "Autobot option-stop: pierce20/B40 · max3 · peak₹100 · option OHLC −₹350 (v1.3.108)"
git push -u origin cursor/autobot-option-stop-409a

# Droplet
ssh root@168.144.28.89
cd /var/www/Palagai-Order-API && git pull && pm2 restart trading-backend
```

DNA + option-stop check after deploy:
```bash
node -e 'const c=require("./live/strategy-core.cjs"); const t=c.createTrapStrategy(); t.initialize(); console.log(t.getSettings().maxTradesPerDay, t.getSettings().extras.piercePts, t.getSettings().extras.profitLockArmRs)'
# expect: 3 20 100

node -e 'const d=require("./live/daily-desk-defaults"); console.log(d.APP_VERSION, d.OPTION_DAY_LOSS_RS, d.isOptionDayLossBreached(-381,1), d.riskStatusLabels({strictDayStop:true,dayProfitLock:true,enableNifty:true,enableBank:true,niftyLots:1,bankLots:1}))'
# expect: 1.3.108 350 true  [..., 'option stop −₹350']
```

Hard-refresh Auto Bot — badge **v1.3.108 · autobot-option-stop**.
Event log after a scrap stack should show `Option day-loss stand-down`.
