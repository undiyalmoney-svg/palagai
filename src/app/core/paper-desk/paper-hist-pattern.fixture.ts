/** Longer historical replay of the fail-pattern. Not a guaranteed profit. */
export const PAPER_HIST_PATTERN = {
  "sample": "MCX Crude 5m + Yahoo 1h Nifty/Bank/Sensex + CL\u00d785 proxy",
  "chargeRs": 50.0,
  "books": [
    {
      "name": "crude_mcx_5m",
      "span": "2026-05-21 \u2192 2026-10-30",
      "days": 116,
      "bars": 13342,
      "split": "2026-08-11",
      "allOff": {
        "n": 14,
        "green": 10,
        "red": 4,
        "net": 1400.0,
        "win": 71.4,
        "banked": 10,
        "bankedNet": 2000.0
      },
      "allOn": {
        "n": 14,
        "green": 10,
        "red": 4,
        "net": 1400.0,
        "win": 71.4,
        "banked": 10,
        "bankedNet": 2000.0
      },
      "lateOff": {
        "n": 6,
        "green": 5,
        "red": 1,
        "net": 850.0,
        "win": 83.3,
        "banked": 5,
        "bankedNet": 1000.0
      },
      "lateOn": {
        "n": 6,
        "green": 5,
        "red": 1,
        "net": 850.0,
        "win": 83.3,
        "banked": 5,
        "bankedNet": 1000.0
      },
      "structLate": {
        "n": 47,
        "green": 24,
        "red": 23,
        "net": 1350.0,
        "win": 51.1,
        "banked": 24,
        "bankedNet": 4800.0
      },
      "keep": false,
      "flipped": 1
    },
    {
      "name": "crude_cl_1h_proxy",
      "span": "2024-06-10 \u2192 2026-10-31",
      "days": 736,
      "bars": 13562,
      "split": "2025-08-19",
      "allOff": {
        "n": 135,
        "green": 82,
        "red": 53,
        "net": 18576.5,
        "win": 60.7,
        "banked": 82,
        "bankedNet": 30167.0
      },
      "allOn": {
        "n": 135,
        "green": 77,
        "red": 58,
        "net": 15372.5,
        "win": 57.0,
        "banked": 77,
        "bankedNet": 28213.0
      },
      "lateOff": {
        "n": 68,
        "green": 41,
        "red": 27,
        "net": 9985.0,
        "win": 60.3,
        "banked": 41,
        "bankedNet": 15709.5
      },
      "lateOn": {
        "n": 68,
        "green": 38,
        "red": 30,
        "net": 8181.0,
        "win": 55.9,
        "banked": 38,
        "bankedNet": 14655.5
      },
      "structLate": {
        "n": 88,
        "green": 55,
        "red": 33,
        "net": 12713.5,
        "win": 62.5,
        "banked": 55,
        "bankedNet": 19640.0
      },
      "keep": false,
      "flipped": 7
    },
    {
      "name": "nifty_1h",
      "span": "2023-11-16 \u2192 2026-10-30",
      "days": 727,
      "bars": 5075,
      "split": "2025-05-13",
      "allOff": {
        "n": 207,
        "green": 116,
        "red": 91,
        "net": 63596.0,
        "win": 56.0,
        "banked": 116,
        "bankedNet": 90848.6
      },
      "allOn": {
        "n": 207,
        "green": 103,
        "red": 104,
        "net": 50683.8,
        "win": 49.8,
        "banked": 103,
        "bankedNet": 81552.9
      },
      "lateOff": {
        "n": 103,
        "green": 58,
        "red": 45,
        "net": 30037.1,
        "win": 56.3,
        "banked": 58,
        "bankedNet": 43675.8
      },
      "lateOn": {
        "n": 103,
        "green": 53,
        "red": 50,
        "net": 24994.4,
        "win": 51.5,
        "banked": 53,
        "bankedNet": 40183.1
      },
      "structLate": {
        "n": 119,
        "green": 70,
        "red": 49,
        "net": 37594.8,
        "win": 58.8,
        "banked": 70,
        "bankedNet": 52473.5
      },
      "keep": false,
      "flipped": 20
    },
    {
      "name": "bank_1h",
      "span": "2023-11-16 \u2192 2026-10-30",
      "days": 727,
      "bars": 5075,
      "split": "2025-05-13",
      "allOff": {
        "n": 183,
        "green": 95,
        "red": 88,
        "net": 49674.9,
        "win": 51.9,
        "banked": 95,
        "bankedNet": 74772.2
      },
      "allOn": {
        "n": 183,
        "green": 84,
        "red": 99,
        "net": 36751.6,
        "win": 45.9,
        "banked": 84,
        "bankedNet": 65150.2
      },
      "lateOff": {
        "n": 90,
        "green": 47,
        "red": 43,
        "net": 23750.4,
        "win": 52.2,
        "banked": 47,
        "bankedNet": 36109.1
      },
      "lateOn": {
        "n": 90,
        "green": 42,
        "red": 48,
        "net": 18027.0,
        "win": 46.7,
        "banked": 42,
        "bankedNet": 31947.0
      },
      "structLate": {
        "n": 109,
        "green": 59,
        "red": 50,
        "net": 32031.7,
        "win": 54.1,
        "banked": 59,
        "bankedNet": 46326.8
      },
      "keep": false,
      "flipped": 17
    },
    {
      "name": "sensex_1h",
      "span": "2023-11-16 \u2192 2026-10-30",
      "days": 727,
      "bars": 5076,
      "split": "2025-05-13",
      "allOff": {
        "n": 197,
        "green": 111,
        "red": 86,
        "net": 50145.2,
        "win": 56.3,
        "banked": 111,
        "bankedNet": 70189.4
      },
      "allOn": {
        "n": 197,
        "green": 104,
        "red": 93,
        "net": 43101.2,
        "win": 52.8,
        "banked": 104,
        "bankedNet": 64939.4
      },
      "lateOff": {
        "n": 102,
        "green": 53,
        "red": 49,
        "net": 21078.1,
        "win": 52.0,
        "banked": 53,
        "bankedNet": 32316.9
      },
      "lateOn": {
        "n": 102,
        "green": 50,
        "red": 52,
        "net": 18026.6,
        "win": 49.0,
        "banked": 50,
        "bankedNet": 30066.9
      },
      "structLate": {
        "n": 119,
        "green": 64,
        "red": 55,
        "net": 25640.5,
        "win": 53.8,
        "banked": 64,
        "bankedNet": 38254.2
      },
      "keep": false,
      "flipped": 14
    }
  ],
  "flipFailed": true,
  "lateNetOffRs": 85700.6,
  "lateNetOnRs": 70079.0,
  "lateLiftRs": -15621.6,
  "rulesTried": 54,
  "keptRules": [],
  "champion": {
    "name": "morning structure switch, do not flip",
    "lateLiftRs": 23629.9,
    "lateNetRs": 109330.5,
    "lateOrigRs": 85700.6,
    "booksBetter": 5,
    "longBetter": 4,
    "skipped": 0,
    "keep": true
  },
  "topRules": [
    {
      "name": "skip against VWAP + Monday",
      "lateLiftRs": -1535.0,
      "lateNetRs": 84165.6,
      "longBetter": 1,
      "keep": false
    },
    {
      "name": "structure skip morning",
      "lateLiftRs": 400.0,
      "lateNetRs": 109730.5,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip morning",
      "lateLiftRs": 150.0,
      "lateNetRs": 85850.6,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip range days",
      "lateLiftRs": 0.0,
      "lateNetRs": 85700.6,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip quiet days",
      "lateLiftRs": 0.0,
      "lateNetRs": 85700.6,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip OR fade",
      "lateLiftRs": 0.0,
      "lateNetRs": 85700.6,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip VWAP fade",
      "lateLiftRs": 0.0,
      "lateNetRs": 85700.6,
      "longBetter": 0,
      "keep": false
    },
    {
      "name": "skip range + against VWAP",
      "lateLiftRs": 0.0,
      "lateNetRs": 85700.6,
      "longBetter": 0,
      "keep": false
    }
  ],
  "structureLateNetRs": 109330.5,
  "pdhlLateNetRs": 85700.6,
  "structureBetter": true,
  "worstWeekRs": -1700.0,
  "greenWeeks": 62,
  "redWeeks": 14,
  "workable": true,
  "liveOrders": false,
  "guaranteed": false,
  "armedOnCrudeBest": false,
  "quitJob": false,
  "honest": "Two-year replay. The 8-ticket against-VWAP flip lost \u20b915622 on the later half after charges. The pattern that holds: morning structure switch, do not flip. Later-half structure net \u20b9109330 vs trend-only \u20b985701 after \u20b950. Worst later-half week \u20b9-1700 (62 green / 14 red weeks). This is not a salary and not a reason to quit a job. Not a guaranteed profit."
} as const;
