/** Max distinct option contracts to fetch OHLC for on index paper desk (was 24). */
export const MAX_OPTION_HISTORY_TOKENS = 120;

/** Max for crude paper desk (was 12). */
export const MAX_CRUDE_OPTION_HISTORY_TOKENS = 60;

/** Unique tokens, highest trade-count first (stable for ties). */
export function rankTokensByFrequency(tokens: number[]): number[] {
  const counts = new Map<number, number>();
  for (const t of tokens) {
    if (!(t > 0)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([token]) => token);
}
