import { Instrument } from '../models/instrument.model';

/**
 * Kite instruments CSV columns:
 * instrument_token, exchange_token, tradingsymbol, name, last_price,
 * expiry, strike, tick_size, lot_size, instrument_type, segment, exchange
 */
export function parseKiteInstrumentsCsv(csv: string): Instrument[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',');
      return {
        instrumentToken: Number(cols[0]) || 0,
        exchangeToken: Number(cols[1]) || 0,
        tradingSymbol: cols[2] ?? '',
        name: cols[3] ?? '',
        lastPrice: Number(cols[4]) || 0,
        expiry: cols[5] ?? '',
        strike: Number(cols[6]) || 0,
        tickSize: Number(cols[7]) || 0,
        lotSize: Number(cols[8]) || 0,
        instrumentType: cols[9] ?? '',
        segment: cols[10] ?? '',
        exchange: cols[11] ?? '',
      };
    })
    .filter((item) => item.instrumentToken > 0);
}
