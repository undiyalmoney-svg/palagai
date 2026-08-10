# Autobot ≡ Trade Desk (v1.3.107 · trade-desk-option-stop)

**Urgent — 2026-08-10:** Auto Bot ran **stale pierce3 / unlimited** DNA → −₹592.85
(2×Bank PE + Nifty CE). See `docs/owner-private/51-AUG10-ALL-LOSSES-RCA.md`.

Cursor bot cannot push to `Palagai-Order-API` (403). Apply on a machine with write access:

```bash
cd Palagai-Order-API
git checkout -b cursor/autobot-stop-red-day-409a
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/strategy-core.cjs live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/daily-desk-defaults.js live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/live.worker.js live/
git add live/strategy-core.cjs live/daily-desk-defaults.js live/live.worker.js
git commit -m "Autobot ≡ Trade Desk option-stop: pierce20/B40 · max3 · peak₹100 · −₹350 (v1.3.107)"
git push -u origin cursor/autobot-stop-red-day-409a

# Droplet
ssh root@168.144.28.89
cd /var/www/Palagai-Order-API && git pull && pm2 restart trading-backend
```

DNA check after deploy:
```bash
node -e 'const c=require("./live/strategy-core.cjs"); const t=c.createTrapStrategy(); t.initialize(); console.log(t.getSettings().maxTradesPerDay, t.getSettings().extras.piercePts, t.getSettings().extras.profitLockArmRs)'
# expect: 3 20 100

node -e 'const d=require("./live/daily-desk-defaults"); console.log(d.APP_VERSION, d.OPTION_DAY_LOSS_RS, d.isOptionDayLossBreached(-381,1))'
# expect: 1.3.107 350 true
```

Hard-refresh Trade Desk / Auto Bot — badge **v1.3.107 · trade-desk-option-stop**.
