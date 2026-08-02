/**
 * MCX mini books used under Experiments (paper DNA lab).
 * Crude is production-proven; Nat Gas reuses the same session/DNA profiles for discovery.
 */
export type McxMiniAssetId = 'crude' | 'natgas';

export interface McxMiniAsset {
  id: McxMiniAssetId;
  /** Primary futures/option tradingSymbol prefix on MCX. */
  futPrefix: string;
  /** Extra prefixes accepted when resolving futures (legacy/alternate listings). */
  altFutPrefixes: string[];
  label: string;
  shortLabel: string;
  /** ₹ per index point for 1 lot (paper + live money math). */
  rupeesPerPoint: number;
  /** Option strike step. */
  strikeStep: number;
  instrumentId: string;
}

export const MCX_MINI_ASSETS: Record<McxMiniAssetId, McxMiniAsset> = {
  crude: {
    id: 'crude',
    futPrefix: 'CRUDEOILM',
    altFutPrefixes: [],
    label: 'Crude Oil Mini',
    shortLabel: 'Crude',
    rupeesPerPoint: 10,
    strikeStep: 50,
    instrumentId: 'crude-oil-mini',
  },
  natgas: {
    id: 'natgas',
    futPrefix: 'NATGASMINI',
    altFutPrefixes: ['NATURALGASMINI', 'NATURALGAS'],
    label: 'Natural Gas Mini',
    shortLabel: 'Nat Gas',
    /** MCX Nat Gas Mini — tune after first live contract check. */
    rupeesPerPoint: 50,
    strikeStep: 5,
    instrumentId: 'natgas-mini',
  },
};

export function mcxMiniAsset(id: McxMiniAssetId | string | null | undefined): McxMiniAsset {
  return MCX_MINI_ASSETS[id === 'natgas' ? 'natgas' : 'crude'];
}
