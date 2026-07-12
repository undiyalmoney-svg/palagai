import { Injectable, inject } from '@angular/core';
import { InstrumentStoreService } from '../../services/instrument-store.service';
import {
  NIFTY_50_INSTRUMENT,
  CRUDE_OIL_INSTRUMENT,
  TesterInstrument,
} from '../../constants/instruments.const';
import { Instrument } from '../../models/instrument.model';

/**
 * Data Layer — instrument information and resolution.
 */
@Injectable({ providedIn: 'root' })
export class InstrumentDataService {
  private readonly instrumentStore = inject(InstrumentStoreService);

  readonly defaultInstruments = [NIFTY_50_INSTRUMENT, CRUDE_OIL_INSTRUMENT];

  getStoredInstruments(): Instrument[] {
    return this.instrumentStore.allInstruments();
  }

  getDefaultInstrument(): TesterInstrument {
    return NIFTY_50_INSTRUMENT;
  }
}
