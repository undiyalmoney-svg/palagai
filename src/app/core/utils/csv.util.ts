import { Instrument } from '../models/instrument.model';

/**
 * Kite instruments CSV columns:
 * instrument_token, exchange_token, tradingsymbol, name, last_price,
 * expiry, strike, tick_size, lot_size, instrument_type, segment, exchange
 */
export function parseKiteInstrumentsCsv(csv: string): Instrument[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = splitCsvLine(line);
      return {
        instrumentToken: Number(cols[0]) || 0,
        exchangeToken: Number(cols[1]) || 0,
        tradingSymbol: (cols[2] ?? '').trim(),
        name: (cols[3] ?? '').trim(),
        lastPrice: Number(cols[4]) || 0,
        expiry: (cols[5] ?? '').trim(),
        strike: Number(cols[6]) || 0,
        tickSize: Number(cols[7]) || 0,
        lotSize: Number(cols[8]) || 0,
        instrumentType: (cols[9] ?? '').trim(),
        segment: (cols[10] ?? '').trim(),
        exchange: (cols[11] ?? '').trim(),
      };
    })
    .filter((item) => item.instrumentToken > 0);
}

/** Minimal CSV split that respects double-quoted fields (names with commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
