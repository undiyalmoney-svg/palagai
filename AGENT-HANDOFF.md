# Agent handoff — Charts Protect

**Date:** 2026-10-02  
**Repos:** `palagai` (frontend) and `Palagai-Order-API` (droplet)  
**Branch (both):** `cursor/protect-charts-auto-9eb1`  
**Base this work sat on:** Charts Auto 25% SL at Kite / 0.5R watched in software, cancel every resting SELL before any exit.

This file is the continuation point if a run runs out of context. Read it before changing Charts Auto. Do not “improve” the 25% / 0.5R egg.

## What the owner asked

Protect is a super assistant: place, stop, sell, protect capital, without them watching and correcting. They are tired of confident UI that fails on **live** Kite. No more of that.

Keep this file in **both** repos in sync.

## Completed

### Why live Auto failed when they were not watching

The Charts tab was the only brain. `document.hidden` skipped every poll (no new entries, no 0.5R flatten). Closing the tab killed software TP. Kite rejects a second SELL while the SL still holds qty — selling without cancelling SL failed live.

### Frontend (`palagai`)

- Protect toggle on Charts. Off = per-chart Auto is theirs.
- On: funds lots (₹40k / index lot, Crude 3×), HTF 5m must be printed, index 09:50–15:15, one NSE book, first fill then stand down, Crude 15:30–21:00.
- Same order path: BUY→ATM CE, SELL→ATM PE, SL 25% at broker, **do not rest TP**, flatten = cancel all resting MIS sells → wait → MARKET SELL `PALAGAI_CHART_EXIT`.
- Hidden tab no longer skips polls when Protect is on.
- Screen wake lock while Protect is on.
- Toggle / fills talk to `GET|PUT /momentum/charts-protect` and `POST /momentum/charts-protect/fill`.
- **When the droplet reports `dropletPlacing`, this tab does not `fireAuto`.** That stops a double-buy. If the API is down, the tab still places and flattens locally.

### Droplet (`Palagai-Order-API`)

- Exit worker every 4s: find `PALAGAI_CHART` open MIS, 25%/0.5R, rest missing SL, on target/stop **cancel sells then market exit**.
- **Entry worker every 15s:** Kite 1m + 5m history → bundled `analyzeSmc` (same TS as the Charts tab) → `decideProtectAuto` → `buildAtmOrderPlan` → MARKET BUY `PALAGAI_CHART` → rest SL only. First poll of a book is history (does not chase the morning). Marks the book placed *before* the order so a retry cannot double-buy; unmarks if Kite refuses.
- State in `data/charts-protect/state.json` (gitignored). Protect off does not abandon an open fill.
- Kite token via `PUT /momentum/broker/auth` (Charts funds refresh already pushes it).
- Rebuild SMC/ATM bundle (needs palagai checkout beside this repo): `node charts-protect/from-charts/build.js`. Runtime file is `charts-protect/from-charts/bundle.js`.

## Live rules (do not change)

- Kite: no OCO. Broker holds **SL only**. Software watches 0.5R.
- Flatten: cancel **every** resting MIS SELL on that tradingsymbol, wait until gone, then MARKET SELL. If SL still live, skip the sell.
- 15s grace after placing SL.
- One ATM at a time. First fill then that book is done. Nifty and Bank are one NSE slot.
- Lots from Kite equity cash, not a typed number.

## How to verify

```
# palagai
npx tsc -p tsconfig.app.json --noEmit
npx ng test --no-watch --include='**/chart-protect.util.spec.ts' --include='**/smc-settings.spec.ts'

# Order-API
node --test charts-protect/protect.test.js
```

Live (after owner asks to merge + `pm2 restart trading-backend`): Token → Charts → Protect on. Status must say **droplet placing and watching exits**. Close the tab. A new HTF-aligned BUY/SELL in window must still buy ATM, rest SL, and flatten at 0.5R.

## Do not

- Enable small-caps live.
- Merge to main / restart droplet unless the owner says so.
- Invent a second strategy. Protect is the Charts Auto egg plus capital rules.
- Rest a LIMIT TP next to the SL.

## Pending (next agent)

1. Owner must approve the PRs, merge, and restart the droplet. This branch is **not** live until then.
2. After droplet restart, confirm logs: `[charts-protect] placing and watching PALAGAI_CHART`.
3. First live session: if Protect is on and the droplet has the token, the tab should **not** place. If `dropletPlacing` is false, the tab is the backup brain — find out why (`lastError` on GET `/momentum/charts-protect`).
4. If palagai SMC/ATM TypeScript changes, rebuild `charts-protect/from-charts/bundle.js` from a workspace that has both repos.
