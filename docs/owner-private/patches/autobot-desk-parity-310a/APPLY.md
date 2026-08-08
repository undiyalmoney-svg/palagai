# Autobot ≡ Trade Desk (v1.3.105)

Cursor bot cannot push to `Palagai-Order-API` (403). Apply on a machine with write access:

```bash
cd Palagai-Order-API
git checkout -b cursor/autobot-desk-parity-310a
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/strategy-core.cjs live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/daily-desk-defaults.js live/
cp ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/live.worker.js live/
# or: git am ../palagai/docs/owner-private/patches/autobot-desk-parity-310a/0001-autobot-desk-parity.patch
git add live/strategy-core.cjs live/daily-desk-defaults.js live/live.worker.js package.json
git commit -m "Autobot ≡ Trade Desk: pierce20/B40 · max3 · peak₹100 · 3.5R (v1.3.105)"
git push -u origin cursor/autobot-desk-parity-310a

# Droplet
ssh root@168.144.28.89
cd /var/www/Palagai-Order-API && git pull && pm2 restart trading-backend
```

DNA check after deploy:
```bash
node -e 'const c=require("./live/strategy-core.cjs"); const t=c.createTrapStrategy(); t.initialize(); console.log(t.getSettings().maxTradesPerDay, t.getSettings().extras.piercePts, t.getSettings().extras.profitLockArmRs)'
# expect: 3 20 100
```
