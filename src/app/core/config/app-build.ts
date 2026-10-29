/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.139';
/** Short build tag — Daily profit candles load in batches of 10. */
export const APP_BUILD = '2026.10.29-profit-batches';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;
