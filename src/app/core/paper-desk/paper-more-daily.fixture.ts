/** Extra daily tickets + reverse on losers. Not a guaranteed profit. */
export const PAPER_MORE_DAILY = {
  "sample": "Same 5m Crude + Yahoo index tape as the dummy desk",
  "isUntil": "2026-09-01",
  "chargeRs": 50,
  "modesTried": [
    "all_three",
    "fade_trap",
    "orb_break",
    "orb_fade",
    "pdhl",
    "pdhl_fade",
    "trap",
    "vwap_fade"
  ],
  "current": {
    "netRs": 36749.5,
    "greenDays": 54,
    "flatDays": 21,
    "redDays": 0,
    "trades": 85,
    "lateNetRs": 24783.2,
    "lateGreen": 33,
    "lateFlat": 8
  },
  "richer": {
    "netRs": 88916.3,
    "greenDays": 70,
    "flatDays": 5,
    "redDays": 0,
    "trades": 204,
    "lateNetRs": 62016.1,
    "lateGreen": 41,
    "lateFlat": 0,
    "endRs": 102916.3,
    "minFundRs": 14000.0
  },
  "liftRs": 52166.8,
  "lateLiftRs": 37232.9,
  "extraGreenDays": 16,
  "autopsy": {
    "chop_both_lose": 43,
    "no_flip_fill": 5,
    "wrong_direction": 34
  },
  "extra": {
    "backup:all_three": 10,
    "reverse-backup:all_three": 8,
    "backup:orb_break": 6,
    "reverse-backup:orb_break": 1,
    "backup:trap": 21,
    "reverse-backup:vwap_fade": 8,
    "backup:fade_trap": 3,
    "reverse": 34,
    "reverse-backup:fade_trap": 5,
    "backup:vwap_fade": 14,
    "reverse-backup:trap": 6,
    "backup:orb_fade": 2,
    "reverse-backup:orb_fade": 1
  },
  "bookNets": {
    "crude": 13200.0,
    "nifty": 27665.2,
    "bank": 27880.8,
    "sensex": 20170.3
  },
  "bookFills": {
    "crude": 66,
    "nifty": 51,
    "bank": 48,
    "sensex": 39
  },
  "rulesTried": 16,
  "keptRules": [
    "index loser",
    "trend PDHL loser",
    "early loser",
    "with OR loser",
    "morning loser",
    "against OR loser"
  ],
  "champion": {
    "n": 20,
    "isN": 7,
    "oosN": 13,
    "isFlipRs": 4200.0,
    "oosFlipRs": 6811.0,
    "keep": true,
    "name": "trend PDHL loser"
  },
  "topRules": [
    {
      "name": "index loser",
      "n": 23,
      "oosN": 16,
      "oosFlipRs": 8186.8,
      "keep": true
    },
    {
      "name": "trend PDHL loser",
      "n": 20,
      "oosN": 13,
      "oosFlipRs": 6811.0,
      "keep": true
    },
    {
      "name": "early loser",
      "n": 25,
      "oosN": 14,
      "oosFlipRs": 6638.2,
      "keep": true
    },
    {
      "name": "with OR loser",
      "n": 16,
      "oosN": 10,
      "oosFlipRs": 5401.0,
      "keep": true
    },
    {
      "name": "morning loser",
      "n": 18,
      "oosN": 11,
      "oosFlipRs": 5248.2,
      "keep": true
    },
    {
      "name": "against OR loser",
      "n": 18,
      "oosN": 12,
      "oosFlipRs": 3985.8,
      "keep": true
    }
  ],
  "keepTape": true,
  "liveOrders": false,
  "guaranteed": false,
  "armedOnCrudeBest": false,
  "quitJob": false,
  "honest": "Other modes plus reverse on losers. Dummy later-half \u20b962016 vs structure \u20b924783 (41 vs 33 green days). Reverse recovered 34 structure losers. Kept reverse pattern: trend PDHL loser (OOS flip \u20b96811 on 13 tickets). Still dummy. Loss tickets stay refused. Not a salary. Not a guaranteed profit."
} as const;
