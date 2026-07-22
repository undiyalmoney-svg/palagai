# 23 — ₹250 / ₹150 sniper system

## Decision

**NO_GO for deployment with the stated economics.**

The requested one-lot system is:

- +₹250 target per winner
- −₹150 stop per loser
- at most 10 combined Nifty + Bank trades per session
- +₹2,500 session target

This requires ten wins from ten trades before costs. One loss makes the best
possible ten-trade result:

```text
9 × ₹250 − ₹150 = ₹2,100
```

The required win rate to average ₹2,500 with ten trades is therefore **100%**.

## Search

`scripts/sniper-250-search.py` tested **1,296** causal entry/filter systems:

- Donchian, opening-range and previous-day high/low breakouts
- break → retest variants
- EMA pullback
- inside-bar break
- two-bar momentum
- OR-mid, OR-direction and EMA50 biases
- 09:45 / 10:15 starts and 12:00 / 14:30 / 15:00 cutoffs
- opening-range width, drive and gap filters

Validation:

| Window | Role |
|---|---|
| 2020–2023 | train |
| 2024–2025 | validation |
| 2026 through July 21 | untouched test |

Rules:

- entry at signal-bar close
- exits begin on the next 5-minute bar
- one open position per instrument
- at most ten combined trades
- EOD flatten
- conservative stop-first when target and stop touch in the same candle

## Result

**No conservative candidate reached ₹2,500 on one session in the selected
walk-forward finalists.** The best stable candidate remained negative.

The fixed money levels translate to:

| Instrument | Target | Stop |
|---|---:|---:|
| Nifty (₹65/pt) | 3.85 points | 2.31 points |
| Bank (₹30/pt) | 8.33 points | 5.00 points |

Those distances frequently fit inside one 5-minute candle, so OHLC cannot tell
which was touched first.

## Fill-order sensitivity

An intentionally optimistic upper bound counts every candle touching both
levels as target-first. Its best system was two-bar momentum with OR-mid bias:

| Window | Avg/session | Win rate | ₹2,500 days | Trades/session |
|---|---:|---:|---:|---:|
| Train 2020–2023 | ₹1,298 | 70.9% | 7.8% | 9.73 |
| Validation 2024–2025 | ₹1,452 | 75.2% | 8.6% | 9.64 |
| Test 2026 | ₹1,634 | 79.5% | 12.0% | 9.72 |

This is not deployable evidence: **52–65%** of accepted trades were ambiguous
inside a 5-minute candle. Even the favorable assumption remains below the
₹2,500 average target.

## Costs

The gross expectancy per trade at win rate `p` is:

```text
EV = p × ₹250 − (1 − p) × ₹150 = ₹400p − ₹150
```

At a 75% win rate that is only ₹150/trade, or ₹1,500 for ten trades before
brokerage, taxes, spread, slippage and options tracking error.

With ₹25 cost/slippage per trade, it becomes ₹125/trade. Ten trades average
₹1,250. Tiny fixed targets are especially sensitive to costs.

To average ₹2,500 in ten trades at 75% wins, the winner must be about **₹417**
with ₹25/trade costs—not ₹250. That still requires 1-minute/tick fill proof.

## Safe next system

Do not add this sniper to Live or normal Paper based on 5-minute backtests.

The valid next experiment is a **shadow collector**:

1. Record 1-minute or tick-level entry, target and stop ordering.
2. Include actual option bid/ask and all charges.
3. Run the momentum/retest candidates without orders.
4. Require positive expectancy and stable walk-forward results before enabling
   Paper orders.

## Reproduce

```bash
python3 scripts/sniper-250-search.py
```

Full report:

```text
/tmp/sniper-250-search/report.json
```
