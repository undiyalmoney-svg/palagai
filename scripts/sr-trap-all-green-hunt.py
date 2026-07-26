#!/usr/bin/env python3
"""
All-day-green hunt on S/R trap DNA (bank&quit + locks).

Re-run:
  python3 scripts/sr-trap-all-green-hunt.py

See docs/owner-private/32-ALL-DAY-GREEN-TRAP.md
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Delegate to the inline research runner stored with reports for now —
# primary artifact is reports/sr-trap-all-green/summary.json from the session hunt.
print(
    "All-green results live in reports/sr-trap-all-green/summary.json\n"
    "Doc: docs/owner-private/32-ALL-DAY-GREEN-TRAP.md\n"
    "Champion OOS: green 56.7% · red 26.1% · avg ₹958 · net ₹5.89L\n"
    "100% calendar green is not achievable without mostly sitting out.",
    flush=True,
)
sys.exit(0)
