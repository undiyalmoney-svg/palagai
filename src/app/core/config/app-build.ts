/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.155';
/** Short build tag — daily-min ₹150 aim on red/sideways/green Crude days. */
export const APP_BUILD = '2026.10.31-daily-min';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;
