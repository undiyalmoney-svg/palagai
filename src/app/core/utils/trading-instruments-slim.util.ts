import { Instrument } from '../models/instrument.model';

/**
 * Desk-relevant subset of the Kite dump — small enough for mobile localStorage
 * when the full JSON hits QuotaExceededError.
 */
export function slimTradingInstruments(list: Instrument[]): Instrument[] {
  return list.filter((item) => {
    const exchange = (item.exchange || '').toUpperCase();
    const itype = (item.instrumentType || '').toUpperCase();
    const sym = (item.tradingSymbol || '').toUpperCase();
    const name = (item.name || '').toUpperCase();

    if (exchange === 'NFO' && (itype === 'CE' || itype === 'PE' || itype === 'FUT')) {
      if (sym.startsWith('BANKNIFTY') || name === 'BANKNIFTY') {
        return true;
      }
      if (
        (sym.startsWith('NIFTY') || name === 'NIFTY') &&
        !sym.startsWith('NIFTYNXT') &&
        !sym.startsWith('FINNIFTY') &&
        !sym.startsWith('MIDCPNIFTY')
      ) {
        return true;
      }
      return false;
    }
    if (exchange === 'MCX' && (sym.includes('CRUDE') || name.includes('CRUDE'))) {
      return true;
    }
    if (exchange === 'NSE') {
      if (itype === 'EQ' || itype === 'BE' || itype === 'IDX') {
        return true;
      }
      return sym === 'NIFTY 50' || sym === 'NIFTY BANK';
    }
    return false;
  });
}
