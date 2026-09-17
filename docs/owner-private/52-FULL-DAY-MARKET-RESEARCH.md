# 52 — Full-day NIFTY, BANKNIFTY, and Crude research

**Date:** 2026-09-17  
**Script:** `scripts/full-day-market-research.py`  
**Output:** `reports/full-day-market-research/summary.json` (gitignored)  
**Status:** Research only — **do not change live-money DNA from these results**

## Question

Find a repeatable full-day method for NIFTY, BANKNIFTY, and CRUDEOILM, prompted by
the 17 September morning NIFTY calls.

## The observed calls

The broker contract note, not the advertised target, is the reliable evidence:

| Contract | Buy | Sell | Time | Gross |
|---|---:|---:|---|---:|
| NIFTY 22 Sep 23250 CE | ₹151.35 | ₹161.50 | 09:32:02–09:35:35 | ₹659.75 |
| NIFTY 22 Sep 23300 CE | ₹124.35 | ₹142.30 | 09:39:43–10:06:53 | ₹1,166.75 |

Total gross was ₹1,826.50 and contract-note charges were ₹139.86, leaving
approximately **₹1,686.64 net**. The stated ₹107→₹161 move was not the executed
fill. It is therefore unsuitable as ground truth for a bot rule.

## Method

- Five-minute Yahoo data: 58 NIFTY/BANKNIFTY sessions and 50 WTI sessions.
- Full entry sessions: NSE 09:15–15:10; crude proxy 09:00–23:00 IST.
- Four causal families: opening-range breakout, rolling breakout, S/R trap, and
  EMA pullback.
- Signal on a completed bar; fill at the next bar open.
- If stop and target occur in one bar, stop is assumed first.
- Index option money uses an explicit 0.5-delta ATM proxy, ₹80 round-trip cost,
  and adverse slippage. Crude uses ₹50 round-trip cost and adverse slippage.
- Parameters are selected only on the oldest 60% of sessions. Results below are
  from the newest, untouched 40%.

This is stricter than selecting the best result over the whole period, but the
sample is still too short for live deployment.

## Untouched holdout

| Market | Train net | Holdout net | Holdout avg/day | PF | Green days | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| NIFTY | ₹10,941 | **−₹3,193** | −₹133 | 0.76 | 33.3% | −₹4,367 |
| BANKNIFTY | ₹11,359 | **−₹4,615** | −₹192 | 0.74 | 33.3% | −₹7,251 |
| Crude proxy | ₹507 | **₹256** | ₹13 | 1.13 | 60.0% | −₹721 |
| Combined | — | **−₹7,552** | −₹302 | 0.77 | 36.0% | −₹10,348 |

The large train-to-holdout reversal on both indices is direct evidence of
regime dependence/overfitting. No candidate supports a daily-profit claim.

## Time-of-day findings

The selected NIFTY candidate lost **₹5,526** in the 09:15–10:15 holdout bucket.
Its better buckets were 10:15–11:30 (+₹2,272) and 11:30–13:30 (+₹1,341), but
each contains too few trades to establish an edge.

The selected BANKNIFTY candidate also lost in the open (−₹4,061) and
10:15–11:30 (−₹4,168). Midday was positive (+₹2,948), again on only five
holdout trades.

The Crude winner was only marginally positive. Its profit came from three
12:00–16:00 proxy trades; the 09:00–12:00 bucket lost ₹587. Since WTI×85 is not
the traded MCX contract, this is a hypothesis for real-CRUDEOILM validation,
not executable DNA.

## 17 September check

The train-selected NIFTY full-day pullback entered BUY at 09:50 and later lost
about ₹1,219 under the conservative option proxy. This does not mean the two
observed calls were invalid; it shows that copying one successful morning move
does not generalize into a profitable daily rule.

## Cross-check against existing research

`smart-pullback-pro-daily-research.py` searched 2,576 configurations:

- Recent five-minute leaders looked profitable (best printed about ₹622/day).
- The same strategy families on the longer two-year 60-minute check were weak:
  the comparable positive leaders were only around ₹24–₹49/day, while many
  were negative.

`crude-trap-loss-cutoff-hunt.py` on the current WTI proxy found bare Trap around
₹112/day (PF 1.22), but protection variants were negative. Existing real-MCX
notes also disagree materially across short samples. This instability is why
Crude must remain paper/shadow until tested on a longer front-month merge.

## Decision

1. **Do not widen Trap V2 to the open solely to catch the 09:32/09:39 calls.**
   The open was the worst NIFTY holdout bucket in this test.
2. **Do not enable BANKNIFTY or CRUDE live money from this result.**
3. Keep scanning the full day, but treat time buckets as separate regimes.
4. Before another live recommendation, obtain at least 6–12 months of real
   five-minute NFO option candles and continuous CRUDEOILM futures candles.
5. Validate candidates in shadow mode with actual bid/ask fills, charges,
   expiry selection, and no parameter changes during the holdout.

## Reproduce

```bash
python3 scripts/full-day-market-research.py
python3 scripts/smart-pullback-pro-daily-research.py
python3 scripts/crude-trap-loss-cutoff-hunt.py
```
